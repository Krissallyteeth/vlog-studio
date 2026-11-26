import { adOrders, goalType } from './ad-report.js';
import { median } from './stats.js';

/*
 * Promotion simulator for 关注 (follower) 薯条 orders, from my own past orders only.
 *
 * Each past order gives a rate: followers per 元 the platform delivered (real spend + bonus
 * credit, because the credit also buys traffic). A planned order's followers are that rate ×
 * (spend + credit), shown as a range (lowest · median · highest past rate). The real cost per
 * follower uses real spend only, as everywhere in the app. A simple proportional model: it
 * assumes results grow in step with money, which is not guaranteed.
 */

export const MIN_ORDERS = 3; // fewer past orders than this: shown "for reference"
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);

/** Past follower orders with a known spend and follower result. */
export function followOrders(posts) {
  return adOrders(posts)
    .filter((o) => !o.ad.pending && goalType(o.goal) === 'follow' && isNum(o.spend) && o.spend > 0 && isNum(o.metrics.follows) && o.metrics.follows >= 0)
    .map((o) => {
      const credit = isNum(o.credit) && o.credit > 0 ? o.credit : 0;
      const delivered = o.spend + credit;
      return { key: o.key, date: o.date, spend: o.spend, credit, follows: o.metrics.follows, rate: o.metrics.follows / delivered, realCost: o.metrics.follows > 0 ? o.spend / o.metrics.follows : null };
    });
}

/** Past results in one place: per-follower real cost range and the follower rate range. */
export function followHistory(posts) {
  const orders = followOrders(posts);
  const rates = orders.map((o) => o.rate).sort((a, b) => a - b);
  const costs = orders.map((o) => o.realCost).filter(isNum).sort((a, b) => a - b);
  return {
    n: orders.length,
    reference: orders.length < MIN_ORDERS,
    zeroFollow: orders.filter((o) => o.follows === 0).length,
    rate: rates.length ? { min: rates[0], median: median(rates), max: rates.at(-1) } : null,
    cost: costs.length ? { min: costs[0], median: median(costs), max: costs.at(-1) } : null,
    spend: orders.length ? median(orders.map((o) => o.spend)) : null,
    orders,
  };
}

/**
 * A planned order. spend = real money, credit = bonus credit (赠送). Returns null without history
 * or without a positive amount. Followers are whole numbers (low rounded down, high rounded up).
 */
export function simulate(history, { spend, credit = 0 }) {
  const s = isNum(spend) && spend > 0 ? spend : null;
  const c = isNum(credit) && credit > 0 ? credit : 0;
  if (!history?.rate || s == null) return null;
  const total = s + c;
  const followers = {
    min: Math.floor(history.rate.min * total),
    median: Math.round(history.rate.median * total),
    max: Math.ceil(history.rate.max * total),
  };
  const per = (f) => (f > 0 ? round2(s / f) : null);
  return {
    total: round2(total),
    creditShare: c / total,
    followers,
    // Fewer followers means a higher real cost: the range is reversed.
    realCost: { best: per(followers.max), median: per(followers.median), worst: per(followers.min) },
    perTotal: followers.median > 0 ? round2(total / followers.median) : null,
  };
}

/* ── How good were the estimates? ─────────────────────────────────────────────────────────
 * For each past 关注 order: the platform's own estimate (预估转化, read from the order report),
 * and what this simulator would have said from the orders before it only (no hindsight),
 * against the actual result. The platform's estimate is about its goal result (粉丝关注量,
 * bonus included); the simulator works on 新增关注, so each is checked against its own number.
 */

const where = (actual, range) => (actual < range[0] ? 'below' : actual > range[1] ? 'above' : 'in');

function summarise(rows, pick) {
  const list = rows.map(pick).filter(Boolean);
  const ratios = list.map((x) => x.ratio).filter(isNum);
  return {
    n: list.length,
    in: list.filter((x) => x.where === 'in').length,
    below: list.filter((x) => x.where === 'below').length,
    above: list.filter((x) => x.where === 'above').length,
    ratio: ratios.length ? median(ratios) : null, // actual ÷ middle of the range
  };
}

export function estimateAccuracy(posts) {
  const all = adOrders(posts)
    .filter((o) => !o.ad.pending && goalType(o.goal) === 'follow' && isNum(o.spend) && o.spend > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const known = followOrders(posts);
  const rows = all.map((o) => {
    const est = Array.isArray(o.estimate) && o.estimate.length === 2 && o.estimate.every(isNum) ? o.estimate : null;
    const goalActual = isNum(o.goalResult) ? o.goalResult : isNum(o.metrics.follows) ? o.metrics.follows : null;
    const platform = est && isNum(goalActual) ? { range: est, actual: goalActual, where: where(goalActual, est), ratio: (est[0] + est[1]) / 2 > 0 ? goalActual / ((est[0] + est[1]) / 2) : null } : null;
    // The simulator from earlier orders only (orders on an unknown date are not "earlier").
    const earlier = known.filter((k) => k.key !== o.key && k.date && o.date && k.date < o.date);
    let sim = null;
    if (earlier.length && isNum(o.metrics.follows)) {
      const h = { rate: { min: Math.min(...earlier.map((k) => k.rate)), median: median(earlier.map((k) => k.rate)), max: Math.max(...earlier.map((k) => k.rate)) } };
      const r = simulate(h, { spend: o.spend, credit: isNum(o.credit) ? o.credit : 0 });
      if (r) sim = { range: [r.followers.min, r.followers.max], median: r.followers.median, actual: o.metrics.follows, where: where(o.metrics.follows, [r.followers.min, r.followers.max]), ratio: r.followers.median > 0 ? o.metrics.follows / r.followers.median : null, basedOn: earlier.length };
    }
    return { key: o.key, date: o.date, spend: o.spend, platform, sim };
  });
  return { rows, platform: summarise(rows, (r) => r.platform), sim: summarise(rows, (r) => r.sim) };
}

/**
 * A purchase-screen reading on a post, with what happened: the 关注 order of the same stage on that
 * post (if bought), and what this simulator said from the orders before that day.
 */
export function quoteOutcome(post, quote, posts) {
  const day = String(quote.capturedAt).slice(0, 10);
  const ad = (post.ads ?? []).find((a) => a.executed !== false && !a.pending && goalType(a.goal) === 'follow' && (!quote.stage || a.stage === quote.stage));
  const actual = ad ? (isNum(ad.goalResult) ? ad.goalResult : isNum(ad.order?.follows) ? ad.order.follows : null) : null;
  const earlier = followOrders(posts).filter((k) => k.date && day && k.date < day);
  const sim = earlier.length && isNum(quote.pay)
    ? simulate({ rate: { min: Math.min(...earlier.map((k) => k.rate)), median: median(earlier.map((k) => k.rate)), max: Math.max(...earlier.map((k) => k.rate)) } }, { spend: quote.pay, credit: quote.credit ?? 0 })
    : null;
  return {
    bought: !!ad,
    actual,
    where: isNum(actual) && quote.estimate ? where(actual, quote.estimate) : null,
    orderEstimate: ad?.estimate ?? null,
    sim: sim ? { range: [sim.followers.min, sim.followers.max], median: sim.followers.median, basedOn: earlier.length } : null,
  };
}
