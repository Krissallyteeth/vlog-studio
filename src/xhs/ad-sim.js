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
