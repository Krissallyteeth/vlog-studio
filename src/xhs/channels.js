import { isValid, median, ordered, relDiff, stage } from './stats.js';

/*
 * Traffic channels (流量分析 → 此渠道详细数据): how a post did in each place people met it.
 *  - 首页推荐 (home): people see the cover and tap it → 转化率 is the cover's pull.
 *  - 视频推荐 (videoRec): the video plays by itself, no cover → watch time is the opening's hold.
 *  - 搜索 (search): people came by a word → its share is what the title/keywords bring.
 * Rule-based; comparisons with the user's own past posts need MIN of them, else only the
 * channels of the same post are compared with each other.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const MIN = 2;
const SOLID = 3;
const r1 = (v) => Math.round(v * 10) / 10;
const pct = (v) => `${r1(v * 100)}%`;
const metaOf = (p, which = 'd1') => p?.[`${which}Meta`] ?? null;
const chOf = (p, which = 'd1') => metaOf(p, which)?.channels ?? {};

/** What one post's channels say (each item: { key, tone, vars }). */
export function channelFindings(post, posts = [], which = 'd1') {
  const meta = metaOf(post, which);
  const c = meta?.channels ?? {};
  const out = [];
  const vr = c.videoRec ?? {};
  const home = c.home ?? {};
  const others = ordered(posts).filter((p) => p.id !== post.id && isValid(p));
  const mine = (f) => {
    const xs = others.map(f).filter(isNum);
    return xs.length >= MIN ? { v: median(xs), n: xs.length } : null;
  };
  // 1. The opening: videoRec plays without a cover, so its watch time is the first seconds' hold.
  if (isNum(vr.avgWatch) && isNum(home.avgWatch) && home.avgWatch > 0) {
    const reacts = [vr.likes, vr.comments, vr.favs].filter(isNum).reduce((a, b) => a + b, 0);
    if (vr.avgWatch < home.avgWatch * 0.5) out.push({ key: 'vrShort', tone: 'warn', vars: { vr: r1(vr.avgWatch), home: r1(home.avgWatch), reacts } });
    else if (vr.avgWatch >= home.avgWatch * 0.8) out.push({ key: 'vrHolds', tone: 'good', vars: { vr: r1(vr.avgWatch), home: r1(home.avgWatch) } });
  }
  const pastVr = mine((p) => chOf(p, which).videoRec?.avgWatch);
  if (isNum(vr.avgWatch) && pastVr) {
    const rel = relDiff(vr.avgWatch, pastVr.v, 1);
    if (rel <= -0.2) out.push({ key: 'vrBelowMine', tone: 'warn', ref: pastVr.n < SOLID, vars: { now: r1(vr.avgWatch), mine: r1(pastVr.v), n: pastVr.n } });
    else if (rel >= 0.2) out.push({ key: 'vrAboveMine', tone: 'good', ref: pastVr.n < SOLID, vars: { now: r1(vr.avgWatch), mine: r1(pastVr.v), n: pastVr.n } });
  }
  // 2. The cover: home feed 转化率 against my own past home feeds.
  const pastConv = mine((p) => chOf(p, which).home?.conv);
  if (isNum(home.conv) && pastConv) {
    const rel = relDiff(home.conv, pastConv.v, 1);
    if (rel <= -0.1) out.push({ key: 'homeConvLow', tone: 'warn', ref: pastConv.n < SOLID, vars: { now: pct(home.conv), mine: pct(pastConv.v), n: pastConv.n } });
    else if (rel >= 0.1) out.push({ key: 'homeConvHigh', tone: 'good', ref: pastConv.n < SOLID, vars: { now: pct(home.conv), mine: pct(pastConv.v), n: pastConv.n } });
  }
  // 3. Search: what the title and keywords bring, against my usual share.
  const share = meta?.sources?.search;
  const pastSearch = mine((p) => metaOf(p, which)?.sources?.search);
  if (isNum(share) && pastSearch && pastSearch.v > 0 && share < pastSearch.v * 0.5) out.push({ key: 'searchLow', tone: 'info', ref: pastSearch.n < SOLID, vars: { now: pct(share), mine: pct(pastSearch.v), n: pastSearch.n } });
  return out;
}

/** Over posts: does a bigger 视频推荐 share go with more views, and what experiments did to it. */
export function channelBrief(posts, experiments = []) {
  const out = [];
  const valid = ordered(posts).filter(isValid);
  const withShare = valid.filter((p) => isNum(p.d1Meta?.sources?.videoRec) && isNum(stage(p).views));
  if (withShare.length >= MIN * 2) {
    const cut = median(withShare.map((p) => p.d1Meta.sources.videoRec));
    const hi = withShare.filter((p) => p.d1Meta.sources.videoRec >= cut);
    const lo = withShare.filter((p) => p.d1Meta.sources.videoRec < cut);
    if (hi.length >= MIN && lo.length >= MIN) {
      const a = median(hi.map((p) => stage(p).views));
      const b = median(lo.map((p) => stage(p).views));
      const ref = Math.min(hi.length, lo.length) < SOLID;
      if (b > 0 && a >= b * 1.2) out.push({ key: 'mixVr', tone: 'good', ref, vars: { cut: pct(cut), hi: Math.round(a), lo: Math.round(b), nHi: hi.length, nLo: lo.length } });
      else if (a > 0 && b >= a * 1.2) out.push({ key: 'mixHome', tone: 'info', ref, vars: { cut: pct(cut), hi: Math.round(a), lo: Math.round(b), nHi: hi.length, nLo: lo.length } });
    }
  }
  // An experiment item against the opening's hold in 视频推荐 (where no cover helps).
  for (const ex of experiments ?? []) {
    const groups = ex.options
      .map((opt) => {
        const xs = valid.filter((p) => p.experiments?.[ex.id] === opt).map((p) => p.d1Meta?.channels?.videoRec?.avgWatch).filter(isNum);
        return { opt, n: xs.length, med: xs.length ? median(xs) : null };
      })
      .filter((g) => g.n >= MIN)
      .sort((x, y) => y.med - x.med);
    if (groups.length < 2) continue;
    const [best, worst] = [groups[0], groups.at(-1)];
    if (worst.med > 0 && best.med >= worst.med * 1.2) out.push({ key: 'expVr', tone: 'good', ref: Math.min(best.n, worst.n) < SOLID, vars: { name: ex.name, best: best.opt, worst: worst.opt, a: r1(best.med), b: r1(worst.med) } });
  }
  return out;
}
