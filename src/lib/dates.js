import { t } from '../i18n/index.js';

// Date-only values are stored as local "YYYY-MM-DD" strings and never passed
// through `new Date('YYYY-MM-DD')`, which parses as UTC and can shift the day.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');

export function parseDate(value) {
  if (typeof value !== 'string') return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  const daysInMonth = new Date(y, mo, 0).getDate();
  if (d > daysInMonth) return null;
  return { y, m: mo, d };
}

export const isValidDate = (value) => parseDate(value) !== null;

export function toDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const todayString = (now = new Date()) => toDateString(now);

/** Numeric sort key (YYYYMMDD) or null for invalid input. */
export function dateKey(value) {
  const p = parseDate(value);
  return p ? p.y * 10000 + p.m * 100 + p.d : null;
}

export function weekday(value) {
  const p = parseDate(value);
  return p ? t('date.weekdays')[new Date(p.y, p.m - 1, p.d).getDay()] : '';
}

export function formatDate(value, { withWeekday = false } = {}) {
  const p = parseDate(value);
  if (!p) return '';
  const base = `${p.y}.${pad(p.m)}.${pad(p.d)}`;
  return withWeekday ? `${base} (${weekday(value)})` : base;
}

export function formatShortDate(value) {
  const p = parseDate(value);
  return p ? `${pad(p.m)}.${pad(p.d)} (${weekday(value)})` : '';
}

export function formatRange(start, end) {
  const s = formatDate(start);
  if (!s) return '';
  if (!isValidDate(end) || dateKey(end) <= dateKey(start)) return s;
  const ps = parseDate(start);
  const pe = parseDate(end);
  const e = ps.y === pe.y ? `${pad(pe.m)}.${pad(pe.d)}` : formatDate(end);
  return `${s} – ${e}`;
}

export function addDays(value, n) {
  const p = parseDate(value);
  if (!p) return '';
  return toDateString(new Date(p.y, p.m - 1, p.d + n));
}

export function isEndBeforeStart(start, end) {
  const ks = dateKey(start);
  const ke = dateKey(end);
  return ks !== null && ke !== null && ke < ks;
}

export function isWithinRange(value, start, end) {
  const k = dateKey(value);
  const ks = dateKey(start);
  if (k === null || ks === null) return false;
  const ke = dateKey(end) ?? ks;
  return k >= ks && k <= Math.max(ks, ke);
}

/** Every date from start to end (inclusive); a missing end means a one-day shoot. */
export function dateRange(start, end, limit = 62) {
  if (!isValidDate(start)) return [];
  const last = isValidDate(end) && dateKey(end) >= dateKey(start) ? end : start;
  const out = [];
  let cur = start;
  while (dateKey(cur) <= dateKey(last) && out.length < limit) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function formatTimestamp(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  return `${formatDate(toDateString(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRelative(ms, now = new Date()) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = toDateString(d);
  if (day === toDateString(now)) return t('date.todayAt', { time });
  if (day === addDays(toDateString(now), -1)) return t('date.yesterdayAt', { time });
  return formatDate(day);
}
