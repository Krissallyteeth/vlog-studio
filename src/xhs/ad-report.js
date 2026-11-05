import { median, stage as stageOf } from './stats.js';
import { stageDay } from './store.js';

/*
 * 薯条 ad report: orders (a multi-note order counted once), totals per month / year, per post,
 * per D+n and per goal, plus rule-based comments. Everything is computed from stored records;
 * comments only compare groups that have enough orders and say so when they do not.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (list, f) => list.reduce((s, x) => s + (isNum(f(x)) ? f(x) : 0), 0);
const has = (list, f) => list.some((x) => isNum(f(x)));
const KEYS = ['exposure', 'reads', 'likes', 'favorites', 'comments', 'follows', 'profileViews', 'dmOpens'];
export const MIN_GROUP = 2; // orders per group before two groups are compared
export const MIN_ORDERS = 3; // orders before "best / worst" or hit-rate comments

/** One entry per 薯条 order. */
export function adOrders(posts) {
  const byKey = new Map();
  for (const p of posts) {
    for (const ad of p.ads ?? []) {
      if (ad.executed === false) continue;
      const key = ad.groupKey || ad.orderNo || `${p.id}:${ad.id}`;
      if (!byKey.has(key)) byKey.set(key, { key, ad, links: [] });
      byKey.get(key).links.push({ post: p, ad });
    }
  }
  return [...byKey.values()].map(({ key, ad, links }) => {
    const spend = isNum(ad.orderSpend) ? ad.orderSpend : sum(links, (l) => l.ad.spend) || (isNum(ad.spend) ? ad.spend : null);
    // Month of the order: its start time; without one, the latest linked post's date (estimated).
    const start = ad.start ? ad.start.slice(0, 10) : '';
    const fallback = links.map((l) => l.post.date).filter(Boolean).sort().at(-1) ?? '';
    const date = start || fallback;
    const m = Object.fromEntries(KEYS.map((k) => [k, isNum(ad.order?.[k]) ? ad.order[k] : null]));
    const likeFav = isNum(m.likes) || isNum(m.favorites) ? (m.likes ?? 0) + (m.favorites ?? 0) : null;
    return {
      key,
      ad,
      links,
      multi: links.length > 1,
      spend: isNum(spend) ? spend : null,
      date,
      dateEstimated: !start && !!date,
      month: date.slice(0, 7),
      year: date.slice(0, 4),
      goal: ad.goal,
      metrics: { ...m, likeFav },
      goalResult: ad.goalResult,
      estimate: ad.estimate,
      beatPct: ad.beatPct,
      // D+n per linked post (single-note orders have one).
      stages: links.map((l) => l.ad.stage),
    };
  });
}

/** Cost per unit over a group: total spend / total results (orders without that result are left out). */
function costs(orders) {
  const per = (f) => {
    const withIt = orders.filter((o) => isNum(o.spend) && isNum(f(o)));
    const n = sum(withIt, f);
    return n > 0 ? sum(withIt, (o) => o.spend) / n : null;
  };
  return {
    perRead: per((o) => o.metrics.reads),
    perLikeFav: per((o) => o.metrics.likeFav),
    perFollow: per((o) => o.metrics.follows),
    perProfile: per((o) => o.metrics.profileViews),
    perExposure1k: (() => {
      const x = per((o) => o.metrics.exposure);
      return x == null ? null : x * 1000;
    })(),
  };
}

function totals(orders) {
  const t = (k) => (has(orders, (o) => o.metrics[k]) ? sum(orders, (o) => o.metrics[k]) : null);
  return {
    count: orders.length,
    spend: sum(orders, (o) => o.spend),
    exposure: t('exposure'),
    reads: t('reads'),
    likeFav: t('likeFav'),
    follows: t('follows'),
    profileViews: t('profileViews'),
    estimatedDates: orders.filter((o) => o.dateEstimated).length,
    undated: orders.filter((o) => !o.date).length,
    ...costs(orders),
  };
}
export const adSummary = (orders) => totals(orders);

/**
 * Rows per month ("YYYY-MM") or year, newest first, with income of the same period.
 * cnyKrw (won per 元, typed by the user) converts ad spend to won for the comparison; without it
 * no conversion is made.
 */
export function periodRows(orders, unit, income = [], cnyKrw = null) {
  const keyOf = (date) => (unit === 'year' ? date.slice(0, 4) : date.slice(0, 7));
  const keys = new Set([...orders.filter((o) => o.date).map((o) => keyOf(o.date)), ...income.filter((x) => x.date).map((x) => keyOf(x.date))]);
  return [...keys]
    .sort()
    .reverse()
    .map((k) => {
      const list = orders.filter((o) => o.date && keyOf(o.date) === k);
      const inc = income.filter((x) => x.date && keyOf(x.date) === k);
      const r = totals(list);
      const cash = sum(inc, (x) => x.cashKRW);
      const inKind = sum(inc, (x) => x.inKindKRW);
      const spendKRW = cnyKrw ? r.spend * cnyKrw : null;
      return { period: k, ...r, cash, inKind, incomeCount: inc.length, spendKRW, net: spendKRW == null ? null : cash - spendKRW };
    });
}

/** Per post: its share of spend (estimated for multi-note orders) and its orders. */
export function postRows(posts) {
  return posts
    .filter((p) => (p.ads ?? []).some((a) => a.executed !== false))
    .map((p) => {
      const ads = p.ads.filter((a) => a.executed !== false);
      return {
        post: p,
        count: ads.length,
        spend: sum(ads, (a) => a.spend),
        estimatedShare: ads.some((a) => a.allocation === 'equal'),
        stages: ads.map((a) => a.stage || '?'),
        d1Views: stageOf(p).views ?? null,
        d2Views: stageOf(p, 'd2').views ?? null,
      };
    })
    .sort((a, b) => (b.post.date || '').localeCompare(a.post.date || ''));
}

export const STAGE_BUCKETS = ['D', 'D+1', 'D+2', 'D+3~7', 'D+8+', '?'];
export function stageBucket(stage) {
  const d = stageDay(stage);
  if (d == null) return '?';
  if (d <= 2) return ['D', 'D+1', 'D+2'][d];
  return d <= 7 ? 'D+3~7' : 'D+8+';
}

/** Single-note orders grouped by D+n (a multi-note order has a different D+n per note). */
export function stageRows(orders) {
  const single = orders.filter((o) => !o.multi);
  return STAGE_BUCKETS.map((b) => ({ bucket: b, ...totals(single.filter((o) => stageBucket(o.stages[0]) === b)) })).filter((r) => r.count);
}

export function goalRows(orders) {
  const goals = [...new Set(orders.map((o) => o.goal || ''))];
  return goals.map((g) => ({ goal: g, ...totals(orders.filter((o) => (o.goal || '') === g)) })).sort((a, b) => b.count - a.count);
}

const rel = (a, b) => (isNum(a) && isNum(b) && b > 0 ? a / b - 1 : null);
const perReadOf = (o) => (isNum(o.spend) && isNum(o.metrics.reads) && o.metrics.reads > 0 ? o.spend / o.metrics.reads : null);

/**
 * Rule-based comments: [{ tone: 'good' | 'warn' | 'info', key, vars }]. Keys are i18n keys
 * ("adr.c.<key>"). Groups are only compared with at least MIN_GROUP orders each.
 */
export function adComments(orders, { posts = [], baseline = null, income = [], cnyKrw = null } = {}) {
  const out = [];
  if (!orders.length) return out;
  const all = totals(orders);
  out.push({ tone: 'info', key: 'overall', vars: { n: all.count, spend: all.spend, perRead: all.perRead, perLikeFav: all.perLikeFav, perFollow: all.perFollow } });

  // Best and worst order by cost per read, against the median of all orders.
  const rated = orders.filter((o) => perReadOf(o) != null);
  if (rated.length >= MIN_ORDERS) {
    const med = median(rated.map(perReadOf));
    const sorted = [...rated].sort((a, b) => perReadOf(a) - perReadOf(b));
    const name = (o) => o.links.map((l) => l.post.title).join(' + ');
    out.push({ tone: 'good', key: 'best', vars: { title: name(sorted[0]), cost: perReadOf(sorted[0]), diff: rel(perReadOf(sorted[0]), med) } });
    if (rel(perReadOf(sorted.at(-1)), med) > 0.2) out.push({ tone: 'warn', key: 'worst', vars: { title: name(sorted.at(-1)), cost: perReadOf(sorted.at(-1)), diff: rel(perReadOf(sorted.at(-1)), med) } });
  } else out.push({ tone: 'info', key: 'needMore', vars: { n: rated.length, min: MIN_ORDERS } });

  // Early (D / D+1) vs later (D+2 and after), single-note orders only.
  const single = orders.filter((o) => !o.multi && perReadOf(o) != null);
  const early = single.filter((o) => ['D', 'D+1'].includes(stageBucket(o.stages[0])));
  const late = single.filter((o) => !['D', 'D+1', '?'].includes(stageBucket(o.stages[0])));
  if (early.length >= MIN_GROUP && late.length >= MIN_GROUP) {
    const e = costs(early).perRead;
    const l = costs(late).perRead;
    const d = rel(l, e);
    if (d != null && Math.abs(d) > 0.2) out.push({ tone: 'info', key: d > 0 ? 'earlyCheaper' : 'lateCheaper', vars: { early: e, late: l, diff: Math.abs(d), ne: early.length, nl: late.length } });
    else out.push({ tone: 'info', key: 'stageSimilar', vars: { early: e, late: l } });
  } else out.push({ tone: 'info', key: 'stageNeedMore', vars: { ne: early.length, nl: late.length, min: MIN_GROUP } });

  // Goal result against the platform's estimate.
  const est = orders.filter((o) => isNum(o.goalResult) && Array.isArray(o.estimate) && isNum(o.estimate[1]));
  if (est.length >= MIN_ORDERS) {
    const above = est.filter((o) => o.goalResult > o.estimate[1]).length;
    const below = est.filter((o) => o.goalResult < o.estimate[0]).length;
    out.push({ tone: below > est.length / 2 ? 'warn' : 'good', key: 'estimate', vars: { n: est.length, above, below } });
  }

  // Like/favourite orders hardly bring followers.
  const lf = orders.filter((o) => /点赞|收藏/.test(o.goal || '') && isNum(o.metrics.follows));
  if (lf.length >= MIN_GROUP) {
    const follows = sum(lf, (o) => o.metrics.follows);
    const spend = sum(lf, (o) => o.spend);
    out.push({ tone: follows / lf.length < 2 ? 'warn' : 'info', key: 'followsFromLikeFav', vars: { n: lf.length, follows, perFollow: follows > 0 ? spend / follows : null } });
  }

  // Did the post already do well before the ad? (D+1 views vs the fixed median.)
  const base = baseline?.medians?.views;
  if (isNum(base)) {
    const pre = single.map((o) => ({ o, v: stageOf(o.links[0].post).views })).filter((x) => isNum(x.v));
    const strong = pre.filter((x) => x.v >= base).map((x) => x.o);
    const weak = pre.filter((x) => x.v < base).map((x) => x.o);
    if (strong.length >= MIN_GROUP && weak.length >= MIN_GROUP) {
      const s = costs(strong).perRead;
      const w = costs(weak).perRead;
      out.push({ tone: 'info', key: rel(w, s) > 0.2 ? 'boostStrong' : rel(s, w) > 0.2 ? 'boostWeak' : 'boostSame', vars: { strong: s, weak: w, ns: strong.length, nw: weak.length } });
    }
  }

  // Last two months with orders.
  const months = periodRows(orders, 'month').filter((r) => r.count);
  if (months.length >= 2) {
    const [cur, prev] = months;
    out.push({ tone: 'info', key: 'month', vars: { cur: cur.period, prev: prev.period, spend: cur.spend, spendPrev: prev.spend, perRead: cur.perRead, perReadPrev: prev.perRead } });
  }

  // Ad spend vs sponsorship income (no causal claim).
  const cash = sum(income, (x) => x.cashKRW);
  if (cash > 0 || income.length) {
    if (cnyKrw) out.push({ tone: 'info', key: 'income', vars: { spendKRW: all.spend * cnyKrw, cash, inKind: sum(income, (x) => x.inKindKRW) } });
    else out.push({ tone: 'info', key: 'incomeNeedRate', vars: {} });
  }

  // Data quality.
  const multi = orders.filter((o) => o.multi).length;
  if (multi) out.push({ tone: 'info', key: 'multiSplit', vars: { n: multi } });
  if (all.estimatedDates) out.push({ tone: 'info', key: 'datesEstimated', vars: { n: all.estimatedDates } });
  const noReport = orders.filter((o) => !isNum(o.metrics.reads)).length;
  if (noReport) out.push({ tone: 'info', key: 'noReport', vars: { n: noReport } });
  return out;
}

