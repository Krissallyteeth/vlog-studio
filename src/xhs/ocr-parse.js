import { METRIC } from './metrics.js';

/*
 * Turns OCR words (text + confidence + bounding box) from a 小红书 statistics screenshot into
 * metric values. Pure and testable: no OCR engine here.
 *  - Labels are matched on the line text with spaces removed (Chinese OCR splits characters).
 *  - The value is the nearest number to the right on the same line, or directly above / below
 *    the label (cards show "1,669" over "曝光量"). Each number is used once.
 *  - Values with low confidence, a missing/extra "%", or an odd format are returned as
 *    { status: 'check', candidate } and never filled in silently.
 */

export const OCR_LABELS = [
  ['exposure', ['曝光量', '曝光数', '曝光']],
  ['views', ['观看数', '观看量', '浏览量', '阅读量']],
  ['ctr', ['封面点击率', '点击率']],
  ['exit2s', ['2秒退出率', '2s退出率', '2秒跳出率']],
  ['retain5s', ['5秒完播率', '5s完播率']],
  ['interactionRate', ['互动率']],
  ['likes', ['点赞数', '点赞']],
  ['comments', ['评论数', '评论']],
  ['danmaku', ['弹幕数', '弹幕']],
  ['favorites', ['收藏数', '收藏']],
  ['shares', ['分享数', '分享']],
  ['newFollowers', ['涨粉丝', '涨粉数', '涨粉', '新增粉丝', '新增关注']],
  ['duration', ['视频时长']],
  ['avgWatch', ['平均观看时长', '人均观看时长', '平均播放时长']],
  ['plays60s', ['60秒播放数', '60s播放数', '60秒播放量']],
  ['completion', ['全片完播率', '完播率']],
];

const MIN_CONF = 80;

const toHalf = (s) =>
  String(s)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.');

const NUM_RE = /^[+-]?\d[\d,]*(?:\.\d+)?(?:%|万|w|W|k|K|秒|s|分|:)?$|^\d{1,2}:\d{2}(?::\d{2})?$|^\d+分\d+秒$/;

/** "1.2万" → 12000 · "17.5%" → 0.175 · "1:05" / "1分5秒" / "65秒" → 65 · "1,669" → 1669. */
export function parseNumber(text) {
  const s = toHalf(text).replace(/\s+/g, '');
  let m;
  if ((m = /^(\d+)分(\d+(?:\.\d+)?)秒$/.exec(s))) return { value: Number(m[1]) * 60 + Number(m[2]), unit: 'sec' };
  if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s))) return { value: m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]), unit: 'sec' };
  if ((m = /^([+-]?\d[\d,]*(?:\.\d+)?)(%|万|w|W|k|K|秒|s)?$/.exec(s))) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const u = m[2];
    if (u === '%') return { value: Number((n / 100).toPrecision(12)), unit: 'pct' };
    if (u === '万' || u === 'w' || u === 'W') return { value: Math.round(n * 10000), unit: 'count', approx: true };
    if (u === 'k' || u === 'K') return { value: Math.round(n * 1000), unit: 'count', approx: true };
    if (u === '秒' || u === 's') return { value: n, unit: 'sec' };
    return { value: n, unit: 'plain' };
  }
  return null;
}

const box = (ws) => ({
  x0: Math.min(...ws.map((w) => w.bbox.x0)),
  y0: Math.min(...ws.map((w) => w.bbox.y0)),
  x1: Math.max(...ws.map((w) => w.bbox.x1)),
  y1: Math.max(...ws.map((w) => w.bbox.y1)),
});

/** Number tokens: adjacent number-ish words on a line are joined ("17.5" + "%"). */
function numberTokens(line, labelWords) {
  const out = [];
  let cur = null;
  for (const w of line.words) {
    if (labelWords.has(w)) {
      cur = null;
      continue; // the "2" of "2秒退出率" is part of a label, not a value
    }
    const tx = toHalf(w.text).replace(/\s+/g, '');
    const numberish = /^[\d.,:%+\-万wWkK秒s分]+$/.test(tx) && /\d|%|万|秒/.test(tx);
    const gap = cur ? w.bbox.x0 - cur.words.at(-1).bbox.x1 : Infinity;
    const h = w.bbox.y1 - w.bbox.y0;
    if (numberish && cur && gap < h * 0.6) {
      cur.words.push(w);
      cur.text += tx;
    } else if (numberish) {
      cur = { words: [w], text: tx };
      out.push(cur);
    } else cur = null;
  }
  return out
    .filter((tk) => NUM_RE.test(tk.text))
    .map((tk) => ({ text: tk.text, conf: Math.min(...tk.words.map((w) => w.confidence ?? 0)), bbox: box(tk.words), parsed: parseNumber(tk.text) }))
    .filter((tk) => tk.parsed);
}

/** Labels on a line: longest alias first, each character used once. */
function labelsOnLine(line) {
  // Character → word map over the space-free line text.
  const chars = [];
  for (const w of line.words) for (const ch of toHalf(w.text).replace(/\s+/g, '')) chars.push({ ch, w });
  const text = chars.map((c) => c.ch).join('');
  const used = new Array(text.length).fill(false);
  const found = [];
  const all = OCR_LABELS.flatMap(([key, names]) => names.map((n) => ({ key, n }))).sort((a, b) => b.n.length - a.n.length);
  for (const { key, n } of all) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(n, from);
      if (i < 0) break;
      from = i + 1;
      if (used.slice(i, i + n.length).some(Boolean)) continue;
      used.fill(true, i, i + n.length);
      const words = [...new Set(chars.slice(i, i + n.length).map((c) => c.w))];
      found.push({ key, label: n, words, bbox: box(words), conf: Math.min(...chars.slice(i, i + n.length).map((c) => c.w.confidence ?? 0)) });
    }
  }
  return found;
}

function fitsKind(key, parsed) {
  const kind = METRIC[key].kind;
  if (kind === 'pct') return parsed.unit === 'pct';
  if (kind === 'sec') return parsed.unit === 'sec' || parsed.unit === 'plain';
  return parsed.unit === 'plain' || parsed.unit === 'count';
}

/**
 * lines: [{ words: [{ text, confidence, bbox: { x0, y0, x1, y1 } }] }] (tesseract.js result.data.lines)
 * Returns { values: { key: { status: 'ok'|'check', value?, candidate?, text, conf, reason? } }, labels, numbers }.
 */
export function extractMetrics(lines) {
  const labels = [];
  const numbers = [];
  for (const line of lines) {
    if (!line?.words?.length) continue;
    const found = labelsOnLine(line);
    labels.push(...found);
    numbers.push(...numberTokens(line, new Set(found.flatMap((l) => l.words))));
  }
  // Candidate pairs with a distance; greedy, shortest first; one number per label and vice versa.
  const pairs = [];
  for (const [li, l] of labels.entries()) {
    const lh = l.bbox.y1 - l.bbox.y0 || 10;
    const lc = (l.bbox.x0 + l.bbox.x1) / 2;
    for (const [ni, n] of numbers.entries()) {
      const nc = (n.bbox.x0 + n.bbox.x1) / 2;
      const nh = n.bbox.y1 - n.bbox.y0 || 10;
      const sameLine = Math.abs((n.bbox.y0 + n.bbox.y1) / 2 - (l.bbox.y0 + l.bbox.y1) / 2) < Math.max(lh, nh) * 0.6;
      let d = null;
      if (sameLine && n.bbox.x0 >= l.bbox.x1 - 2) d = (n.bbox.x0 - l.bbox.x1) * 0.25; // same line, to the right: preferred
      else {
        const overlapX = Math.abs(nc - lc) < Math.max(l.bbox.x1 - l.bbox.x0, n.bbox.x1 - n.bbox.x0) * 0.75;
        const below = n.bbox.y0 - l.bbox.y1;
        const above = l.bbox.y0 - n.bbox.y1;
        if (overlapX && above >= -2 && above < lh * 4) d = above * 1.1 + 5; // value over label (card layout)
        else if (overlapX && below >= -2 && below < lh * 4) d = below * 1.3 + 8;
      }
      if (d != null) pairs.push({ li, ni, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedL = new Set();
  const usedN = new Set();
  const values = {};
  for (const p of pairs) {
    if (usedL.has(p.li) || usedN.has(p.ni)) continue;
    const l = labels[p.li];
    if (values[l.key]) continue;
    usedL.add(p.li);
    usedN.add(p.ni);
    const n = numbers[p.ni];
    const kindOk = fitsKind(l.key, n.parsed);
    const conf = Math.min(n.conf, l.conf);
    const reason = !kindOk ? 'format' : n.conf < MIN_CONF ? 'confidence' : n.parsed.approx ? 'rounded' : '';
    values[l.key] = reason
      ? { status: 'check', candidate: n.parsed.value, text: n.text, conf, reason, bbox: n.bbox }
      : { status: 'ok', value: n.parsed.value, text: n.text, conf, bbox: n.bbox };
  }
  return { values, labels, numbers };
}

/** Combines the results of several screenshots of the same post: equal values agree, different ones conflict. */
export function mergeResults(results) {
  const merged = {};
  for (const [idx, r] of results.entries()) {
    for (const [key, v] of Object.entries(r.values)) {
      (merged[key] ??= []).push({ ...v, image: idx });
    }
  }
  const out = {};
  for (const [key, list] of Object.entries(merged)) {
    const sure = list.filter((v) => v.status === 'ok');
    const distinct = [...new Set(sure.map((v) => v.value))];
    if (distinct.length > 1) out[key] = { status: 'conflict', options: sure };
    else if (distinct.length === 1) out[key] = { status: 'ok', value: distinct[0], from: sure };
    else out[key] = { status: 'check', options: list };
  }
  return out;
}
