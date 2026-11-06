import { t } from '../../i18n/index.js';
import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt, parseInput, toEditText, yuan } from '../../xhs/format.js';
import { METRICS, VALIDITY, computeStage } from '../../xhs/metrics.js';
import { judge, validSeq } from '../../xhs/stats.js';
import { postAdSummary } from '../../xhs/ad-report.js';

/*
 * Columns of the "XHS배포기록" table, in the original sheet order (B … AX), plus the app's
 * content-type column and any extra columns found in an imported file.
 */

const CF = { good: 'cf-good', mid: 'cf-mid', bad: 'cf-bad' };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function postColumns({ contentTypes, extraKeys = [] }) {
  const base = (id, label, sub, opts = {}) => ({ id, label, sub, group: t('xg.base'), ...opts });
  const cols = [
    base('no', 'No.', '', { num: true, editable: true, width: 52, excel: 'B', kind: 'int' }),
    base('title', '배포내용', t('xg.title'), { editable: true, width: 200, excel: 'D', kind: 'text' }),
    base('followers', '粉丝', t('xg.followers'), { num: true, editable: true, excel: 'C', kind: 'int' }),
    base('date', '배포일자', '', { editable: true, width: 112, excel: 'E', kind: 'date', inputType: 'date' }),
    base('time', '배포시간', '', { editable: true, width: 76, excel: 'F', kind: 'time', inputType: 'time' }),
    base('contentType', t('xg.type'), t('xg.appOnly'), { editable: true, width: 120, kind: 'text', options: contentTypes }),
    { id: 'adDecisionD1', label: '推广判断', sub: t('xg.adD'), group: 'D', editable: true, width: 96, excel: 'G', kind: 'text' },
  ];
  for (const stage of ['d1', 'd2']) {
    const group = stage === 'd1' ? 'D+1' : 'D+2';
    const groupCls = stage === 'd1' ? 'grid-d1' : 'grid-d2';
    for (const m of METRICS) {
      const computed = m.computed || (stage === 'd2' && m.computedD2);
      cols.push({
        id: `${stage}.${m.key}`,
        stage,
        metric: m.key,
        label: m.zh,
        sub: t(`m.${m.key}`),
        group,
        groupCls,
        num: true,
        editable: !computed,
        computed,
        excel: m[stage],
        kind: 'metric',
        title: computed ? t(`formula.${m.key}`) : '',
      });
    }
    if (stage === 'd1') {
      cols.push({ id: 'expectedFollowersD1', label: '예상 팔로워 증가수', sub: '', group, groupCls, num: true, editable: true, excel: 'Z', kind: 'int' });
      cols.push({ id: 'adAux', label: '推广判断3', sub: t('xg.adAux'), group, groupCls, editable: true, width: 110, excel: 'AA', kind: 'text' });
    } else {
      cols.push({ id: 'adDecisionD2', label: '推广判断2', sub: t('xg.adD2'), group, groupCls, editable: true, width: 110, excel: 'AT', kind: 'text' });
      cols.push({ id: 'expectedFollowersD2', label: '예상 팔로워 증가수2', sub: '', group, groupCls, num: true, editable: true, excel: 'AU', kind: 'int' });
    }
  }
  // Ads of the post, from every ad record (workbook memo, screenshots, a multi-note order's share).
  const adg = (id, label, sub, field) => ({ id, label, sub, group: t('xg.adGroup'), num: true, editable: false, computed: true, width: 96, kind: 'ad', field, title: t('xg.adColHelp') });
  cols.push(adg('adSpend', t('xg.adSpend'), t('xg.adSpendSub'), 'spend'));
  cols.push(adg('adPerFollow', t('xg.adPerFollow'), t('xg.adPerFollowSub'), 'perFollow'));
  const tail = (id, label, sub, opts) => ({ id, label, sub, group: t('xg.tail'), ...opts });
  cols.push(tail('memo', '备注', t('xg.memo'), { editable: true, width: 220, excel: 'AV', kind: 'text' }));
  cols.push(tail('validity', 'D+1 유효성', '', { editable: true, width: 96, excel: 'AW', kind: 'text', options: VALIDITY }));
  cols.push(tail('validSeq', '유효순번', '', { num: true, editable: false, computed: true, width: 64, excel: 'AX', kind: 'int', title: t('formula.validSeq') }));
  for (const key of extraKeys) cols.push({ id: `extra.${key}`, label: key, sub: t('xg.extra'), group: t('xg.extraGroup'), editable: true, width: 120, kind: 'text', extra: key });
  return cols;
}

/** Value stored in a post for a column (metrics: D+1/D+2 incl. computed). */
export function postValue(post, col, ctx) {
  if (col.kind === 'metric') {
    if (col.computed) return computeStage(post[col.stage], post.d1?.duration)[col.metric];
    return post[col.stage]?.[col.metric] ?? null;
  }
  if (col.id === 'validSeq') return ctx.seq.get(post.id) ?? null;
  if (col.kind === 'ad') return postAdSummary(post)[col.field] ?? null;
  if (col.extra) return post.extra?.[col.extra] ?? '';
  return post[col.id] ?? (col.num ? null : '');
}

export function applyValue(post, col, value) {
  if (col.kind === 'metric') post[col.stage] = { ...post[col.stage], [col.metric]: value };
  else if (col.extra) post.extra = { ...post.extra, [col.extra]: value };
  else post[col.id] = value;
}

export function parseCell(col, text) {
  const s = String(text ?? '').trim();
  if (col.kind === 'metric') {
    const v = parseInput(col.metric, s);
    return v === undefined ? { ok: false } : { ok: true, value: v };
  }
  if (col.kind === 'int') {
    if (s === '') return { ok: true, value: null };
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
  }
  if (col.kind === 'date') {
    if (s === '') return { ok: true, value: '' };
    const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
    return m ? { ok: true, value: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` } : { ok: false };
  }
  if (col.kind === 'time') {
    if (s === '') return { ok: true, value: '' };
    const m = /^(\d{1,2}):(\d{2})/.exec(s);
    return m && Number(m[1]) < 24 ? { ok: true, value: `${m[1].padStart(2, '0')}:${m[2]}` } : { ok: false };
  }
  if (col.options && s && !col.options.includes(s)) return col.id === 'contentType' ? { ok: true, value: s } : { ok: false };
  return { ok: true, value: s };
}

export function editTextOf(col, v) {
  if (col.kind === 'metric') return toEditText(col.metric, v);
  return v == null ? '' : String(v);
}

/** Cell display: number format, conditional colour, formula-difference marker, row badges. */
export function renderPostCell(post, col, v, ctx) {
  if (col.id === 'title') {
    const badge = post.validity === '광고혼입' ? `<span class="badge cf-mid">${esc(t('xg.admixed'))}</span>` : post.isNew ? `<span class="badge cf-good">${esc(t('xg.new'))}</span>` : '';
    return { text: v, html: `<span class="inline-flex w-full items-center gap-1"><span class="truncate">${esc(v || t('xg.untitled'))}</span>${badge}<button type="button" class="grid-open" data-open-row="${ctx.rowIndex(post)}" aria-label="${esc(t('xg.open'))}">${icon('chevronRight', 'size-4')}</button></span>` };
  }
  if (col.kind === 'metric') {
    const text = fmt(col.metric, v);
    let cls = '';
    let title = '';
    if (col.stage === 'd1' && ctx.baseline) {
      const j = judge(col.metric, v, ctx.baseline.medians[col.metric], post.validity);
      cls = CF[j] ?? '';
      if (j && post.validity === '광고혼입') title = t('xg.adRef');
    }
    let html;
    if (col.computed && post.source?.cells?.[col.excel] && isNum(post.source.cells[col.excel].v) && isNum(v) && Math.abs(post.source.cells[col.excel].v - v) > 1e-9) {
      title = t('xg.formulaDiff', { excel: post.source.cells[col.excel].w });
      html = `${esc(text)}<span class="formula-diff-mark"></span>`;
    }
    return { text, cls, title, html };
  }
  if (col.kind === 'ad') return { text: isNum(v) ? yuan(v) : '', html: isNum(v) ? `<a class="link-btn" href="#/c/${encodeURIComponent(post.id)}">${esc(yuan(v))}</a>` : '' };
  if (col.id === 'validity') return { text: v, cls: v === '유효' ? 'cf-good' : v ? 'cf-mid' : '' };
  if (col.id === 'adAux' || col.id === 'adDecisionD2') return { text: v, cls: /진행/.test(v) ? 'cf-mid' : '' };
  if (col.kind === 'int') return { text: isNum(v) ? v.toLocaleString('en-US') : '' };
  return { text: v ?? '' };
}

export const postSeq = (posts) => validSeq(posts);
