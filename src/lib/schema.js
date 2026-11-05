import { SHOT_TYPES, STATUSES, TYPES, VALUES, DEFAULT_TARGET } from './constants.js';
import { isEndBeforeStart, isValidDate, todayString } from './dates.js';
import { uid } from './ids.js';
import { t } from '../i18n/index.js';

export const APP_ID = 'vlog-studio';
export const SCHEMA_VERSION = 2;

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const id = (v) => (typeof v === 'string' && v ? v : uid());
const oneOf = (v, list, fallback) => (list.some((x) => x.id === v) ? v : fallback);
const seconds = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 36000) : 0;
};
const time = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : '');
const MAX_CUSTOM_TYPES = 10;

/** Built-in type ids, in display order. Accepts the v1 single `type` string too ("other" had no meaning, so it is dropped). */
function normalizeTypes(raw) {
  const picked = Array.isArray(raw.types) ? raw.types : typeof raw.type === 'string' ? [raw.type] : [];
  return TYPES.filter((t) => picked.includes(t.id)).map((t) => t.id);
}

/** Free-text types: trimmed, de-duplicated, no copies of built-in labels. Accepts an array or a comma-separated string. */
export function normalizeCustomTypes(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,，、]/) : [];
  const out = [];
  for (const v of list) {
    const t = str(v).replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!t || out.includes(t) || TYPES.some((x) => x.label === t)) continue;
    out.push(t);
  }
  return out.slice(0, MAX_CUSTOM_TYPES);
}

function stamp(v, fallback) {
  if (Number.isFinite(v) && v > 0) return v;
  const parsed = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePlace(raw = {}) {
  const p = obj(raw);
  return {
    id: id(p.id),
    name: str(p.name),
    date: isValidDate(p.date) ? p.date : '',
    time: time(p.time),
    purpose: str(p.purpose),
    expectation: str(p.expectation),
    shotIdea: str(p.shotIdea),
    memo: str(p.memo),
    shots: arr(p.shots).map(normalizeShot),
  };
}

export function normalizeShot(raw = {}) {
  const s = obj(raw);
  return {
    id: id(s.id),
    type: oneOf(s.type, SHOT_TYPES, 'env'),
    desc: str(s.desc),
    done: s.done === true,
    memo: str(s.memo),
  };
}

export function normalizeLog(raw = {}, now = Date.now()) {
  const l = obj(raw);
  const createdAt = stamp(l.createdAt, now);
  return {
    id: id(l.id),
    placeId: typeof l.placeId === 'string' ? l.placeId : '',
    placeName: str(l.placeName),
    unplanned: l.unplanned === true,
    expectWhy: str(l.expectWhy),
    expectWhat: str(l.expectWhat),
    experience: str(l.experience),
    happened: str(l.happened),
    feeling: str(l.feeling),
    good: str(l.good),
    bad: str(l.bad),
    surprise: str(l.surprise),
    memo: str(l.memo),
    // Reserved for voice memos / photos: [{ id, kind: 'audio' | 'image', mediaId, createdAt }].
    // Blobs would live in the "media" object store, which the DB already creates.
    attachments: arr(l.attachments).filter((a) => a && typeof a === 'object'),
    createdAt,
    updatedAt: stamp(l.updatedAt, createdAt),
  };
}

export function normalizeScene(raw = {}) {
  const s = obj(raw);
  return {
    id: id(s.id),
    title: str(s.title),
    link: typeof s.link === 'string' && /^(place|log):/.test(s.link) ? s.link : '',
    content: str(s.content),
    subtitle: str(s.subtitle),
    voiceover: str(s.voiceover),
    seconds: seconds(s.seconds),
    memo: str(s.memo),
    highlight: s.highlight === true,
  };
}

export function normalizeProject(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') throw new Error(t('backup.badProject'));
  const plan = obj(raw.plan);
  const story = obj(raw.story);
  const target = obj(raw.target);
  const startDate = isValidDate(raw.startDate) ? raw.startDate : todayString();
  const endDate = isValidDate(raw.endDate) && !isEndBeforeStart(startDate, raw.endDate) ? raw.endDate : '';
  const createdAt = stamp(raw.createdAt, now);
  const min = seconds(target.min ?? DEFAULT_TARGET.min);
  const max = seconds(target.max ?? DEFAULT_TARGET.max);
  return {
    id: id(raw.id),
    schemaVersion: SCHEMA_VERSION,
    name: str(raw.name).trim() || t('project.untitled'),
    startDate,
    endDate,
    location: str(raw.location),
    types: normalizeTypes(raw),
    customTypes: normalizeCustomTypes(raw.customTypes),
    status: oneOf(raw.status, STATUSES, 'planning'),
    createdAt,
    updatedAt: stamp(raw.updatedAt, createdAt),
    plan: {
      theme: str(plan.theme),
      direction: str(plan.direction),
      highlights: arr(plan.highlights).map((h) =>
        typeof h === 'string' ? { id: uid(), text: h } : { id: id(h?.id), text: str(h?.text) },
      ),
      curiosity: str(plan.curiosity),
      persona: str(plan.persona),
      resonance: str(plan.resonance),
      values: arr(plan.values).filter((v) => VALUES.some((x) => x.id === v)),
      valueNote: str(plan.valueNote),
    },
    places: arr(raw.places).map(normalizePlace),
    logs: arr(raw.logs).map((l) => normalizeLog(l, now)),
    story: {
      expectation: str(story.expectation),
      discovery: str(story.discovery),
      experience: str(story.experience),
      twist: str(story.twist),
      noTwist: story.noTwist === true,
      feeling: str(story.feeling),
      finalLine: str(story.finalLine),
      emotion: str(story.emotion),
      hook: str(story.hook),
      ending: str(story.ending),
      editNote: str(story.editNote),
    },
    scenes: arr(raw.scenes).map(normalizeScene),
    target: { min: Math.min(min, max), max: Math.max(min, max) },
  };
}

export function createProject(input = {}, now = Date.now()) {
  return normalizeProject({ ...input, id: uid(), createdAt: now, updatedAt: now }, now);
}

/** Upgrades a stored or imported record from an older schema version. */
export function migrateProject(raw, fromVersion = raw?.schemaVersion ?? 1) {
  const p = { ...raw };
  // v2: the single `type` became multi-select `types` (+ free-text `customTypes`); normalizeProject reads either shape.
  if (fromVersion < 2) delete p.types;
  return normalizeProject(p);
}

/** Deep copy with fresh ids everywhere; internal references are remapped to the new ids. */
export function cloneProject(src, now = Date.now()) {
  const p = structuredClone(src);
  const placeIds = new Map();
  const logIds = new Map();
  p.id = uid();
  p.name = t('project.copyName', { name: src.name });
  p.createdAt = now;
  p.updatedAt = now;
  p.plan.highlights = p.plan.highlights.map((h) => ({ ...h, id: uid() }));
  p.places = p.places.map((pl) => {
    const nid = uid();
    placeIds.set(pl.id, nid);
    return { ...pl, id: nid, shots: pl.shots.map((s) => ({ ...s, id: uid() })) };
  });
  p.logs = p.logs.map((l) => {
    const nid = uid();
    logIds.set(l.id, nid);
    return { ...l, id: nid, placeId: placeIds.get(l.placeId) ?? '' };
  });
  p.scenes = p.scenes.map((s) => {
    const [kind, ref] = s.link.split(':');
    const mapped = kind === 'place' ? placeIds.get(ref) : kind === 'log' ? logIds.get(ref) : undefined;
    return { ...s, id: uid(), link: mapped ? `${kind}:${mapped}` : '' };
  });
  return p;
}

export function buildBackup(projects, now = Date.now()) {
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    projectCount: projects.length,
    projects,
  };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: [t('backup.notJson')], projects: [] };
  }
  return validateBackup(data);
}

export function validateBackup(data) {
  const fail = (msg) => ({ ok: false, errors: [msg], projects: [] });
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(t('backup.notBackup'));
  if (data.app !== APP_ID) return fail(t('backup.noAppId'));
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) return fail(t('backup.noVersion'));
  if (data.schemaVersion > SCHEMA_VERSION) {
    return fail(t('backup.tooNew', { v: data.schemaVersion }));
  }
  if (!Array.isArray(data.projects)) return fail(t('backup.noProjects'));

  const errors = [];
  const projects = [];
  const seen = new Set();
  data.projects.forEach((p, i) => {
    const n = t('backup.nth', { n: i + 1 });
    if (!p || typeof p !== 'object') return errors.push(`${n}: ${t('backup.badFormat')}`);
    if (typeof p.id !== 'string' || !p.id) return errors.push(`${n}: ${t('backup.noId')}`);
    if (seen.has(p.id)) return errors.push(`${n}: ${t('backup.dupId')}`);
    if (typeof p.name !== 'string' || !p.name.trim()) return errors.push(`${n}: ${t('backup.noName')}`);
    if (!isValidDate(p.startDate)) return errors.push(`${n} "${p.name}": ${t('backup.badStart')}`);
    seen.add(p.id);
    try {
      projects.push(migrateProject(p, data.schemaVersion));
    } catch (e) {
      errors.push(`${n}: ${e.message}`);
    }
  });
  return { ok: errors.length === 0, errors, projects, exportedAt: data.exportedAt ?? '' };
}
