import { METRICS, METRIC, computeStage } from './metrics.js';
import { buildBaseline, criteria, validSeq } from './stats.js';
import { normalizeAd, normalizeIncome, normalizePost } from './store.js';

/*
 * Reads the original workbook (4 sheets) into an import plan WITHOUT saving anything.
 * The plan keeps every original cell (value, formula, displayed text, address), compares each
 * imported value with the source, and reproduces each sheet formula to report differences.
 * Works on an ExcelJS Workbook so the same code runs in the browser and in Node.
 */

export const SHEETS = { posts: 'XHS배포기록', income: '수익기록', criteria: '성과기준', rules: '기준' };

// ── Cell reading ──────────────────────────────────────
const EPOCH = Date.UTC(1899, 11, 30);
const pad = (n) => String(n).padStart(2, '0');

/*
 * ExcelJS drops a cached formula result of 0 (it reads it as "no result"). The cached values are
 * therefore read straight from the sheet XML as well, and used for every formula cell.
 */
export async function cachedFormulaValues(bytes) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const text = async (path) => (await zip.file(path)?.async('string')) ?? '';
  const wbXml = await text('xl/workbook.xml');
  const rels = await text('xl/_rels/workbook.xml.rels');
  const shared = [...(await text('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unxml(x[1])).join(''));
  const target = Object.fromEntries([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const out = {};
  for (const m of wbXml.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const name = unxml(m[1]);
    const path = `xl/${target[m[2]].replace(/^\/?xl\//, '')}`;
    const xml = await text(path);
    const cells = new Map();
    for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      if (!/<f[\s>/]/.test(c[3])) continue;
      const type = /t="(\w+)"/.exec(c[2])?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[3])?.[1];
      if (v === undefined) cells.set(c[1], null);
      else if (type === 's') cells.set(c[1], shared[Number(v)]);
      else if (type === 'str' || type === 'e') cells.set(c[1], unxml(v));
      else if (type === 'b') cells.set(c[1], v === '1');
      else cells.set(c[1], Number(v));
    }
    out[name] = cells;
  }
  return out;
}
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

let CACHED = {}; // sheet name → Map(address → cached value), set per import

/** ExcelJS cell → { v, f, w, t } with v JSON-safe: number | string | boolean | 'YYYY-MM-DD' | 'HH:MM'. */
export function readCell(cell, sheetName) {
  if (!cell || cell.value == null || cell.value === '') return null;
  if (cell.isMerged && cell.master !== cell) return null; // merged area: only the top-left cell holds data
  let raw = cell.value;
  let f;
  if (typeof raw === 'object' && !(raw instanceof Date)) {
    if ('formula' in raw || 'sharedFormula' in raw) {
      f = raw.formula ?? cell.formula ?? raw.sharedFormula;
      const cached = CACHED[sheetName];
      raw = cached?.has(cell.address) ? cached.get(cell.address) : raw.result;
      if (raw && typeof raw === 'object' && 'error' in raw) raw = `#${raw.error}`;
    } else if ('richText' in raw) raw = raw.richText.map((r) => r.text).join('');
    else if ('text' in raw) raw = raw.text;
    else if ('error' in raw) raw = `#${raw.error}`;
  }
  const numFmt = cell.numFmt || 'General';
  let v = raw;
  let t = typeof raw;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    if (ms < Date.UTC(1900, 0, 1)) {
      // time-only value (Excel day fraction)
      v = `${pad(raw.getUTCHours())}:${pad(raw.getUTCMinutes())}${raw.getUTCSeconds() ? `:${pad(raw.getUTCSeconds())}` : ''}`;
      t = 'time';
    } else {
      v = `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`;
      t = 'date';
    }
  } else if (typeof raw === 'number' && /h+:mm/i.test(numFmt) && raw < 1 && raw >= 0) {
    const mins = Math.round(raw * 1440);
    v = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
    t = 'time';
  } else if (typeof raw === 'number' && /(^|[^a-z])(yy|mm-dd|dd)/i.test(numFmt) && raw > 1000) {
    const d = new Date(EPOCH + raw * 86400000);
    v = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    t = 'date';
  }
  if (v === '' || v == null) return f ? { v: null, f, w: '', t: 'blank', numFmt } : null;
  return { v, f, w: display(v, t, numFmt), t, numFmt };
}

/** How Excel shows the value (percent with the cell's decimals, grouping, dates as YYYY-MM-DD). */
export function display(v, t, numFmt = 'General') {
  if (typeof v !== 'number') return String(v);
  if (numFmt.includes('%')) {
    const dec = (numFmt.split('%')[0].split('.')[1] ?? '').replace(/[^0]/g, '').length;
    const s = (v * 100).toFixed(dec);
    return `${numFmt.startsWith('\\+') && v > 0 ? '+' : ''}${s}%`;
  }
  if (/#,##0/.test(numFmt)) return Math.round(v).toLocaleString('en-US');
  return String(Math.round(v * 1e10) / 1e10);
}

function sheetCells(ws) {
  const rows = new Map(); // rowNumber → Map(col letter → cell info)
  let nonEmpty = 0;
  let formulas = 0;
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const c = readCell(cell, ws.name);
      if (!c) return;
      nonEmpty++;
      if (c.f) formulas++;
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r).set(colLetter(cell.col), c);
    });
  });
  return { rows, nonEmpty, formulas, rowCount: ws.actualRowCount ?? ws.rowCount, colCount: ws.actualColumnCount ?? ws.columnCount };
}

export function colLetter(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

// ── Header mapping (by name, so a column moved or added is still recognised) ──
const FIXED_HEADERS = {
  'No.': 'no',
  粉丝: 'followers',
  배포내용: 'title',
  배포일자: 'date',
  배포시간: 'time',
  推广判断: 'adDecisionD1',
  推广判断3: 'adAux',
  推广判断2: 'adDecisionD2',
  '예상 팔로워 증가수': 'expectedFollowersD1',
  '예상 팔로워 증가수2': 'expectedFollowersD2',
  备注: 'memo',
  'D+1 유효성': 'validity',
  유효순번: 'validSeq',
  '유형(앱)': 'contentType', // written by the app's own Excel export
};

function headerField(name) {
  const h = String(name ?? '').trim();
  if (FIXED_HEADERS[h]) return { field: FIXED_HEADERS[h] };
  for (const m of METRICS) {
    const names = [m.zh, m.excelName, ...(m.aliases ?? [])].filter(Boolean);
    if (names.includes(h)) return { stage: 'd1', metric: m.key };
    if (names.some((n) => `${n}2` === h)) return { stage: 'd2', metric: m.key };
  }
  return null;
}

const TEXT_FIELDS = ['contentType', 'title', 'date', 'time', 'adDecisionD1', 'adAux', 'adDecisionD2', 'memo', 'validity'];
const NUM_FIELDS = ['no', 'followers', 'expectedFollowersD1', 'expectedFollowersD2'];

const toNum = (c) => (c && typeof c.v === 'number' ? c.v : null);
const close = (a, b) => (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

/** Ads written in the sheet as notes ("진행(60元)", "75元"). Times/goal are unknown → review needed. */
export function adsFromNotes(post) {
  const out = [];
  const notes = [
    ['D', post.adDecisionD1],
    ['D+1', post.adAux],
    ['D+2', post.adDecisionD2],
  ];
  for (const [stage, text] of notes) {
    const m = /(\d+(?:\.\d+)?)\s*元/.exec(text || '');
    if (!m) continue;
    out.push(normalizeAd({ stage, executed: true, spend: Number(m[1]), sourceText: text, needsReview: true }));
  }
  return out;
}

const fmtApp = (metricKey, v) => {
  if (v == null) return '';
  const m = METRIC[metricKey];
  return m?.kind === 'pct' ? `${(v * 100).toFixed(2).replace(/\.?0+$/, '')}%` : String(Math.round(v * 1e10) / 1e10);
};

// ── Posts sheet ───────────────────────────────────────
function parsePosts(ws, fileName) {
  const { rows, nonEmpty, formulas, rowCount, colCount } = sheetCells(ws);
  let headerRow = null;
  for (const [r, cells] of rows) {
    const vals = [...cells.values()].map((c) => String(c.v));
    if (vals.includes('No.') && vals.includes('曝光量')) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) throw new Error('posts-header-not-found');
  const headers = rows.get(headerRow);
  const mapping = new Map(); // col → mapping
  const unknownColumns = [];
  for (const [col, c] of headers) {
    const h = headerField(c.v);
    if (h) mapping.set(col, { ...h, header: String(c.v) });
    else {
      mapping.set(col, { extra: String(c.v), header: String(c.v) });
      unknownColumns.push({ col, header: String(c.v) });
    }
  }
  const headerText = new Map([...rows.entries()].filter(([r]) => r < headerRow).flatMap(([r, cells]) => [...cells].map(([col, c]) => [`${col}${r}`, c.v])));

  const records = [];
  const comparisons = [];
  let formulaOnlyRows = 0;
  let formulaOnlyCells = 0;
  for (const [r, cells] of rows) {
    if (r <= headerRow) continue;
    const inputCells = [...cells.entries()].filter(([, c]) => !c.f);
    if (!inputCells.length) {
      formulaOnlyRows++;
      formulaOnlyCells += cells.size;
      continue; // template rows that hold only formulas (e.g. 유효순번 down to row 107)
    }
    const raw = { d1: {}, d2: {}, extra: {} };
    const formulaCells = {};
    const sourceCells = {};
    for (const [col, c] of cells) {
      sourceCells[col] = { v: c.v, f: c.f, w: c.w };
      const map = mapping.get(col);
      if (!map) {
        raw.extra[`열 ${col}`] = c.v; // data under no header: kept, never dropped
        continue;
      }
      if (c.f) {
        formulaCells[col] = { ...c, map };
        if (map.stage && !METRIC[map.metric].computed && !(map.stage === 'd2' && METRIC[map.metric].computedD2)) raw[map.stage][map.metric] = toNum(c);
        continue;
      }
      const derived = map.stage && (METRIC[map.metric].computed || (map.stage === 'd2' && METRIC[map.metric].computedD2));
      if (derived || map.field === 'validSeq') {
        formulaCells[col] = { ...c, map }; // a calculated column saved as a plain value: verify, don't store
        continue;
      }
      if (map.extra) raw.extra[map.extra] = c.v;
      else if (map.stage) raw[map.stage][map.metric] = toNum(c);
      else if (NUM_FIELDS.includes(map.field)) raw[map.field] = toNum(c);
      else if (TEXT_FIELDS.includes(map.field)) raw[map.field] = c.v == null ? '' : String(c.v);
    }
    // D+2 duration was a formula copying D+1 (AO = U); no separate input exists.
    const post = normalizePost({
      ...raw,
      source: { file: fileName, sheet: ws.name, row: r, importedAt: Date.now(), cells: sourceCells },
    });
    post.ads = adsFromNotes(post);
    records.push(post);

    // Cell-by-cell comparison: original value vs value the app will store.
    for (const [col, c] of cells) {
      const map = mapping.get(col);
      const base = { row: r, col, cell: `${col}${r}`, header: map?.header ?? `열 ${col}`, post: post.title, excel: c.w, formula: c.f ?? '' };
      if (!map || map.extra) {
        comparisons.push({ ...base, app: String(c.v ?? ''), status: 'ok', kind: 'extra' });
        continue;
      }
      if (formulaCells[col]) continue; // checked below against the app's own calculation
      if (map.stage) {
        const stored = post[map.stage][map.metric];
        const bad = c.v != null && typeof c.v !== 'number';
        comparisons.push({ ...base, field: `${map.stage}.${map.metric}`, app: fmtApp(map.metric, stored), status: bad ? 'check' : close(c.v, stored) ? 'ok' : 'mismatch', note: bad ? 'not-a-number' : '' });
      } else if (map.field) {
        const stored = post[map.field];
        const same = NUM_FIELDS.includes(map.field) ? close(toNum(c), stored) : String(c.v ?? '') === String(stored ?? '') || (map.field === 'time' && String(c.v).slice(0, 5) === stored);
        const check = map.field === 'validity' && !['유효', '광고혼입', '미확인'].includes(String(c.v));
        comparisons.push({ ...base, field: map.field, app: String(stored ?? ''), status: check ? 'check' : same ? 'ok' : 'mismatch' });
      }
    }
    // Formula cells: the sheet's cached result vs the app's calculation.
    const d1 = computeStage(post.d1);
    const d2 = computeStage(post.d2, post.d1.duration);
    for (const [col, c] of Object.entries(formulaCells)) {
      const map = c.map;
      let app = null;
      if (map.stage) app = (map.stage === 'd1' ? d1 : d2)[map.metric];
      else if (map.field === 'validSeq') app = 'seq';
      if (app === 'seq') {
        comparisons.push({ row: r, col, cell: `${col}${r}`, header: map.header, post: post.title, field: 'validSeq', excel: c.w, formula: c.f ?? '', app: '', status: 'pending-seq', kind: 'formula', excelValue: toNum(c) });
        continue;
      }
      const excelValue = typeof c.v === 'number' ? c.v : null;
      const status = close(excelValue, app) ? 'formula-ok' : 'formula-diff';
      comparisons.push({ row: r, col, cell: `${col}${r}`, header: map.header, post: post.title, field: map.stage ? `${map.stage}.${map.metric}` : map.field, excel: c.w, formula: c.f ?? '', app: fmtApp(map.metric, app), status, kind: 'formula' });
    }
  }
  // 유효순번 depends on all rows.
  const seq = validSeq(records);
  for (const cmp of comparisons.filter((x) => x.status === 'pending-seq')) {
    const p = records.find((x) => x.source.row === cmp.row);
    const app = seq.get(p.id) ?? null;
    cmp.app = app == null ? '' : String(app);
    cmp.status = close(cmp.excelValue, app) ? 'formula-ok' : 'formula-diff';
  }
  return { records, comparisons, headerRow, unknownColumns, headers: [...headers].map(([col, c]) => ({ col, header: String(c.v), map: mapping.get(col) })), headerText: Object.fromEntries(headerText), stats: { rowCount, colCount, nonEmpty, formulas, formulaOnlyRows, formulaOnlyCells } };
}

// ── Income sheet ──────────────────────────────────────
const INCOME_HEADERS = {
  'No.': 'no',
  플랫폼: 'platform',
  '협업 브랜드': 'brand',
  '협업 유형': 'collabType',
  '콘텐츠 내용': 'content',
  '제공 제품·서비스': 'product',
  '현물 협찬 가치': 'inKind',
  '현금 광고 수익': 'cash',
  배포일자: 'date',
  비고: 'note',
};

function parseIncome(ws, fileName) {
  const { rows, nonEmpty, formulas, rowCount, colCount } = sheetCells(ws);
  let headerRow = null;
  let factor = 1;
  let unitText = '';
  for (const [r, cells] of rows) {
    for (const c of cells.values()) {
      const s = String(c.v);
      if (/단위/.test(s)) {
        unitText = s;
        if (/만\s*원/.test(s)) factor = 10000;
        else if (/천\s*원/.test(s)) factor = 1000;
      }
    }
    const vals = [...cells.values()].map((c) => String(c.v));
    if (!headerRow && vals.includes('플랫폼')) headerRow = r;
  }
  if (!headerRow) return { records: [], comparisons: [], stats: { rowCount, colCount, nonEmpty, formulas }, factor, unitText, headerRow: null };
  const headers = rows.get(headerRow);
  const records = [];
  const comparisons = [];
  for (const [r, cells] of rows) {
    if (r <= headerRow) continue;
    const raw = { extra: {} };
    const sourceCells = {};
    for (const [col, c] of cells) {
      sourceCells[col] = { v: c.v, f: c.f, w: c.w };
      const h = headers.get(col) ? String(headers.get(col).v) : `열 ${col}`;
      const field = INCOME_HEADERS[h];
      if (!field) raw.extra[h] = c.v;
      else if (field === 'inKind') raw.inKindKRW = typeof c.v === 'number' ? Math.round(c.v * factor) : null;
      else if (field === 'cash') raw.cashKRW = typeof c.v === 'number' ? Math.round(c.v * factor) : null;
      else if (field === 'no') raw.no = typeof c.v === 'number' ? c.v : null;
      else raw[field] = c.v == null ? '' : String(c.v);
    }
    const rec = normalizeIncome({ ...raw, source: { file: fileName, sheet: ws.name, row: r, cells: sourceCells, unit: unitText } });
    records.push(rec);
    for (const [col, c] of cells) {
      const h = headers.get(col) ? String(headers.get(col).v) : `열 ${col}`;
      const field = INCOME_HEADERS[h];
      let app = field ? rec[field] : rec.extra[h];
      let ok = String(app ?? '') === String(c.v ?? '');
      if (field === 'inKind' || field === 'cash') {
        app = rec[field === 'inKind' ? 'inKindKRW' : 'cashKRW'];
        ok = close(typeof c.v === 'number' ? c.v * factor : null, app);
      }
      comparisons.push({ row: r, col, cell: `${col}${r}`, header: h, post: rec.brand, excel: c.w, app: app == null ? '' : String(app), status: ok ? 'ok' : 'mismatch', unit: field === 'inKind' || field === 'cash' ? 'krw' : '' });
    }
  }
  return { records, comparisons, stats: { rowCount, colCount, nonEmpty, formulas }, factor, unitText, headerRow };
}

// ── 성과기준 sheet: keep notes, verify each formula against the app ──
const CRITERIA_LABEL_TO_KEY = [
  [/曝光量/, 'exposure'],
  [/观看数/, 'views'],
  [/封面点击率/, 'ctr'],
  [/2秒退出率|2秒推出率/, 'exit2s'],
  [/5秒完播率/, 'retain5s'],
  [/互动率/, 'interactionRate'],
  [/총 인터렉션|总互动/, 'totalInteraction'],
  [/평균 시청 비율|平均观看时长%/, 'avgWatchRatio'],
  [/全片完播率/, 'completion'],
  [/涨粉丝/, 'newFollowers'],
];

const RECENT_COLS = { C: 'exposure', D: 'views', E: 'ctr', F: 'exit2s', G: 'retain5s', H: 'interactionRate', I: 'totalInteraction', J: 'avgWatchRatio', K: 'completion', L: 'newFollowers' };
const TREND_LABEL = { 개선: 'up', 악화: 'down', 유지: 'flat', '표본 확인': 'sample' };

function parseCriteria(ws, posts) {
  const { rows, nonEmpty, formulas, rowCount, colCount } = sheetCells(ws);
  const notes = [];
  const comparisons = [];
  const settings = { core: {} };
  const baseline = buildBaseline(posts);
  const app = criteria(posts, baseline);
  const appRow = (k) => app.rows.find((x) => x.key === k);
  let recentHeaderRow = null;
  for (const [r, cells] of rows) {
    const b = cells.get('B');
    const key = b ? CRITERIA_LABEL_TO_KEY.find(([re]) => re.test(String(b.v)))?.[1] : null;
    if (key && cells.get('D')?.f) {
      const row = appRow(key);
      const J = cells.get('J');
      if (J) settings.core[key] = String(J.v) === '핵심';
      const checks = [
        ['D', 'fixed', row.fixed],
        ['E', 'early', row.early],
        ['F', 'recent', row.recent],
        ['G', 'improvement', row.improvement],
      ];
      for (const [col, what, value] of checks) {
        const c = cells.get(col);
        if (!c) continue;
        const excelValue = typeof c.v === 'number' ? c.v : null;
        comparisons.push({ row: r, col, cell: `${col}${r}`, header: `${b.v} · ${what}`, field: `${key}.${what}`, excel: c.w, formula: c.f ?? '', app: value == null ? '' : display(value, 'number', c.numFmt), status: close(excelValue, value) ? 'formula-ok' : 'formula-diff', kind: 'formula' });
      }
      const h = cells.get('H');
      if (h) comparisons.push({ row: r, col: 'H', cell: `H${r}`, header: `${b.v} · trend`, field: `${key}.trend`, excel: h.w, formula: h.f ?? '', app: row.trend, status: TREND_LABEL[String(h.v)] === row.trend ? 'formula-ok' : 'formula-diff', kind: 'formula' });
      continue;
    }
    // "최근 유효 5편" extraction table (rows below the 유효순번 header): seq, title, values.
    if (recentHeaderRow && r > recentHeaderRow && cells.get('A')?.f) {
      const idx = r - recentHeaderRow - 1;
      const p = app.recent[idx];
      const seqApp = p ? app.validCount - app.recent.length + idx + 1 : null;
      for (const [col, c] of cells) {
        if (!c.f) continue;
        let value;
        let shown;
        if (col === 'A') value = seqApp;
        else if (col === 'B') shown = p?.title ?? '';
        else if (RECENT_COLS[col]) value = p ? computeStage(p.d1)[RECENT_COLS[col]] : null;
        else continue;
        const ok = shown !== undefined ? String(c.v ?? '') === shown : close(typeof c.v === 'number' ? c.v : null, value);
        comparisons.push({ row: r, col, cell: `${col}${r}`, header: `최근 유효 5편 #${idx + 1} · ${col}`, field: `recent5.${idx}.${col}`, excel: c.w, formula: c.f, app: shown ?? (value == null ? '' : display(value, 'number', c.numFmt)), status: ok ? 'formula-ok' : 'formula-diff', kind: 'formula' });
      }
      continue;
    }
    if (cells.get('A')?.v === '유효순번') recentHeaderRow = r;
    // Summary cells (유효 D+1 count, 광고혼입 count, core metrics worsening, priority).
    for (const [col, c] of cells) {
      if (!c.f || r >= 29) continue;
      if (/F6>=3/.test(c.f)) {
        const want = app.priority === 'coverHook' ? '표지·초반 5초 우선 개선' : '지표별 추세 검토';
        comparisons.push({ row: r, col, cell: `${col}${r}`, header: '현재 관리 우선순위', field: 'priority', excel: c.w, formula: c.f, app: want, status: String(c.v) === want ? 'formula-ok' : 'formula-diff', kind: 'formula' });
        continue;
      }
      const label = String(cells.get(String.fromCharCode(col.charCodeAt(0) - 1))?.v ?? '');
      let value = null;
      if (/유효 D\+1/.test(label)) value = app.validCount;
      else if (/광고혼입/.test(label)) value = app.adMixedCount;
      else if (/핵심 4지표/.test(label)) value = app.coreDown;
      else continue;
      comparisons.push({ row: r, col, cell: `${col}${r}`, header: label, field: label, excel: c.w, formula: c.f, app: String(value), status: close(c.v, value) ? 'formula-ok' : 'formula-diff', kind: 'formula' });
    }
    if (r < 9 || r > 20 || !key) {
      for (const [col, c] of cells) if (!c.f && typeof c.v === 'string' && c.v.length > 12 && !/^(영역|D\+1 지표)/.test(c.v)) notes.push({ cell: `${col}${r}`, text: c.v });
    }
  }
  return { notes, comparisons, settings, stats: { rowCount, colCount, nonEmpty, formulas } };
}

function parseRules(ws) {
  const { rows, nonEmpty, formulas, rowCount, colCount } = sheetCells(ws);
  const texts = [];
  for (const [r, cells] of rows) for (const [col, c] of cells) texts.push({ cell: `${col}${r}`, text: String(c.v) });
  return { texts, stats: { rowCount, colCount, nonEmpty, formulas } };
}

// ── Duplicate / conflict detection against stored data ──
const COMPARE_FIELDS = ['followers', 'title', 'date', 'time', 'validity', 'adDecisionD1', 'adAux', 'adDecisionD2', 'memo', 'expectedFollowersD1', 'expectedFollowersD2'];
const keyOf = (p) => `${p.date}|${p.title.replace(/\s+/g, '').toLowerCase()}`;

export function diffPost(existing, incoming) {
  const diffs = [];
  for (const f of COMPARE_FIELDS) if (String(existing[f] ?? '') !== String(incoming[f] ?? '')) diffs.push({ field: f, app: existing[f], excel: incoming[f] });
  for (const stage of ['d1', 'd2']) {
    for (const m of METRICS) {
      if (m.computed) continue;
      const a = existing[stage][m.key];
      const b = incoming[stage][m.key];
      if (!close(a, b)) diffs.push({ field: `${stage}.${m.key}`, app: a, excel: b });
    }
  }
  return diffs;
}

export function matchExisting(records, existingPosts) {
  const byKey = new Map(existingPosts.map((p) => [keyOf(p), p]));
  return records.map((rec) => {
    const ex = byKey.get(keyOf(rec));
    if (!ex) return { record: rec, status: 'new' };
    const diffs = diffPost(ex, rec);
    return { record: rec, existing: ex, status: diffs.length ? 'conflict' : 'same', diffs, choice: diffs.length ? 'keep' : 'skip' };
  });
}

/** Merges an Excel record into an existing post, keeping app-only fields (type, link, screenshots, manual ads). */
export function mergeInto(existing, incoming) {
  const manualAds = existing.ads.filter((a) => !a.sourceText);
  return { ...incoming, id: existing.id, contentType: existing.contentType, projectId: existing.projectId, screenshots: existing.screenshots, ads: [...manualAds, ...incoming.ads], createdAt: existing.createdAt };
}

// ── Entry point ───────────────────────────────────────
export async function sha256(bytes) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Builds the import plan. `wb` is a loaded ExcelJS Workbook, `cached` from cachedFormulaValues. Nothing is written. */
export function planImport(wb, { fileName, hash, cached = {}, existingPosts = [], existingIncome = [], previousImports = [] }) {
  CACHED = cached;
  const byName = Object.fromEntries(wb.worksheets.map((ws) => [ws.name, ws]));
  const found = Object.fromEntries(Object.entries(SHEETS).map(([k, name]) => [k, byName[name] ?? null]));
  if (!found.posts) throw new Error('posts-sheet-not-found');
  const posts = parsePosts(found.posts, fileName);
  const income = found.income ? parseIncome(found.income, fileName) : null;
  const crit = found.criteria ? parseCriteria(found.criteria, posts.records) : null;
  const rules = found.rules ? parseRules(found.rules) : null;
  const matches = matchExisting(posts.records, existingPosts);
  const incomeKey = (x) => `${x.date}|${x.brand}|${x.content}`;
  const existingIncomeKeys = new Set(existingIncome.map(incomeKey));
  const incomeMatches = (income?.records ?? []).map((rec) => ({ record: rec, status: existingIncomeKeys.has(incomeKey(rec)) ? 'same' : 'new' }));

  const all = [...posts.comparisons, ...(income?.comparisons ?? []), ...(crit?.comparisons ?? [])];
  const d1Inputs = METRICS.filter((m) => !m.computed).length;
  const missingCells = posts.records.reduce((n, p) => n + METRICS.filter((m) => !m.computed && p.d1[m.key] == null).length, 0);
  const counts = {
    sheets: Object.values(found).filter(Boolean).length,
    posts: posts.records.length,
    new: matches.filter((m) => m.status === 'new').length,
    duplicate: matches.filter((m) => m.status === 'same').length,
    conflict: matches.filter((m) => m.status === 'conflict').length,
    missingCells,
    d1Expected: d1Inputs * posts.records.length,
    check: all.filter((c) => c.status === 'check').length,
    mismatch: all.filter((c) => c.status === 'mismatch').length,
    formulaOk: all.filter((c) => c.status === 'formula-ok').length,
    formulaDiff: all.filter((c) => c.status === 'formula-diff').length,
    compared: all.length,
    valid: posts.records.filter((p) => p.validity === '유효').length,
    adMixed: posts.records.filter((p) => p.validity === '광고혼입').length,
    income: incomeMatches.length,
    incomeNew: incomeMatches.filter((m) => m.status === 'new').length,
    unknownColumns: posts.unknownColumns.length,
    // Every non-empty original cell is either mapped to a field or kept as an extra field.
    missingRecords: 0,
    missingFields: 0,
  };
  return {
    fileName,
    hash,
    alreadyImported: previousImports.some((x) => x.hash === hash),
    sheets: Object.entries(found).map(([k, ws]) => ({ key: k, name: SHEETS[k], found: !!ws, ...(ws ? { posts: posts.stats, income: income?.stats, criteria: crit?.stats, rules: rules?.stats }[k] : {}) })),
    extraSheets: wb.worksheets.map((ws) => ws.name).filter((n) => !Object.values(SHEETS).includes(n)),
    posts,
    matches,
    income,
    incomeMatches,
    criteria: crit,
    rules,
    comparisons: all,
    counts,
  };
}
