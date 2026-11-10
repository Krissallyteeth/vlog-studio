import { orderEfficiency } from './analysis.js';
import { adOrders, goalType } from './ad-report.js';
import { median } from './stats.js';

/*
 * A comment on one ad (one 薯条 order), shown on its card: how the result compares with the
 * platform's own estimate, and how its price compares with the user's own earlier orders bought for
 * the same goal. Rule-based, observations only (not a cause or a forecast); every comparison needs
 * MIN earlier orders, and fewer than SOLID is marked as a reference.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const MIN = 2;
const SOLID = 3;
const r2 = (v) => Math.round(v * 100) / 100;
const BAND = 0.1; // within ±10% of the usual price counts as "about the same"
const UNIT = { likeFav: 'perLikeFav', follow: 'perFollow' };

/** Items { key, tone, vars, ref? } for the ad `ad` (as stored on a post). Empty without a report. */
export function adComment(ad, posts) {
  if (!ad || ad.executed === false) return [];
  const eff = orderEfficiency(ad);
  if (!eff.hasReport) return [];
  const out = [];
  const goal = goalType(ad.goal);
  // 1. The result against the platform's estimate for this order.
  const est = Array.isArray(ad.estimate) && ad.estimate.every(isNum) ? ad.estimate : null;
  if (isNum(ad.goalResult) && est) {
    const [lo, hi] = est;
    if (ad.goalResult > hi) out.push({ key: 'aboveEst', tone: 'good', vars: { r: ad.goalResult, lo, hi, over: ad.goalResult - hi } });
    else if (ad.goalResult < lo) out.push({ key: 'belowEst', tone: 'warn', vars: { r: ad.goalResult, lo, hi } });
    else out.push({ key: 'inEst', tone: 'info', vars: { r: ad.goalResult, lo, hi } });
  }
  // Earlier orders (started before this one), not this order itself.
  const me = ad.groupKey || ad.orderNo || ad.id;
  const day = (ad.start || '').slice(0, 10);
  const earlier = adOrders(posts).filter((o) => o.key !== me && o.ad.id !== ad.id && o.date && (!day || o.date < day));
  const past = (g, unit) => earlier.filter((o) => goalType(o.goal) === g).map((o) => orderEfficiency(o.ad)[unit]).filter(isNum);
  const compare = (key, cost, list, what) => {
    if (!isNum(cost)) return;
    if (list.length < MIN) return out.push({ key: 'fewSame', tone: 'info', vars: { what, cost: r2(cost), n: list.length } });
    const usual = median(list);
    const rel = cost / usual - 1;
    const tone = rel <= -BAND ? 'good' : rel >= BAND ? 'warn' : 'info';
    out.push({ key: rel <= -BAND ? `${key}Cheaper` : rel >= BAND ? `${key}Dearer` : `${key}Same`, tone, ref: list.length < SOLID, vars: { what, cost: r2(cost), usual: r2(usual), n: list.length, pct: Math.round(Math.abs(rel) * 100) } });
  };
  // 2. The price of what the order was bought for, against earlier orders with the same goal.
  if (UNIT[goal]) compare('unit', eff[UNIT[goal]], past(goal, UNIT[goal]), goal);
  // 3. A 点赞收藏 order also brings some followers: their price against 关注-goal orders, so the
  //    goal can be chosen by what is wanted.
  const follows = ad.order?.follows;
  const spend = isNum(ad.orderSpend) ? ad.orderSpend : ad.spend;
  if (goal === 'likeFav' && isNum(follows) && isNum(spend) && spend > 0) {
    const followPrices = past('follow', 'perFollow');
    if (followPrices.length >= MIN) {
      const per = follows > 0 ? r2(spend / follows) : null;
      out.push({ key: follows > 0 ? 'followsSide' : 'followsNone', tone: 'info', ref: followPrices.length < SOLID, vars: { f: follows, per, followUsual: r2(median(followPrices)), n: followPrices.length } });
    }
  }
  // 4. Without a goal price to compare, the common yardstick: cost per read across all orders.
  if (!out.some((x) => /^unit/.test(x.key)) && !UNIT[goal]) {
    const reads = earlier.map((o) => orderEfficiency(o.ad).perRead).filter(isNum);
    compare('read', eff.perRead, reads, 'read');
  }
  return out.slice(0, 3);
}
