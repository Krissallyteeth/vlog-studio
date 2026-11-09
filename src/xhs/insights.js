import { channelBrief } from './channels.js';
import { METRIC } from './metrics.js';
import { adOrders, goalType } from './ad-report.js';
import { isValid, median, ordered, relDiff, stage } from './stats.js';
import { stageDay } from './store.js';

/*
 * Insights that change with the data (no AI, no fixed thresholds). Every cut-off is taken from the
 * user's own records each time (e.g. "D+1 views above my median"), a comparison is only made when
 * both sides have at least MIN orders, and one with fewer than SOLID per side is marked as a
 * reference. When the data turns the other way, the sentence turns with it.
 */

export const MIN = 2; // per side, else nothing is said
export const SOLID = 3; // per side, else the insight is shown as a reference

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (xs, f) => xs.reduce((a, x) => a + (isNum(f(x)) ? f(x) : 0), 0);
const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);

/** Real money per follower over a group of orders (orders bought for followers, with a report). */
const perFollow = (list) => {
  const f = sum(list, (o) => o.metrics.follows);
  return f > 0 ? sum(list, (o) => o.spend) / f : null;
};

function compare(key, a, b, extra = {}) {
  // a, b: [label, orders]; says something only when the two differ by 25% or more.
  const [la, A] = a;
  const [lb, B] = b;
  if (A.length < MIN || B.length < MIN) return null;
  const ca = perFollow(A);
  const cb = perFollow(B);
  if (!isNum(ca) || !isNum(cb)) return null;
  const hi = Math.max(ca, cb);
  const lo = Math.min(ca, cb);
  if (hi / lo < 1.25) return null;
  const aWins = ca < cb;
  return {
    key,
    tone: 'info',
    ref: Math.min(A.length, B.length) < SOLID,
    vars: { win: aWins ? la : lb, lose: aWins ? lb : la, cheap: r2(lo), dear: r2(hi), times: Math.round((hi / lo) * 10) / 10, nWin: aWins ? A.length : B.length, nLose: aWins ? B.length : A.length, ...extra },
  };
}

/** Ad insights for the dashboard, newest data each time. */
export function adInsights(posts) {
  const orders = adOrders(posts).filter((o) => isNum(o.spend) && o.spend > 0);
  const follow = orders.filter((o) => goalType(o.goal) === 'follow' && isNum(o.metrics.follows));
  const likeFav = orders.filter((o) => goalType(o.goal) === 'likeFav' && isNum(o.metrics.follows));
  const out = [];

  // 1. Which goal brings followers: followers per 100元 on each goal.
  if (follow.length >= MIN && likeFav.length >= MIN) {
    const per100 = (list) => (sum(list, (o) => o.metrics.follows) / sum(list, (o) => o.spend)) * 100;
    const f = per100(follow);
    const l = per100(likeFav);
    if (f > l * 1.5) out.push({ key: 'goalForFollowers', tone: 'good', ref: Math.min(follow.length, likeFav.length) < SOLID, vars: { f: Math.round(f * 10) / 10, l: Math.round(l * 10) / 10, nF: follow.length, nL: likeFav.length } });
  }

  // 2. Natural D+1 views of the post vs the price of a follower (single-note orders): cut at the
  //    median D+1 views of the user's own valid posts.
  const viewsOf = (o) => (o.links.length === 1 ? stage(o.links[0].post).views : null);
  const withViews = follow.filter((o) => !o.multi && isNum(viewsOf(o)));
  const cut = median(ordered(posts).filter(isValid).map((p) => stage(p).views).filter(isNum));
  if (isNum(cut)) {
    const c = compare('naturalCut', [`D+1 ≥ ${Math.round(cut)}`, withViews.filter((o) => viewsOf(o) >= cut)], [`D+1 < ${Math.round(cut)}`, withViews.filter((o) => viewsOf(o) < cut)], { cut: Math.round(cut) });
    if (c) out.push({ ...c, tone: c.vars.win.includes('≥') ? 'good' : 'warn', vars: { ...c.vars, highWins: c.vars.win.includes('≥') } });
  }

  // 3. When to run it (followers): D/D+1 vs D+2 and later.
  const dayOf = (o) => (o.multi ? null : stageDay(o.stages[0]));
  const early = follow.filter((o) => isNum(dayOf(o)) && dayOf(o) <= 1);
  const late = follow.filter((o) => isNum(dayOf(o)) && dayOf(o) >= 2);
  const st = compare('timing', ['D·D+1', early], ['D+2~', late]);
  if (st) out.push(st);

  // 4. Several notes in one order vs one note.
  const mv = compare('multiVsSingle', ['multi', follow.filter((o) => o.multi)], ['single', follow.filter((o) => !o.multi)]);
  if (mv) out.push(mv);

  // 5. Content type of the post (types set in the data screen).
  const typed = follow.filter((o) => !o.multi && o.links[0].post.contentType);
  const types = [...new Set(typed.map((o) => o.links[0].post.contentType))];
  if (types.length >= 2) {
    const groups = types.map((ty) => [ty, typed.filter((o) => o.links[0].post.contentType === ty)]).filter(([, l]) => l.length >= MIN);
    if (groups.length >= 2) {
      groups.sort((a, b) => perFollow(a[1]) - perFollow(b[1]));
      const c = compare('contentType', groups[0], groups.at(-1));
      if (c) out.push(c);
    }
  }

  // 6. Trend: the last three follower orders vs the ones before.
  const byDate = follow.filter((o) => o.date).sort((a, b) => a.date.localeCompare(b.date));
  if (byDate.length >= 5) {
    const last = byDate.slice(-3);
    const before = byDate.slice(0, -3);
    const a = perFollow(last);
    const b = perFollow(before);
    if (isNum(a) && isNum(b) && Math.abs(a / b - 1) >= 0.3) out.push({ key: a > b ? 'trendUp' : 'trendDown', tone: a > b ? 'warn' : 'good', ref: before.length < SOLID, vars: { now: r2(a), before: r2(b), from: last[0].date } });
  }

  // 7. Followers: bought vs grown on their own (follower count at each post's publish time).
  const fans = ordered(posts).filter((p) => isNum(p.followers) && p.date);
  if (fans.length >= 2) {
    const first = fans[0];
    const lastP = fans.at(-1);
    const growth = lastP.followers - first.followers;
    const bought = sum(orders.filter((o) => o.date && o.date >= first.date && o.date < lastP.date), (o) => o.metrics.follows);
    if (growth > 0 && bought > 0) out.push({ key: 'followerSplit', tone: 'info', ref: false, vars: { growth, bought: Math.min(bought, growth), organic: Math.max(0, growth - bought), share: Math.round((Math.min(bought, growth) / growth) * 100), from: first.date, to: lastP.date } });
  }
  return out;
}

/**
 * Ad candidates: recent valid posts without an ad whose D+1 views are at or above the cut where
 * the user's own follower ads have been cheaper (else the median D+1 views).
 */
export function adCandidates(posts, { days = 10, today = new Date().toISOString().slice(0, 10) } = {}) {
  const valid = ordered(posts).filter(isValid);
  const cut = median(valid.map((p) => stage(p).views).filter(isNum));
  if (!isNum(cut)) return { cut: null, list: [] };
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  const list = valid.filter((p) => p.date >= since && !(p.ads ?? []).some((a) => a.executed !== false) && stage(p).views >= cut).map((p) => ({ post: p, views: stage(p).views }));
  return { cut: Math.round(cut), list };
}

// ── One post: the step to fix first ─────────────────────────────────────────────────────────

/** The viewer's path through a post, in order; the first clearly weak step is the one to fix. */
export const FUNNEL = ['ctr', 'exit2s', 'retain5s', 'avgWatchRatio', 'completion', 'interactionRate'];

/**
 * What to improve on a post, from its D+1 numbers against the user's own records:
 *  - focus: the earliest funnel step clearly below the fixed median (a weak cover hides everything
 *    after it), with the level of the user's own top posts as the target and, for the cover, the
 *    views it would have brought at the same exposure;
 *  - ad findings: profile visits that did not turn into follows, an unusual ad audience.
 */
export function postFocus(post, posts, baseline) {
  const d = stage(post);
  const items = [];
  if (!isNum(d.views) && !isNum(d.ctr)) return { items: [{ key: 'noData', vars: {} }], focus: null };
  const valid = ordered(posts).filter(isValid).filter((p) => p.id !== post.id);
  // "My best": the three valid posts with the most D+1 views.
  const top = [...valid].filter((p) => isNum(stage(p).views)).sort((a, b) => stage(b).views - stage(a).views).slice(0, 3);
  const topMed = (k) => median(top.map((p) => stage(p)[k]).filter(isNum));
  let focus = null;
  for (const k of FUNNEL) {
    const base = baseline?.medians?.[k];
    const rel = relDiff(d[k], base, METRIC[k].dir);
    if (isNum(rel) && rel < -METRIC[k].band) {
      focus = { key: k, now: d[k], base, top: topMed(k), rel };
      break;
    }
  }
  if (focus) {
    const vars = { now: focus.now, base: focus.base, top: focus.top, pct: Math.round(-focus.rel * 100) };
    // Cover: the same exposure at my usual click rate would have brought this many more views.
    if (focus.key === 'ctr' && isNum(d.exposure) && isNum(focus.base) && focus.base > d.ctr) vars.gain = Math.round(d.exposure * (focus.base - d.ctr));
    items.push({ key: `focus.${focus.key}`, vars, metric: focus.key });
  } else if (baseline) items.push({ key: 'focus.none', vars: {} });

  // The platform's own segment analysis: most viewers gone in the opening segment.
  const seg0 = (post.d1Meta?.segments ?? [])[0];
  if (seg0 && seg0.from === '00:00' && isNum(seg0.loss) && seg0.loss >= 0.5) {
    items.push({ key: 'segStart', vars: { p: Math.round(seg0.loss * 100), to: seg0.to, title: seg0.title || '–' } });
  }

  // Followers per 1,000 views against my median.
  const per1k = (p) => (isNum(stage(p).newFollowers) && stage(p).views > 0 ? (stage(p).newFollowers / stage(p).views) * 1000 : null);
  const mine = per1k(post);
  const med = median(valid.map(per1k).filter(isNum));
  if (isNum(mine) && isNum(med) && med > 0 && mine < med * 0.6) items.push({ key: 'followRate', vars: { now: Math.round(mine * 10) / 10, med: Math.round(med * 10) / 10 } });

  // Ads on this post: profile visits → follows, against all my orders.
  const allOrders = adOrders(posts).filter((o) => goalType(o.goal) === 'follow' && isNum(o.metrics.follows) && isNum(o.metrics.profileViews) && o.metrics.profileViews > 0);
  const conv = (o) => o.metrics.follows / o.metrics.profileViews;
  const medConv = median(allOrders.map(conv));
  const mineOrders = allOrders.filter((o) => o.links.some((l) => l.post.id === post.id) && !o.multi);
  for (const o of mineOrders) {
    if (isNum(medConv) && allOrders.length >= SOLID && conv(o) < medConv * 0.7) items.push({ key: 'profileConv', vars: { now: Math.round(conv(o) * 100), med: Math.round(medConv * 100), pv: o.metrics.profileViews, fo: o.metrics.follows } });
  }
  // Ad audience younger / older than usual (18–23 + under 18).
  const young = (a) => (a && isNum(a['18~23']) ? a['18~23'] + (a['18以下'] ?? 0) : null);
  const auds = adOrders(posts).map((o) => young(o.ad.audience?.age)).filter(isNum);
  const medYoung = median(auds);
  for (const o of mineOrders) {
    const y = young(o.ad.audience?.age);
    if (isNum(y) && isNum(medYoung) && auds.length >= SOLID && Math.abs(y - medYoung) >= 0.1) items.push({ key: y > medYoung ? 'youngAudience' : 'olderAudience', vars: { now: Math.round(y * 100), med: Math.round(medYoung * 100) } });
  }
  return { items, focus };
}


// ── Operations briefing: a few suggestions, most important first ────────────────────────────

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * The dashboard's briefing: what the latest posts say as a whole, what to fix first, how to run
 * ads, where followers come from, posting rhythm and data gaps. Each item: { key, tone, vars }.
 */
export function opsBrief(posts, baseline, { today = new Date().toISOString().slice(0, 10), window = 5, recent: given = null, experiments = [] } = {}) {
  const out = [];
  const valid = ordered(posts).filter(isValid).filter((p) => isNum(stage(p).views));
  // The same "recent posts" as the dashboard's own figures when given.
  const recent = (given ?? valid.slice(-window)).filter((p) => isNum(stage(p).views));
  if (baseline && recent.length >= 3) {
    // 1. The recent run against the fixed median, and the funnel step behind it.
    const views = median(recent.map((p) => stage(p).views));
    const rel = relDiff(views, baseline.medians.views, 1);
    if (isNum(rel) && Math.abs(rel) >= 0.2) out.push({ key: rel < 0 ? 'recentDown' : 'recentUp', tone: rel < 0 ? 'warn' : 'good', vars: { n: recent.length, views: Math.round(views), base: Math.round(baseline.medians.views), pct: Math.round(Math.abs(rel) * 100) } });
    for (const k of FUNNEL) {
      const vals = recent.map((p) => stage(p)[k]).filter(isNum);
      if (vals.length < 3) continue;
      const m = median(vals);
      const r = relDiff(m, baseline.medians[k], METRIC[k].dir);
      const below = vals.filter((v) => relDiff(v, baseline.medians[k], METRIC[k].dir) < 0).length;
      if (isNum(r) && r < -METRIC[k].band && below >= Math.ceil(vals.length * 0.6)) {
        const best = [...valid].filter((p) => isNum(stage(p)[k])).sort((a, b) => (stage(b)[k] - stage(a)[k]) * METRIC[k].dir)[0];
        out.push({ key: `weak.${k}`, tone: 'warn', metric: k, vars: { now: m, base: baseline.medians[k], below, n: vals.length, best: best?.title ?? '', bestV: best ? stage(best)[k] : null, bestId: best?.id ?? '' } });
        break; // the earliest weak step: what comes after it cannot be judged fairly
      }
    }
  }
  // 2. Ads: the rule the user's own orders support, and the price trend.
  const ins = adInsights(posts);
  const cut = ins.find((x) => x.key === 'naturalCut');
  if (cut) out.push({ key: cut.vars.highWins ? 'adOnlyStrong' : 'adCutUnclear', tone: 'info', vars: cut.vars, ref: cut.ref });
  const goal = ins.find((x) => x.key === 'goalForFollowers');
  if (goal) out.push({ key: 'adGoal', tone: 'info', vars: goal.vars, ref: goal.ref });
  const trend = ins.find((x) => x.key === 'trendUp');
  if (trend) out.push({ key: 'adTrendUp', tone: 'warn', vars: trend.vars });
  // 3. Where followers come from.
  const split = ins.find((x) => x.key === 'followerSplit');
  if (split && split.vars.share >= 50) out.push({ key: 'dependOnAds', tone: 'warn', vars: split.vars });
  // 3b. An experiment that clearly paid off (two options with enough posts, nothing else changed).
  const exp = experimentResults(posts, experiments).filter((r) => r.verdict?.clear && !r.verdict.mixed).sort((a, b) => b.verdict.rel - a.verdict.rel)[0];
  if (exp) out.push({ key: 'expWin', tone: 'good', ref: exp.verdict.ref, metric: exp.metric, vars: { name: exp.name, best: exp.verdict.best, worst: exp.verdict.worst, m: METRIC[exp.metric].zh, pct: Math.round(exp.verdict.rel * 100) } });
  // 3c. Traffic channels: which feed brings views, what experiments did to the opening's hold.
  for (const x of channelBrief(posts, experiments)) out.push({ ...x, key: `ch.${x.key}` });
  // 4. Posting rhythm.
  const dates = ordered(posts).map((p) => p.date).filter(Boolean);
  if (dates.length >= 4) {
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d)).filter((g) => g >= 0);
    const usual = median(gaps);
    const since = daysBetween(dates.at(-1), today);
    if (isNum(usual) && usual > 0 && since > Math.max(usual * 1.5, usual + 3)) out.push({ key: 'gap', tone: 'warn', vars: { since, usual: Math.round(usual), last: dates.at(-1) } });
  }
  // 5. Data that would make the next comparisons possible.
  const untyped = valid.filter((p) => !p.contentType).length;
  if (valid.length >= 6 && untyped >= valid.length * 0.8) out.push({ key: 'setTypes', tone: 'info', vars: { n: untyped } });
  const noReport = adOrders(posts).filter((o) => !isNum(o.metrics.reads)).length;
  if (noReport) out.push({ key: 'noReport', tone: 'info', vars: { n: noReport } });
  return out.slice(0, 6);
}

// ── Experiments: what was tried on purpose, compared over posts ─────────────────────────────

/**
 * For each experiment item and each metric it is meant to move: the median per option over valid
 * posts with D+1 data. A comparison is made with at least MIN posts on two options; under SOLID it
 * is a reference. `mixed`: the posts compared also differ in another experiment item, so the
 * difference cannot be put on this one alone.
 */
export function experimentResults(posts, experiments) {
  const valid = ordered(posts).filter(isValid);
  const out = [];
  for (const ex of experiments ?? []) {
    const tagged = valid.filter((p) => p.experiments?.[ex.id]);
    const groups = ex.options.map((opt) => ({ opt, posts: tagged.filter((p) => p.experiments[ex.id] === opt) }));
    for (const k of ex.metrics.filter((m) => METRIC[m])) {
      const g = groups.map((x) => ({ opt: x.opt, n: x.posts.filter((p) => isNum(stage(p)[k])).length, med: median(x.posts.map((p) => stage(p)[k]).filter(isNum)) }));
      const ready = g.filter((x) => x.n >= MIN);
      let verdict = null;
      if (ready.length >= 2) {
        ready.sort((a, b) => (b.med - a.med) * METRIC[k].dir);
        const best = ready[0];
        const worst = ready.at(-1);
        const rel = relDiff(best.med, worst.med, METRIC[k].dir);
        const others = (experiments ?? []).filter((o) => o.id !== ex.id);
        const of = (opt) => tagged.filter((p) => p.experiments[ex.id] === opt);
        // Only items recorded on both sides count: not recording an item is not a change.
        const mixed = others.some((o) => {
          const a = new Set(of(best.opt).map((p) => p.experiments?.[o.id]).filter(Boolean));
          const b = new Set(of(worst.opt).map((p) => p.experiments?.[o.id]).filter(Boolean));
          return a.size > 0 && b.size > 0 && ([...a].some((x) => !b.has(x)) || [...b].some((x) => !a.has(x)));
        });
        verdict = { best: best.opt, worst: worst.opt, rel, mixed, ref: Math.min(best.n, worst.n) < SOLID, clear: isNum(rel) && rel >= 0.1 };
      }
      out.push({ id: ex.id, name: ex.name, metric: k, groups: g, verdict });
    }
  }
  return out;
}
