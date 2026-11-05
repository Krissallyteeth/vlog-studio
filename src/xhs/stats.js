import { CRITERIA_ROWS, METRIC, METRICS, computeStage } from './metrics.js';

/*
 * Statistics, reproducing the original workbook:
 *  - MEDIAN ignores blanks (Excel semantics).
 *  - Fixed baseline (Version 1) = medians of the first 11 valid ("유효") D+1 records; stored once,
 *    never recomputed automatically.
 *  - Early 5 / recent 5 = first / last five valid posts in publishing order (유효순번).
 *  - Improvement = (recent − early) / early, sign flipped for lower-is-better metrics.
 *  - Trend: > +10% 개선, < −10% 악화, otherwise 유지; no value → 표본 확인.
 *  - Colours: green if beyond base × (1 ± band) in the good direction (strict), red if beyond it in
 *    the bad direction (strict), yellow inside the band (inclusive). 涨粉丝: green when ≥ 1 on a valid post.
 * Ad-mixed (광고혼입) posts get colours for reference only and are excluded from every median.
 */

export const BASELINE_SIZE = 11;
export const WINDOW = 5;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function median(values) {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Publishing order: date, time, original No., creation. */
export function ordered(posts) {
  const key = (p) => `${p.date || '9999-99-99'} ${p.time || '99:99'}`;
  return [...posts].sort((a, b) => key(a).localeCompare(key(b)) || (a.no ?? 1e9) - (b.no ?? 1e9) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export const isValid = (p) => p.validity === '유효';
export const validPosts = (posts) => ordered(posts).filter(isValid);

/** D+1 / D+2 values with the computed metrics filled in. */
export function stage(post, which = 'd1') {
  return computeStage(post?.[which], post?.d1?.duration);
}

/** 유효순번 (column AX): 1, 2, 3… over valid posts in publishing order. */
export function validSeq(posts) {
  const map = new Map();
  validPosts(posts).forEach((p, i) => map.set(p.id, i + 1));
  return map;
}

export function medians(posts, which = 'd1') {
  const out = {};
  for (const m of METRICS) out[m.key] = median(posts.map((p) => stage(p, which)[m.key]));
  return out;
}

/** Builds a baseline snapshot from the first `size` valid posts (null when there are not enough). */
export function buildBaseline(posts, { version = 1, size = BASELINE_SIZE, note = '', now = Date.now() } = {}) {
  const first = validPosts(posts).slice(0, size);
  if (first.length < size) return null;
  return { version, createdAt: now, postIds: first.map((p) => p.id), size, medians: medians(first), note, approved: true };
}

export function improvement(early, recent, dir) {
  if (!isNum(early) || !isNum(recent) || early === 0) return null;
  return dir < 0 ? (early - recent) / early : (recent - early) / early;
}

export function trendOf(imp) {
  if (!isNum(imp)) return 'sample';
  if (imp > 0.1) return 'up';
  if (imp < -0.1) return 'down';
  return 'flat';
}

/** Colour of one value against the baseline: 'good' | 'mid' | 'bad' | null. */
export function judge(metricKey, value, base, validity) {
  const m = METRIC[metricKey];
  if (!m || !isNum(value) || validity === '미확인' || !validity) return null;
  if (metricKey === 'newFollowers') return validity === '유효' && value >= 1 ? 'good' : null;
  if (!m.band || !isNum(base)) return null;
  const hi = base * (1 + m.band);
  const lo = base * (1 - m.band);
  if (m.dir < 0) return value < lo ? 'good' : value > hi ? 'bad' : 'mid';
  return value > hi ? 'good' : value < lo ? 'bad' : 'mid';
}

/** Relative difference in the good direction; null (not a division by 0) when the base is 0. */
export function relDiff(value, base, dir = 1) {
  if (!isNum(value) || !isNum(base) || base === 0) return null;
  return dir < 0 ? (base - value) / base : (value - base) / base;
}

/** The "성과기준" sheet, recomputed from the stored posts. */
export function criteria(posts, baseline, settings = {}) {
  const valid = validPosts(posts);
  const early = valid.slice(0, WINDOW);
  const recent = valid.length >= WINDOW ? valid.slice(-WINDOW) : [];
  const recent10 = valid.length >= 10 ? valid.slice(-10) : [];
  const adMixed = posts.filter((p) => p.validity === '광고혼입').length;
  const rows = CRITERIA_ROWS.map((r) => {
    const m = METRIC[r.key];
    const core = settings.core?.[r.key] ?? r.core;
    const vals = (list) => median(list.map((p) => stage(p)[r.key]));
    const earlyMed = vals(early);
    const recentMed = recent.length ? vals(recent) : null;
    const imp = improvement(earlyMed, recentMed, m.dir);
    return {
      key: r.key,
      area: r.area,
      dir: m.dir,
      core,
      fixed: baseline?.medians?.[r.key] ?? null,
      early: earlyMed,
      recent: recentMed,
      recent10: recent10.length ? vals(recent10) : null,
      improvement: imp,
      trend: trendOf(imp),
      validCount: valid.filter((p) => isNum(stage(p)[r.key])).length,
      adMixedCount: adMixed,
    };
  });
  const coreDown = rows.filter((r) => r.core && r.trend === 'down').length;
  return {
    rows,
    validCount: valid.length,
    adMixedCount: adMixed,
    unknownCount: posts.filter((p) => p.validity === '미확인').length,
    coreDown,
    priority: coreDown >= 3 ? 'coverHook' : 'review', // same rule as the sheet's H6
    early,
    recent,
  };
}

/** Valid posts published before `post` (the comparison group when analysing it). */
export function validBefore(posts, post) {
  const list = ordered(posts);
  const idx = list.findIndex((p) => p.id === post.id);
  return list.slice(0, idx < 0 ? list.length : idx).filter(isValid);
}

/** Per content type: medians and sample size. */
export function byContentType(posts) {
  const groups = new Map();
  for (const p of validPosts(posts)) {
    const type = p.contentType || '';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(p);
  }
  return [...groups.entries()].map(([type, list]) => ({
    type,
    count: list.length,
    medians: medians(list),
    followers: list.reduce((a, p) => a + (stage(p).newFollowers ?? 0), 0),
    reliable: list.length >= 5,
  }));
}

/** Ad totals: real spend (元) and free credits kept apart. */
export function adTotals(posts) {
  let spend = 0;
  let credit = 0;
  let count = 0;
  let unconfirmed = 0;
  for (const p of posts) {
    for (const a of p.ads ?? []) {
      if (a.executed === false) continue;
      count++;
      if (isNum(a.spend)) spend += a.spend;
      if (isNum(a.credit)) credit += a.credit;
      if (a.needsReview) unconfirmed++;
    }
  }
  return { spend, credit, count, unconfirmed };
}
