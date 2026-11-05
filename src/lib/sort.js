import { CUSTOM_TYPE_PREFIX } from './constants.js';
import { dateKey } from './dates.js';

const ts = (v) => (Number.isFinite(v) ? v : 0);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Compares start dates as YYYYMMDD numbers; projects with an invalid date always go last. */
function byShootDate(a, b, dir) {
  const ka = dateKey(a.startDate);
  const kb = dateKey(b.startDate);
  if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
  return dir * (ka - kb);
}
const byUpdated = (a, b) => ts(b.updatedAt) - ts(a.updatedAt);
const byCreated = (a, b) => ts(b.createdAt) - ts(a.createdAt);

const COMPARATORS = {
  // Same shoot date → most recently edited first → most recently created first.
  shootDesc: (a, b) => byShootDate(a, b, -1) || byUpdated(a, b) || byCreated(a, b) || byId(a, b),
  shootAsc: (a, b) => byShootDate(a, b, 1) || byUpdated(a, b) || byCreated(a, b) || byId(a, b),
  updatedDesc: (a, b) => byUpdated(a, b) || byCreated(a, b) || byShootDate(a, b, -1) || byId(a, b),
  createdDesc: (a, b) => byCreated(a, b) || byUpdated(a, b) || byShootDate(a, b, -1) || byId(a, b),
};

export function sortProjects(list, sortKey = 'shootDesc') {
  return [...list].sort(COMPARATORS[sortKey] ?? COMPARATORS.shootDesc);
}

const normalize = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

function haystack(p) {
  return normalize(
    [p.name, p.location, ...(p.places ?? []).map((x) => x.name), ...(p.logs ?? []).map((x) => x.placeName)].join('\n'),
  );
}

/** type: "all", a built-in id ("travel") or a user-written one ("custom:맛집"). */
function hasType(p, type) {
  if (type === 'all') return true;
  if (type.startsWith(CUSTOM_TYPE_PREFIX)) return (p.customTypes ?? []).includes(type.slice(CUSTOM_TYPE_PREFIX.length));
  return (p.types ?? []).includes(type);
}

/** Search (name + places, every word must match), status and type filters combine with AND. */
export function filterProjects(list, { query = '', status = 'all', type = 'all' } = {}) {
  const terms = normalize(query).split(' ').filter(Boolean);
  return list.filter((p) => {
    if (status !== 'all' && p.status !== status) return false;
    if (!hasType(p, type)) return false;
    if (!terms.length) return true;
    const text = haystack(p);
    return terms.every((t) => text.includes(t));
  });
}
