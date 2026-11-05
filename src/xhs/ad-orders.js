import { uid } from '../lib/ids.js';
import { AD_METRICS } from './ocr-ad-parse.js';
import { normalizeAd, normalizeStage, stageFromDates } from './store.js';

/*
 * Turning one recognised 薯条 order into ad records. Pure (no storage), so it can be tested.
 *
 * One order can promote several notes. It is stored on every linked post with the same groupKey;
 * each copy carries the whole order's spend (orderSpend) and this post's estimated share
 * (spend = orderSpend / number of notes, allocation "equal") — the app only splits evenly, because
 * the order report does not show a per-note breakdown. Totals count a group once.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * values: recognised / typed fields (spend, startedAt, orderNo …); postIds: the linked posts in
 * note order; stage: typed D+n (single-note orders only). Returns [{ postId, ad, replace }].
 */
export function orderAds({ values: v, postIds, posts, stage = '', audience = null, replace = undefined }) {
  const ids = postIds.filter(Boolean);
  const n = ids.length;
  const groupKey = n > 1 ? v.orderNo || uid() : '';
  const { money, credit } = splitMoney(v);
  return ids.map((postId) => {
    const post = posts.find((p) => p.id === postId);
    // A single note's publish time from the screenshot beats the workbook date (it can be a day off).
    const published = n === 1 && v.publishedAt ? v.publishedAt : post?.date;
    const auto = stageFromDates(published, v.startedAt);
    return {
      postId,
      // Memo record to replace: an id, '' = replace none, undefined = the most likely one.
      replace: n === 1 ? replace : undefined,
      ad: normalizeAd({
        stage: (n === 1 && normalizeStage(stage)) || auto,
        start: v.startedAt ?? '',
        executed: true,
        spend: money == null ? null : n > 1 ? round2(money / n) : money,
        credit: credit == null ? null : n > 1 ? round2(credit / n) : credit,
        orderSpend: n > 1 ? money : null,
        share: 1 / n,
        allocation: n > 1 ? 'equal' : 'single',
        noteCount: n,
        groupKey,
        budget: v.budget,
        hours: v.duration,
        goal: v.goal ?? '',
        status: v.status ?? '',
        goalResult: v.result,
        estimate: v.estimate,
        beatPct: v.beatPct,
        bonus: v.bonus,
        costPerResult: v.costPerResult,
        orderNo: v.orderNo ?? '',
        orderAmount: v.orderAmount,
        paid: v.paid,
        payMethod: v.payMethod ?? '',
        targeting: v.targeting ?? '',
        coupon: v.coupon ? { ...v.coupon, expires: v.couponExpires ?? '' } : null,
        order: Object.fromEntries(AD_METRICS.map(([k]) => [k, v[k] ?? null])),
        audience,
        noteTitle: n === 1 ? v.title ?? '' : '',
        notePublishedAt: n === 1 ? v.publishedAt ?? '' : '',
      }),
    };
  });
}

/**
 * Real money vs bonus credit. "已消耗 85/85" with 订单金额 / 实付金额 60 means 25元 came from a bonus
 * credit: the real ad spend is 60 and the credit 25. Without the paid amount, the consumed amount is
 * the spend.
 */
export function splitMoney(v) {
  const consumed = v.spend ?? null;
  const paid = v.paid ?? v.orderAmount ?? null;
  if (consumed != null && paid != null && consumed > paid) return { money: paid, credit: Math.round((consumed - paid) * 100) / 100 };
  return { money: consumed, credit: null };
}

/** Records on a post that only come from a memo / manual entry (no order number, no report numbers). */
export const memoAds = (post) => (post?.ads ?? []).filter((a) => a.executed !== false && !a.orderNo && !Object.values(a.order ?? {}).some((x) => typeof x === 'number'));

/** The memo record an order most likely replaces: same D+n; otherwise the only memo with the same amount. */
export function memoToReplace(post, ad) {
  const memos = memoAds(post);
  const amounts = [ad.spend, ad.credit != null ? ad.spend + ad.credit : null].filter((x) => x != null);
  return memos.find((a) => a.stage && a.stage === ad.stage) ?? (memos.filter((a) => amounts.includes(a.spend)).length === 1 ? memos.find((a) => amounts.includes(a.spend)) : null) ?? null;
}

/** True when two ad records describe the same 薯条 order. */
export function sameOrder(a, b) {
  if (a.orderNo && b.orderNo) return a.orderNo === b.orderNo;
  if (a.groupKey && b.groupKey) return a.groupKey === b.groupKey;
  // No order number on one side (older records): same start, spend and report numbers.
  const same = (x, y) => x != null && x === y;
  return (a.start || '') === (b.start || '') && same(a.orderSpend ?? a.spend, b.orderSpend ?? b.spend) && same(a.order?.exposure, b.order?.exposure);
}

/**
 * Puts an order's records on their posts. The same order already stored anywhere (also on a post
 * it no longer belongs to) is replaced, never duplicated. Mutates the given posts; returns the
 * ones that changed.
 */
export function placeOrder(posts, entries) {
  const changed = new Set();
  const probe = entries[0]?.ad;
  if (!probe) return [];
  for (const p of posts) {
    const keep = p.ads.filter((a) => !sameOrder(a, probe));
    if (keep.length !== p.ads.length) {
      p.ads = keep;
      changed.add(p);
    }
  }
  for (const { postId, ad, replace } of entries) {
    const p = posts.find((x) => x.id === postId);
    if (!p) continue;
    // A record typed or imported from the workbook memo ("진행(60元)") is this order without its
    // report: the screenshot data takes its place. `replace` = the id chosen on the review screen
    // ('' = keep both); not given = the most likely memo (same D+n, or the only one with that amount).
    const target = replace === undefined ? memoToReplace(p, ad) : memoAds(p).find((a) => a.id === replace);
    const memo = target ? p.ads.indexOf(target) : -1;
    if (memo >= 0) p.ads[memo] = { ...ad, id: target.id, sourceText: target.sourceText, memo: target.memo || ad.memo };
    else p.ads.push(ad);
    changed.add(p);
  }
  return [...changed];
}

/** Remembers the title a post had in a screenshot so the next order matches by itself. */
export function rememberTitle(post, title) {
  const tt = String(title ?? '').trim();
  if (!tt || tt === post.title || (post.adTitles ?? []).includes(tt)) return false;
  post.adTitles = [...(post.adTitles ?? []), tt].slice(-10);
  return true;
}
