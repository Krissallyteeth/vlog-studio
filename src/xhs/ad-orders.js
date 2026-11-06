import { uid } from '../lib/ids.js';
import { AD_METRICS } from './ocr-ad-parse.js';
import { normalizeAd, normalizeStage, stageDay, stageFromDates } from './store.js';

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
/** A note slot of a multi-note order whose post is not in the app (published before records began). */
export const LATER = '@later';

export function orderAds({ values: v, postIds, posts, stage = '', audience = null, replace = undefined }) {
  const ids = postIds.filter((id) => id && id !== LATER);
  const later = postIds.filter((id) => id === LATER).length;
  // Notes outside the app still take their share: the order is split over all its notes, and
  // their part stays in the order total without going to any post.
  const n = ids.length + later;
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
        outsideNotes: later,
        noteText: later ? String(v.noteText ?? '').slice(0, 400) : '',
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
  // 实付 shown, else 订单金额 minus the discount used (优惠金额), else 订单金额.
  const paid = v.paid ?? (v.orderAmount != null && v.discount != null ? Math.round((v.orderAmount - v.discount) * 100) / 100 : v.orderAmount ?? null);
  if (consumed != null && paid != null && consumed > paid) return { money: paid, credit: Math.round((consumed - paid) * 100) / 100 };
  return { money: consumed, credit: null };
}

/**
 * Real money from the memo when the screenshots do not show it: the workbook memo ("진행(60元)")
 * records what was paid, so a larger consumed amount (95) is that money plus platform credit (35).
 * null when the screenshots show 实付/订单金额, or the memo does not explain the difference.
 */
export function memoMoney(memo, ad) {
  if (!memo || ad.paid != null || ad.orderAmount != null) return null;
  const consumed = (ad.spend ?? 0) + (ad.credit ?? 0);
  if (!(typeof memo.spend === 'number' && memo.spend > 0 && consumed > memo.spend)) return null;
  return { spend: memo.spend, credit: Math.round((consumed - memo.spend) * 100) / 100 };
}

/**
 * Amounts a memo may have written down for this order: this note's share, or (multi-note) the
 * whole order's real money, real money + credit, or order amount.
 */
export function orderAmounts(ad) {
  const r = (x) => Math.round(x * 100) / 100;
  const out = [ad.spend, ad.credit != null && ad.spend != null ? r(ad.spend + ad.credit) : null, ...wholeOrderAmounts(ad)];
  return out.filter((x) => typeof x === 'number' && x > 0);
}

/** A multi-note order's own totals (real money, money + credit, order amount); none for one note. */
export function wholeOrderAmounts(ad) {
  if (!ad.groupKey) return [];
  const r = (x) => Math.round(x * 100) / 100;
  const out = [ad.orderSpend, ad.paid, ad.orderAmount];
  if (ad.orderSpend != null && ad.credit != null) out.push(r(ad.orderSpend + ad.credit * (ad.noteCount || 1)));
  return out.filter((x) => typeof x === 'number' && x > 0);
}

const nearStage = (a, b) => {
  const x = stageDay(a);
  const y = stageDay(b);
  return x != null && y != null && Math.abs(x - y) <= 1;
};

/**
 * A memo record that is already covered by an order report on the same post (same amount, D+n the
 * same or a day off): the memo was written before the screenshots were added and is now a double.
 */
export function memoDuplicateOf(post, memo) {
  if (!memoAds(post).includes(memo) || typeof memo.spend !== 'number') return null;
  const reports = (post.ads ?? []).filter((a) => a !== memo && (a.orderNo || Object.values(a.order ?? {}).some((x) => typeof x === 'number')));
  const hits = reports.filter((a) => (a.stage === memo.stage && orderAmounts(a).includes(memo.spend)) || (nearStage(a.stage, memo.stage) && wholeOrderAmounts(a).includes(memo.spend)));
  return hits.length === 1 ? hits[0] : null;
}

/** Records on a post that only come from a memo / manual entry (no order number, no report numbers). */
export const memoAds = (post) => (post?.ads ?? []).filter((a) => a.executed !== false && !a.orderNo && !Object.values(a.order ?? {}).some((x) => typeof x === 'number'));

/**
 * The memo record an order most likely replaces: the one with the same D+n; a memo without a D+n
 * only when it is the single one with the same amount. A memo with a different D+n is a different
 * ad (e.g. memo D+1 60元 and order D+10 60元) and is never picked automatically.
 */
export function memoToReplace(post, ad) {
  const memos = memoAds(post);
  const amounts = orderAmounts(ad);
  const sameStage = memos.find((a) => a.stage && a.stage === ad.stage);
  if (sameStage) return sameStage;
  // Multi-note order: a memo of the whole order's money (not a note's share) a day off (the order
  // placed early the next morning) is this order. Single notes keep the exact D+n: a D+1 and a D+2
  // memo of 60元 each are usually two ads.
  if (ad.groupKey) {
    const near = memos.filter((a) => nearStage(a.stage, ad.stage) && wholeOrderAmounts(ad).includes(a.spend));
    if (near.length === 1) return near[0];
  }
  // No start time in the screenshots (details not expanded): the post's only memo is this ad.
  if (!ad.stage && memos.length === 1) return memos[0];
  const noStage = memos.filter((a) => !a.stage && amounts.includes(a.spend));
  return noStage.length === 1 ? noStage[0] : null;
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
    if (memo >= 0) {
      // Without a start time the memo's D+n stands; without 实付 the memo's amount is the real money.
      const money = ad.groupKey ? null : memoMoney(target, ad);
      p.ads[memo] = { ...ad, ...(money ?? {}), stage: ad.stage || target.stage, id: target.id, sourceText: target.sourceText, memo: target.memo || ad.memo };
    }
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

/**
 * Neighbouring screenshot groups that show the same note (same publish time, to the second) and no
 * conflicting values are one order captured twice — e.g. once collapsed and once with "展开详情"
 * expanded. Two real orders on the same note differ in order number or report numbers and stay apart.
 */
export function mergeOrderGroups(groups, fieldsOf) {
  const out = [];
  for (const g of groups) {
    const prev = out.at(-1);
    if (prev && sameOrderGroup(fieldsOf(prev), fieldsOf(g))) out[out.length - 1] = [...prev, ...g];
    else out.push(g);
  }
  return out;
}
const CONFLICT_KEYS = ['orderNo', 'startedAt', 'exposure', 'reads', 'likes', 'favorites', 'comments', 'follows', 'result', 'noteCount'];
export function sameOrderGroup(a, b) {
  const pub = (f) => f.publishedAt?.text?.match(/\d{2}:\d{2}:\d{2}/)?.[0] && `${(f.publishedAt.value ?? f.publishedAt.candidate ?? '').slice(0, 10)} ${f.publishedAt.text.match(/\d{2}:\d{2}:\d{2}/)[0]}`;
  const ok = (f, k) => (f[k]?.status === 'ok' ? JSON.stringify(f[k].value) : null);
  // Same order when it is the same note (publish time to the second), or — for orders promoting
  // several notes, which show no publish time — the same order number or the same order time.
  const same = (x, y) => x != null && x === y;
  if (!(same(pub(a), pub(b)) || same(ok(a, 'orderNo'), ok(b, 'orderNo')) || same(ok(a, 'startedAt'), ok(b, 'startedAt')))) return false;
  const v = (f, k) => (f[k]?.status === 'ok' ? JSON.stringify(f[k].value) : null);
  return CONFLICT_KEYS.every((k) => v(a, k) == null || v(b, k) == null || v(a, k) === v(b, k));
}
