import { SHOT_TYPES, STATUSES, TYPES, VALUES, DEFAULT_TARGET } from './constants.js';
import { isEndBeforeStart, isValidDate, todayString } from './dates.js';
import { uid } from './ids.js';

export const APP_ID = 'vlog-studio';
export const SCHEMA_VERSION = 1;

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
  if (!raw || typeof raw !== 'object') throw new Error('프로젝트 데이터 형식이 올바르지 않아요.');
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
    name: str(raw.name).trim() || '제목 없는 프로젝트',
    startDate,
    endDate,
    location: str(raw.location),
    type: oneOf(raw.type, TYPES, 'travel'),
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
  // v1 is the first schema. Future steps go here, e.g. `if (fromVersion < 2) { ... }`.
  void fromVersion;
  return normalizeProject(p);
}

/** Deep copy with fresh ids everywhere; internal references are remapped to the new ids. */
export function cloneProject(src, now = Date.now()) {
  const p = structuredClone(src);
  const placeIds = new Map();
  const logIds = new Map();
  p.id = uid();
  p.name = `${src.name} (복사본)`;
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
    return { ok: false, errors: ['JSON 형식이 아니에요. 파일이 손상되었거나 다른 파일일 수 있어요.'], projects: [] };
  }
  return validateBackup(data);
}

export function validateBackup(data) {
  const fail = (msg) => ({ ok: false, errors: [msg], projects: [] });
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('Vlog Studio 백업 파일이 아니에요.');
  if (data.app !== APP_ID) return fail('Vlog Studio 백업 파일이 아니에요. (앱 식별자가 없어요)');
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) return fail('백업 파일에 스키마 버전 정보가 없어요.');
  if (data.schemaVersion > SCHEMA_VERSION) {
    return fail(`더 새로운 버전(v${data.schemaVersion})의 앱에서 만든 백업이에요. 앱을 업데이트한 뒤 다시 시도하세요.`);
  }
  if (!Array.isArray(data.projects)) return fail('백업 파일에 프로젝트 목록이 없어요.');

  const errors = [];
  const projects = [];
  const seen = new Set();
  data.projects.forEach((p, i) => {
    const n = `${i + 1}번째 프로젝트`;
    if (!p || typeof p !== 'object') return errors.push(`${n}: 형식이 올바르지 않아요.`);
    if (typeof p.id !== 'string' || !p.id) return errors.push(`${n}: ID가 없어요.`);
    if (seen.has(p.id)) return errors.push(`${n}: ID가 중복돼요.`);
    if (typeof p.name !== 'string' || !p.name.trim()) return errors.push(`${n}: 프로젝트명이 없어요.`);
    if (!isValidDate(p.startDate)) return errors.push(`${n} "${p.name}": 촬영 시작일이 올바르지 않아요.`);
    seen.add(p.id);
    try {
      projects.push(migrateProject(p, data.schemaVersion));
    } catch (e) {
      errors.push(`${n}: ${e.message}`);
    }
  });
  return { ok: errors.length === 0, errors, projects, exportedAt: data.exportedAt ?? '' };
}
