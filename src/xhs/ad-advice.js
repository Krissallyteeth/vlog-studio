import { adOrders, goalType } from './ad-report.js';
import { METRIC } from './metrics.js';
import { isValid, median, ordered, relDiff, stage } from './stats.js';
import { stageDay } from './store.js';

/*
 * Should this post get an ad — after D+1, after D+2 — and how did the actual decision turn out?
 * Each judgement uses only what was known then: posts published before this one and the ads
 * started before the decision day. So old posts show what the app would have said at the time,
 * and the rules move as records grow. Rule-based, no AI; every cut-off comes from the user's data.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const MIN = 2;
const day = (s, add = 0) => new Date(Date.parse(`${s}T00:00:00Z`) + add * 86400000).toISOString().slice(0, 10);
const sum = (xs, f) => xs.reduce((a, x) => a + (isNum(f(x)) ? f(x) : 0), 0);
const perFollow = (list) => {
  const f = sum(list, (o) => o.metrics.follows);
  return f > 0 ? sum(list, (o) => o.spend) / f : null;
};

/** What the app says at D+1 ('d1') or D+2 ('d2'): { verdict: go|hold|skip|unknown, reasons, expect }. */
export function adviceAt(post, posts, baseline, which = 'd1') {
  const d = stage(post, which);
  if (!isNum(d.views) || !post.date) return null;
  const decideOn = day(post.date, which === 'd1' ? 1 : 2);
  const before = ordered(posts).filter((p) => p.id !== post.id && p.date && p.date < post.date && isValid(p));
  const views = (p) => stage(p, which).views;
  const medView = median(before.map(views).filter(isNum));
  if (!isNum(medView) || before.length < 3) return { verdict: 'unknown', reasons: [{ key: 'fewPosts', vars: { n: before.length } }], expect: null, decideOn };
  const reasons = [];
  let score = 0;
  // 1. Natural views at this point against my usual level.
  const rel = relDiff(d.views, medView, 1);
  score += d.views >= medView ? 1 : -1;
  reasons.push({ key: d.views >= medView ? 'viewsHigh' : 'viewsLow', vars: { v: d.views, med: Math.round(medView), pct: Math.round(Math.abs(rel) * 100) } });
  // 2. The cover: an ad buys exposure; a cover people do not click wastes it.
  const ctrRel = relDiff(d.ctr, baseline?.medians?.ctr, METRIC.ctr.dir);
  if (isNum(ctrRel) && ctrRel < -METRIC.ctr.band) {
    score -= 0.5;
    reasons.push({ key: 'ctrWeak', vars: { v: d.ctr, base: baseline.medians.ctr } });
  }
  // 3. D+2: is the post still growing on its own (D+1 → D+2 views) compared with my usual growth?
  if (which === 'd2') {
    const g = (p) => (isNum(stage(p, 'd2').views) && stage(p, 'd1').views > 0 ? stage(p, 'd2').views / stage(p, 'd1').views : null);
    const mine = g(post);
    const usual = median(before.map(g).filter(isNum));
    if (isNum(mine) && isNum(usual) && usual > 0) {
      const up = mine >= usual * 1.3;
      const down = mine <= usual * 0.8;
      if (up) score += 1;
      if (down) score -= 0.5;
      if (up || down) reasons.push({ key: up ? 'growing' : 'stalling', vars: { now: Math.round(mine * 100) / 100, usual: Math.round(usual * 100) / 100 } });
    }
  }
  // 4. What my own follower ads cost on posts like this one (same side of my median views).
  const orders = adOrders(posts.filter((p) => p.id !== post.id)).filter((o) => o.date && o.date < decideOn && goalType(o.goal) === 'follow' && isNum(o.metrics.follows) && !o.multi);
  const side = orders.filter((o) => isNum(views(o.links[0].post)) && (views(o.links[0].post) >= medView) === (d.views >= medView));
  const all = perFollow(orders);
  const expect = side.length >= MIN ? { cost: Math.round(perFollow(side) * 100) / 100, n: side.length, all: isNum(all) ? Math.round(all * 100) / 100 : null } : null;
  if (expect && isNum(all)) {
    if (expect.cost <= all * 0.9) score += 0.5;
    if (expect.cost >= all * 1.3) score -= 0.5;
    reasons.push({ key: 'expect', vars: { cost: expect.cost, n: expect.n, all: expect.all } });
  }
  const verdict = score >= 1 ? 'go' : score <= -1 ? 'skip' : 'hold';
  return { verdict, reasons, expect, decideOn };
}

/**
 * The whole story of a post's ad: D+1 and D+2 advice, what was done, how it turned out.
 * final.key: followed | against | ranBeforeAdvice | notRun | notYet; final.outcome: good | mid | bad | unknown.
 */
export function adTimeline(post, posts, baseline, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const d1 = adviceAt(post, posts, baseline, 'd1');
  const d2 = adviceAt(post, posts, baseline, 'd2');
  const ads = (post.ads ?? []).filter((a) => a.executed !== false).sort((a, b) => (stageDay(a.stage) ?? 99) - (stageDay(b.stage) ?? 99));
  const first = ads[0];
  const fol = ads.filter((a) => goalType(a.goal) === 'follow' && isNum(a.order?.follows));
  const f = sum(fol, (a) => a.order.follows * (isNum(a.share) ? a.share : 1));
  const actual = f > 0 ? Math.round((sum(fol, (a) => a.spend) / f) * 100) / 100 : null;
  // My usual price of a follower when the ad was run (orders before it).
  const firstDay = first?.start?.slice(0, 10) || (post.date && first ? day(post.date, stageDay(first.stage) ?? 1) : '');
  const usual = perFollow(adOrders(posts.filter((p) => p.id !== post.id)).filter((o) => o.date && o.date < (firstDay || '9999') && goalType(o.goal) === 'follow' && isNum(o.metrics.follows)));
  const outcome = !isNum(actual) || !isNum(usual) ? 'unknown' : actual <= usual * 1.05 ? 'good' : actual >= usual * 1.3 ? 'bad' : 'mid';
  let key;
  let advised = null;
  if (!first) key = post.date && today >= day(post.date, 3) ? 'notRun' : 'notYet';
  else {
    const n = stageDay(first.stage);
    advised = n === 1 ? d1 : n >= 2 ? d2 ?? d1 : null;
    key = !advised || advised.verdict === 'unknown' ? 'ranBeforeAdvice' : advised.verdict === 'skip' ? 'against' : 'followed';
  }
  return { d1, d2, ad: first ? { stage: first.stage, spend: sum(ads, (a) => a.spend), perFollow: actual, usual: isNum(usual) ? Math.round(usual * 100) / 100 : null } : null, final: { key, outcome, advised: advised?.verdict ?? null } };
}

/** Over all posts: how decisions and advice turned out (to learn whether the advice is worth following). */
export function adviceRecord(posts, baseline, opts) {
  const rows = ordered(posts).filter((p) => p.date).map((p) => ({ post: p, tl: adTimeline(p, posts, baseline, opts) }));
  const group = (k) => rows.filter((r) => r.tl.final.key === k);
  const cost = (list) => {
    const xs = list.map((r) => r.tl.ad?.perFollow).filter(isNum);
    return xs.length ? Math.round(median(xs) * 100) / 100 : null;
  };
  return {
    rows,
    followed: { n: group('followed').length, cost: cost(group('followed')), good: group('followed').filter((r) => r.tl.final.outcome === 'good').length },
    against: { n: group('against').length, cost: cost(group('against')), good: group('against').filter((r) => r.tl.final.outcome === 'good').length },
    notRun: group('notRun').length,
    pending: rows.filter((r) => r.tl.final.key === 'notYet' && (r.tl.d2 ?? r.tl.d1)),
  };
}
