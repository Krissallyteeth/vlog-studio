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
 * note order; stage: typed D+n (single-note orders only). Returns [{ postId, ad }].
 */
export function orderAds({ values: v, postIds, posts, stage = '', audience = null }) {
  const ids = postIds.filter(Boolean);
  const n = ids.length;
  const groupKey = n > 1 ? v.orderNo || uid() : '';
  return ids.map((postId) => {
    const post = posts.find((p) => p.id === postId);
    const auto = stageFromDates(post?.date, v.startedAt);
    return {
      postId,
      ad: normalizeAd({
        stage: (n === 1 && normalizeStage(stage)) || auto,
        start: v.startedAt ?? '',
        executed: true,
        spend: v.spend == null ? null : n > 1 ? round2(v.spend / n) : v.spend,
        orderSpend: n > 1 ? v.spend : null,
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
  for (const { postId, ad } of entries) {
    const p = posts.find((x) => x.id === postId);
    if (!p) continue;
    // A record typed or imported from the workbook memo ("진행(60元)") for the same D+n and amount
    // is this order without its report: the screenshot data takes its place.
    const memo = p.ads.findIndex((a) => isMemoOf(a, ad));
    if (memo >= 0) p.ads[memo] = { ...ad, id: p.ads[memo].id, sourceText: p.ads[memo].sourceText, memo: p.ads[memo].memo || ad.memo };
    else p.ads.push(ad);
    changed.add(p);
  }
  return [...changed];
}

/** A record without order number or report numbers, same D+n and same amount as the order. */
function isMemoOf(a, ad) {
  const noReport = !a.orderNo && !Object.values(a.order ?? {}).some((v) => typeof v === 'number');
  return noReport && a.executed !== false && !!a.stage && a.stage === ad.stage && a.spend === ad.spend;
}

/** Remembers the title a post had in a screenshot so the next order matches by itself. */
export function rememberTitle(post, title) {
  const tt = String(title ?? '').trim();
  if (!tt || tt === post.title || (post.adTitles ?? []).includes(tt)) return false;
  post.adTitles = [...(post.adTitles ?? []), tt].slice(-10);
  return true;
}
