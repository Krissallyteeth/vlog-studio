import { getLang } from '../i18n/index.js';
import { METRIC } from './metrics.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** One consistent display per metric kind: 17.5% · 1,669 · 61.3s. Blank stays blank. */
export function fmt(metricKey, v, { digits } = {}) {
  if (!isNum(v)) return '';
  const m = METRIC[metricKey];
  if (m?.kind === 'pct') return `${(v * 100).toFixed(digits ?? 1)}%`;
  if (m?.kind === 'sec') return `${Math.round(v * 10) / 10}s`;
  return Math.round(v * 100) / 100 === Math.round(v) ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 100) / 100).toLocaleString('en-US');
}

/** Value for an edit box: percent in percent units (17.5), counts plain. */
export function toEditText(metricKey, v) {
  if (!isNum(v)) return '';
  return METRIC[metricKey]?.kind === 'pct' ? String(Math.round(v * 1e6) / 1e4) : String(v);
}

/**
 * Parses typed or pasted text. Percent metrics are always in percent units ("17.5" or "17.5%"
 * → 0.175). Empty → null (blank), "0" → 0. Returns undefined when the text is not a number.
 */
export function parseInput(metricKey, text) {
  const s = String(text ?? '').trim().replace(/,/g, '').replace(/[％]/g, '%');
  if (s === '' || s === '-') return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*(%|s|秒|초)?$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  return METRIC[metricKey]?.kind === 'pct' ? Number((n / 100).toPrecision(12)) : n;
}

export const signedPct = (v) => (isNum(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '');
export const won = (v) => (isNum(v) ? (getLang() === 'ko' ? `${Math.round(v).toLocaleString('ko-KR')}원` : `₩${Math.round(v).toLocaleString('en-US')}`) : '');
export const yuan = (v) => (isNum(v) ? `${Math.round(v * 100) / 100}元` : '');
