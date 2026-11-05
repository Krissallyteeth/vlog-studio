import { METRIC } from './metrics.js';
import { WINDOW, median, relDiff, stage, validBefore } from './stats.js';

/*
 * Rule-based analysis of one post's D+1 data (works without any AI). Every number comes from
 * the stored values; wording comes from templates. Nothing here acts on its own — ad advice is
 * an opinion for the user to weigh.
 */

export const REPORT_METRICS = ['views', 'exposure', 'ctr', 'exit2s', 'retain5s', 'avgWatchRatio', 'completion', 'interactionRate', 'totalInteraction'];

// What to try next when a metric lags: keyed by metric.
const ADVICE = {
  ctr: 'cover',
  exposure: 'topic',
  views: 'cover',
  exit2s: 'hook',
  retain5s: 'hook',
  avgWatchRatio: 'middle',
  completion: 'ending',
  interactionRate: 'cta',
  totalInteraction: 'cta',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function analysePost(post, posts, baseline) {
  const d1 = stage(post);
  const before = validBefore(posts, post);
  const prev = before.at(-1) ?? null;
  const recent = before.slice(-WINDOW);
  const enoughRecent = recent.length >= WINDOW;
  const rows = REPORT_METRICS.map((key) => {
    const m = METRIC[key];
    const value = d1[key];
    const base = baseline?.medians?.[key] ?? null;
    const recentMed = enoughRecent ? median(recent.map((p) => stage(p)[key])) : null;
    const prevVal = prev ? stage(prev)[key] : null;
    const vsBase = relDiff(value, base, m.dir);
    return {
      key,
      value,
      base,
      vsBase,
      baseZero: base === 0,
      prev: prevVal,
      vsPrev: relDiff(value, prevVal, m.dir),
      recent: recentMed,
      vsRecent: relDiff(value, recentMed, m.dir),
      band: m.band,
      state: !isNum(vsBase) ? null : vsBase > m.band ? 'better' : vsBase < -m.band ? 'worse' : 'similar',
    };
  });

  const usable = rows.filter((r) => r.state);
  const better = usable.filter((r) => r.state === 'better').sort((a, b) => b.vsBase - a.vsBase);
  const worse = usable.filter((r) => r.state === 'worse').sort((a, b) => a.vsBase - b.vsBase);
  const advice = [...new Set(worse.map((r) => ADVICE[r.key]))].slice(0, 3);

  const caveats = [];
  if (post.validity === '광고혼입') caveats.push({ key: 'adMixed' });
  if (post.validity === '미확인') caveats.push({ key: 'unknown' });
  const durMed = baseline ? baseline.medians.duration : null;
  if (isNum(d1.duration) && isNum(durMed) && durMed > 0 && Math.abs(d1.duration / durMed - 1) > 0.5) {
    caveats.push({ key: 'duration', vars: { now: Math.round(d1.duration), base: Math.round(durMed) } });
  }
  if ((post.ads ?? []).some((a) => a.executed !== false && a.stage === 'D')) caveats.push({ key: 'adTiming' });
  if (!enoughRecent) caveats.push({ key: 'fewRecent', vars: { n: recent.length } });
  if (!baseline) caveats.push({ key: 'noBaseline' });

  // Not enough comparable data → no verdict ("판단 유보").
  const missing = REPORT_METRICS.filter((k) => !isNum(d1[k])).length;
  const reserved = !baseline || missing > REPORT_METRICS.length / 2 || post.validity !== '유효';

  // Ad opinion (reference only): views vs. the recent valid median, else vs. the baseline.
  let adOpinion = 'hold';
  const ref = enoughRecent ? rows.find((r) => r.key === 'views').vsRecent : rows.find((r) => r.key === 'views').vsBase;
  if (post.validity !== '유효' || !isNum(ref)) adOpinion = 'reserved';
  else if (ref > 0.2) adOpinion = 'consider';
  else if (ref < -0.2) adOpinion = 'skip';

  return { rows, better, worse, advice, caveats, reserved, adOpinion, prev, recentCount: recent.length };
}

/**
 * Ad cost view.
 *  - D+1→D+2 change: only ads run on D+1 (between the two snapshots) are set against it, so later
 *    ads (D+3, D+5 …) never inflate or distort it. It mixes natural and paid growth — "change
 *    during the ad", never "ad effect".
 *  - Per order: when the 薯条 report numbers are recorded, cost per read / follower / like+save
 *    comes straight from what the paid traffic produced.
 */
export function adEffect(post) {
  const d1 = stage(post, 'd1');
  const d2 = stage(post, 'd2');
  const ran = (post.ads ?? []).filter((a) => a.executed !== false);
  const sum = (list, k) => list.reduce((s, a) => s + (a[k] ?? 0), 0);
  const between = ran.filter((a) => a.stage === 'D+1');
  const delta = (k) => (isNum(d1[k]) && isNum(d2[k]) ? d2[k] - d1[k] : null);
  const views = delta('views');
  const followers = delta('newFollowers');
  const betweenSpend = sum(between, 'spend');
  return {
    spend: sum(ran, 'spend'),
    credit: sum(ran, 'credit'),
    betweenSpend,
    viewsDelta: views,
    followersDelta: followers,
    perView: betweenSpend && isNum(views) && views > 0 ? betweenSpend / views : null,
    perFollower: betweenSpend && isNum(followers) && followers > 0 ? betweenSpend / followers : null,
    unknownStage: ran.filter((a) => !a.stage).length,
  };
}

/** Efficiency of one 薯条 order from its own report (null when the report numbers are missing). */
export function orderEfficiency(ad) {
  const o = ad.order ?? {};
  // The report covers the whole order, so costs use the whole order's spend.
  const spend = isNum(ad.orderSpend) ? ad.orderSpend : ad.spend;
  const per = (n) => (isNum(spend) && spend > 0 && isNum(n) && n > 0 ? spend / n : null);
  const likeFav = isNum(o.likes) || isNum(o.favorites) ? (o.likes ?? 0) + (o.favorites ?? 0) : null;
  // Per like+save / per follower only for orders bought for that goal (see goalType in ad-report.js).
  const goal = String(ad.goal ?? '');
  const isFollow = /关注|粉丝|涨粉/.test(goal);
  const isLikeFav = /点赞|收藏|赞藏/.test(goal);
  return {
    perRead: per(o.reads),
    perFollow: isFollow ? per(o.follows) : null,
    perLikeFav: isLikeFav ? per(likeFav) : null,
    perProfile: per(o.profileViews),
    likeFav,
    engagement: isNum(o.exposure) && o.exposure > 0 && isNum(likeFav) ? likeFav / o.exposure : null,
    hasReport: Object.values(o).some(isNum),
  };
}
