import { uid } from '../lib/ids.js';
import { DEFAULT_CONTENT_TYPES, INPUT_METRICS, VALIDITY } from './metrics.js';
import { buildBaseline } from './stats.js';
import { deleteOne, getAll, getMetaValue, getOne, putMany, replaceStores, setMetaValue } from './db.js';

/*
 * Repository for 小红书 records. Device-only: nothing here is uploaded or synced.
 * Every write notifies listeners so dashboards, tables and colours recalculate.
 */

const listeners = new Set();
export function onXhsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());
/** Called by the sync engine after it applied changes from another device. */
export const notifyChanged = changed;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (v == null ? '' : String(v));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function normStage(raw) {
  const out = {};
  for (const m of INPUT_METRICS) out[m.key] = num(raw?.[m.key]);
  return out;
}

const ORDER_KEYS = ['exposure', 'reads', 'likes', 'favorites', 'comments', 'follows', 'profileViews', 'dmOpens'];

/** "D" = publishing day, "D+1", "D+2", … any day after; "" = unknown. */
export function normalizeStage(v) {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (s === 'D' || s === 'D+0') return 'D';
  const m = /^D\+(\d{1,3})\+?$/.exec(s);
  return m ? `D+${Number(m[1])}` : '';
}
/**
 * D+n from the post's publish date and the ad's start time: calendar days between the two dates
 * (same day → "D", next day → "D+1"). Returns '' when either date is missing or the ad started first.
 */
export function stageFromDates(postDate, adStart) {
  const d = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s ?? '') ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null);
  const a = d(postDate);
  const b = d(adStart);
  if (a == null || b == null || b < a) return '';
  const n = Math.round((b - a) / 86400000);
  return n === 0 ? 'D' : `D+${n}`;
}

/** Days after publishing for a stage ("D" → 0, "D+3" → 3, unknown → null). */
export const stageDay = (stage) => (stage === 'D' ? 0 : /^D\+(\d+)$/.test(stage) ? Number(stage.slice(2)) : null);

export function normalizeAd(raw = {}) {
  const order = raw.order && typeof raw.order === 'object' ? raw.order : {};
  const coupon = raw.coupon && typeof raw.coupon === 'object' ? raw.coupon : null;
  return {
    id: raw.id || uid(),
    stage: normalizeStage(raw.stage),
    executed: raw.executed !== false,
    start: str(raw.start), // 'YYYY-MM-DDTHH:MM'
    end: str(raw.end),
    hours: num(raw.hours),
    goal: str(raw.goal), // 关注 | 阅读 | 点赞收藏量 | free text
    spend: num(raw.spend), // 元, real money actually used
    budget: num(raw.budget), // 元, order budget
    credit: num(raw.credit), // 元, free/bonus credit used for this order
    expectedFollowers: num(raw.expectedFollowers),
    actualFollowers: num(raw.actualFollowers),
    result: str(raw.result),
    memo: str(raw.memo),
    // From the 薯条 order report (screenshot OCR or typed): what the paid traffic itself produced.
    order: Object.fromEntries(ORDER_KEYS.map((k) => [k, num(order[k])])),
    goalResult: num(raw.goalResult),
    estimate: Array.isArray(raw.estimate) && raw.estimate.length === 2 ? raw.estimate.map(num) : null,
    beatPct: num(raw.beatPct),
    status: str(raw.status),
    coupon: coupon ? { threshold: num(coupon.threshold), bonus: num(coupon.bonus), expires: str(coupon.expires) } : null,
    audience: raw.audience && typeof raw.audience === 'object' ? raw.audience : null,
    noteTitle: str(raw.noteTitle),
    notePublishedAt: str(raw.notePublishedAt),
    // Order identity and money (from the expanded 订单信息 / 金额信息).
    orderNo: str(raw.orderNo), // first part of 订单编号: the same order is never stored twice
    orderAmount: num(raw.orderAmount),
    paid: num(raw.paid),
    payMethod: str(raw.payMethod),
    targeting: str(raw.targeting),
    bonus: num(raw.bonus), // 超额获赠
    costPerResult: num(raw.costPerResult), // 投放成本 (元 per goal result)
    // One order can promote several notes: each linked post keeps a copy with its share.
    groupKey: str(raw.groupKey), // same value on every post of a multi-note order
    noteCount: num(raw.noteCount) ?? 1,
    orderSpend: num(raw.orderSpend), // the whole order's spend (spend = this post's share)
    share: num(raw.share) ?? 1,
    outsideNotes: num(raw.outsideNotes) ?? 0, // notes of this order whose post is not in the app (no data): their share is in the total only
    noteText: str(raw.noteText), // text read under the order's thumbnails (what those notes were)
    allocation: ['single', 'equal', 'exact'].includes(raw.allocation) ? raw.allocation : 'single',
    screenshots: Array.isArray(raw.screenshots) ? raw.screenshots.filter((x) => typeof x === 'string') : [],
    sourceText: str(raw.sourceText), // original Excel note it was read from
    needsReview: raw.needsReview === true,
  };
}

export function normalizePost(raw = {}, now = Date.now()) {
  return {
    id: raw.id || uid(),
    no: num(raw.no),
    followers: num(raw.followers),
    title: str(raw.title).trim(),
    date: DATE_RE.test(raw.date) ? raw.date : '',
    time: TIME_RE.test(raw.time) ? raw.time.slice(0, 5) : '',
    contentType: str(raw.contentType),
    projectId: str(raw.projectId),
    validity: VALIDITY.includes(raw.validity) ? raw.validity : '미확인',
    d1: normStage(raw.d1),
    d2: normStage(raw.d2),
    adDecisionD1: str(raw.adDecisionD1),
    adAux: str(raw.adAux),
    adDecisionD2: str(raw.adDecisionD2),
    expectedFollowersD1: num(raw.expectedFollowersD1),
    expectedFollowersD2: num(raw.expectedFollowersD2),
    memo: str(raw.memo),
    ads: (Array.isArray(raw.ads) ? raw.ads : []).map((a) => {
      const ad = normalizeAd(a);
      // No D+n typed but the start time is known: calculate it from the publish date.
      // The note's publish time from its screenshot beats the workbook date (it can be a day off).
      if (!ad.stage && ad.start) ad.stage = stageFromDates(ad.notePublishedAt || raw.date, ad.start);
      return ad;
    }),
    // Titles this post had in 薯条 screenshots (they can differ from the workbook title).
    adTitles: Array.isArray(raw.adTitles) ? raw.adTitles.filter((x) => typeof x === 'string' && x).slice(-10) : [],
    extra: raw.extra && typeof raw.extra === 'object' ? { ...raw.extra } : {},
    // This post's choice for each experiment item: { face: '없음', intro: '없음' }.
    experiments: Object.fromEntries(Object.entries(raw.experiments && typeof raw.experiments === 'object' ? raw.experiments : {}).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && v)),
    // What the D+1 / D+2 screenshots showed besides the metrics: when the data was cut, the
    // platform's peer median and rank, traffic sources, audience.
    d1Meta: noteMeta(raw.d1Meta),
    d2Meta: noteMeta(raw.d2Meta),
    source: raw.source ?? null, // { file, sheet, row, importedAt, cells: { col: { v, f, w } } }
    screenshots: Array.isArray(raw.screenshots) ? raw.screenshots.filter((x) => typeof x === 'string') : [],
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
  };
}

const shares = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => typeof k === 'string' && num(v) != null).map(([k, v]) => [k, num(v)]));
const txt = (v) => (typeof v === 'string' ? v.slice(0, 600) : '');
function noteAi(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const parts = (o, keys) => Object.fromEntries(keys.map((k) => [k, txt(o?.[k])]).filter(([, v]) => v));
  const map = (o, keys) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([k, v]) => [k, parts(v, keys)]).filter(([, v]) => Object.keys(v).length));
  return {
    metrics: map(raw.metrics, ['now', 'why', 'tip']),
    segments: map(raw.segments, ['analysis', 'tip']),
    traffic: raw.traffic ? parts(raw.traffic, ['title', 'text']) : null,
    audience: raw.audience ? parts(raw.audience, ['title', 'text']) : null,
  };
}
function noteMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const peer = Object.fromEntries(Object.entries(raw.peer && typeof raw.peer === 'object' ? raw.peer : {}).map(([k, v]) => [k, { value: num(v?.value), median: num(v?.median), beat: num(v?.beat) }]));
  const aud = raw.audience && typeof raw.audience === 'object' ? raw.audience : {};
  return {
    snapshotAt: str(raw.snapshotAt),
    snapshotDerived: raw.snapshotDerived === true,
    publishedAt: str(raw.publishedAt),
    peer,
    sources: shares(raw.sources),
    audience: { gender: shares(aud.gender), age: shares(aud.age), city: shares(aud.city), interest: shares(aud.interest) },
    // 内容分析: segments the platform marks with the share of viewers lost in each.
    segments: (Array.isArray(raw.segments) ? raw.segments : []).filter((x) => x && /^\d{2}:\d{2}$/.test(x.from)).slice(0, 12).map((x) => ({ from: str(x.from), to: str(x.to), title: str(x.title), loss: num(x.loss) })),
    duration: num(raw.duration),
    // The platform's own written analysis, as read (Chinese).
    ai: noteAi(raw.ai),
  };
}

export function normalizeIncome(raw = {}, now = Date.now()) {
  return {
    id: raw.id || uid(),
    no: num(raw.no),
    platform: str(raw.platform),
    brand: str(raw.brand),
    collabType: str(raw.collabType), // 현물협찬 | 유료협업 | 혼합협업
    content: str(raw.content),
    product: str(raw.product),
    inKindKRW: num(raw.inKindKRW), // stored in won; the sheet used 만 원
    cashKRW: num(raw.cashKRW),
    date: DATE_RE.test(raw.date) ? raw.date : '',
    note: str(raw.note),
    postId: str(raw.postId),
    // Titles this post had in 薯条 screenshots (they can differ from the workbook title).
    adTitles: Array.isArray(raw.adTitles) ? raw.adTitles.filter((x) => typeof x === 'string' && x).slice(-10) : [],
    extra: raw.extra && typeof raw.extra === 'object' ? { ...raw.extra } : {},
    // This post's choice for each experiment item: { face: '없음', intro: '없음' }.
    experiments: Object.fromEntries(Object.entries(raw.experiments && typeof raw.experiments === 'object' ? raw.experiments : {}).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && v)),
    // What the D+1 / D+2 screenshots showed besides the metrics: when the data was cut, the
    // platform's peer median and rank, traffic sources, audience.
    d1Meta: noteMeta(raw.d1Meta),
    d2Meta: noteMeta(raw.d2Meta),
    source: raw.source ?? null,
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
  };
}

// ── Reads ─────────────────────────────────────────────
export const listPosts = async () => (await getAll('posts')).map((p) => normalizePost(p));
export const getPost = async (id) => {
  const p = await getOne('posts', id);
  return p ? normalizePost(p) : null;
};
export const listIncome = async () => (await getAll('income')).map((x) => normalizeIncome(x));

export async function getSettings() {
  const s = (await getMetaValue('settings')) ?? {};
  return {
    core: s.core ?? {},
    contentTypes: Array.isArray(s.contentTypes) && s.contentTypes.length ? s.contentTypes : [...DEFAULT_CONTENT_TYPES],
    currentRules: typeof s.currentRules === 'string' ? s.currentRules : '',
    // Won per 1 元, typed by the user (never guessed) — only used to compare ad spend with income.
    cnyKrw: typeof s.cnyKrw === 'number' && s.cnyKrw > 0 ? s.cnyKrw : null,
    // What is tried on purpose post by post (thumbnail with my face, an intro …), with the metrics
    // each one is expected to move.
    experiments: Array.isArray(s.experiments) ? s.experiments.map(normalizeExperiment).filter((x) => x.name && x.options.length >= 2) : DEFAULT_EXPERIMENTS.map((x) => ({ ...x })),
  };
}

export const DEFAULT_EXPERIMENTS = [
  { id: 'face', name: '썸네일 얼굴', options: ['있음', '없음'], metrics: ['ctr'] },
  { id: 'intro', name: '인트로', options: ['있음', '없음'], metrics: ['exit2s', 'retain5s'] },
];
export function normalizeExperiment(raw = {}) {
  return {
    id: str(raw.id) || uid(),
    name: str(raw.name).trim(),
    options: (Array.isArray(raw.options) ? raw.options : []).map((o) => str(o).trim()).filter(Boolean).slice(0, 6),
    metrics: (Array.isArray(raw.metrics) ? raw.metrics : []).filter((k) => typeof k === 'string').slice(0, 6),
  };
}
export const saveSettings = async (s) => {
  await setMetaValue('settings', s);
  changed();
};

/** All baseline versions, oldest first. Version 1 is the fixed initial baseline. */
export const getBaselines = async () => (await getMetaValue('baselines')) ?? [];
export async function activeBaseline() {
  const list = await getBaselines();
  const activeVersion = (await getMetaValue('activeBaseline')) ?? list.at(-1)?.version;
  return list.find((b) => b.version === activeVersion) ?? list.at(-1) ?? null;
}
/** Adds a new baseline version (only ever on explicit user approval). Old versions are kept. */
export async function addBaseline(baseline, { activate = true } = {}) {
  const list = await getBaselines();
  const version = (list.at(-1)?.version ?? 0) + 1;
  const b = { ...baseline, version };
  await setMetaValue('baselines', [...list, b]);
  if (activate) await setMetaValue('activeBaseline', version);
  changed();
  return b;
}
export async function setActiveBaseline(version) {
  await setMetaValue('activeBaseline', version);
  changed();
}

export const getDocs = async () => (await getMetaValue('docs')) ?? { rules: [], criteriaNotes: null };
export const saveDocs = async (docs) => {
  await setMetaValue('docs', docs);
  changed();
};
export const getImports = async () => (await getMetaValue('imports')) ?? [];

// ── Writes ────────────────────────────────────────────
/** Saves posts; creates Version 1 automatically the first time 11 valid posts exist. */
export async function savePosts(list, { touch = true } = {}) {
  const now = Date.now();
  const out = list.map((p) => normalizePost({ ...p, updatedAt: touch ? now : p.updatedAt }));
  await putMany('posts', out);
  await ensureInitialBaseline();
  changed();
  return out;
}

export async function ensureInitialBaseline() {
  if ((await getBaselines()).length) return null;
  const b = buildBaseline(await listPosts(), { version: 1, note: 'initial-11' });
  if (!b) return null;
  await setMetaValue('baselines', [b]);
  await setMetaValue('activeBaseline', 1);
  return b;
}

export async function deletePost(id) {
  await deleteOne('posts', id);
  changed();
}

export async function saveIncome(list) {
  const now = Date.now();
  await putMany('income', list.map((x) => normalizeIncome({ ...x, updatedAt: now })));
  changed();
}
export async function deleteIncome(id) {
  await deleteOne('income', id);
  changed();
}

export async function recordImport(entry) {
  await setMetaValue('imports', [...(await getImports()), entry]);
}

// ── Backup ────────────────────────────────────────────
export const XHS_BACKUP_APP = 'vlog-studio-xhs';

export async function exportAll({ withScreenshots = false } = {}) {
  const meta = await getAll('meta');
  const shots = withScreenshots ? await getAll('shots') : [];
  return {
    app: XHS_BACKUP_APP,
    version: 1,
    exportedAt: new Date().toISOString(),
    posts: await getAll('posts'),
    income: await getAll('income'),
    meta,
    // Blobs are written as data URLs so the file is plain JSON.
    shots: await Promise.all(shots.map(async (s) => ({ ...s, blob: s.blob ? await blobToDataUrl(s.blob) : null }))),
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

/** mode 'merge' keeps what is here and adds/overwrites by id; 'replace' wipes first. */
export async function importAll(data, mode = 'merge') {
  if (data?.app !== XHS_BACKUP_APP || !Array.isArray(data.posts)) throw new Error('not-xhs-backup');
  const posts = data.posts.map((p) => normalizePost(p));
  const income = (data.income ?? []).map((x) => normalizeIncome(x));
  const meta = Array.isArray(data.meta) ? data.meta.filter((m) => m && typeof m.key === 'string') : [];
  const shots = await Promise.all(
    (data.shots ?? []).map(async (s) => ({ ...s, blob: typeof s.blob === 'string' ? await (await fetch(s.blob)).blob() : null })),
  );
  if (mode === 'replace') {
    await replaceStores({ posts, income, meta, shots });
  } else {
    await putMany('posts', posts);
    await putMany('income', income);
    // Never overwrite existing baselines on merge: they are versioned and user-approved.
    const keep = new Set(['baselines', 'activeBaseline']);
    const hasBaselines = (await getBaselines()).length > 0;
    await putMany('meta', meta.filter((m) => !(hasBaselines && keep.has(m.key))));
    if (shots.length) await putMany('shots', shots);
  }
  changed();
  return { posts: posts.length, income: income.length };
}

export async function deleteAll() {
  await replaceStores({ posts: [], income: [], meta: [], shots: [] });
  changed();
}
