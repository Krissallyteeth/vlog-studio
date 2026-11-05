import { getLang, t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { $, confirmDialog, esc, openSheet, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt, signedPct, won } from '../../xhs/format.js';
import { METRIC } from '../../xhs/metrics.js';
import { criteria, ordered, validSeq } from '../../xhs/stats.js';
import {
  activeBaseline,
  deletePost,
  getBaselines,
  getDocs,
  getSettings,
  listIncome,
  listPosts,
  normalizeIncome,
  normalizePost,
  onXhsChange,
  saveDocs,
  saveIncome,
  savePosts,
  saveSettings,
} from '../../xhs/store.js';
import { createGrid } from './grid.js';
import { applyValue, editTextOf, parseCell, postColumns, postValue, renderPostCell } from './post-columns.js';
import { relativeNote, xhsPage } from './shell.js';

const TABS = ['posts', 'criteria', 'income', 'rules'];
const PREF_KEY = 'xhs-data-prefs';
const loadPrefs = () => {
  try {
    return { sort: 'asc', type: '', validity: '', q: '', hidden: [], view: window.innerWidth < 720 ? 'cards' : 'table', ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
  } catch {
    return { sort: 'asc', type: '', validity: '', q: '', hidden: [], view: 'table' };
  }
};
const savePrefs = (p) => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
};

export async function renderData([tab = 'posts', focus], { isCurrent }) {
  if (!TABS.includes(tab)) tab = 'posts';
  const [posts, income, baseline, settings, docs, baselines] = await Promise.all([listPosts(), listIncome(), activeBaseline(), getSettings(), getDocs(), getBaselines()]);
  if (!isCurrent()) return null;
  const root = xhsPage({
    nav: 'data',
    wide: true,
    title: t('data.title'),
    sub: t('data.sub'),
    actions: `<a href="#/import" class="btn btn-secondary btn-sm">${icon('upload', 'size-4')}${esc(t('data.import'))}</a>
      <button type="button" class="btn btn-secondary btn-sm" id="data-export">${icon('download', 'size-4')}${esc(t('data.export'))}</button>`,
    body: `
      <div class="segmented segmented-4 mb-3" role="tablist">
        ${TABS.map((x, i) => `<a href="#/data/${x}" role="tab" class="seg ${x === tab ? 'is-active' : ''}" aria-selected="${x === tab}">${['①', '②', '③', '④'][i]} ${esc(t(`data.tab.${x}`))}</a>`).join('')}
      </div>
      <div id="data-body"></div>`,
  });
  const body = $('#data-body', root);
  const ctx = { posts, income, baseline, settings, docs, baselines, root };
  let view;
  if (tab === 'posts') view = renderPosts(body, ctx, focus);
  if (tab === 'criteria') view = renderCriteria(body, ctx);
  if (tab === 'income') view = renderIncome(body, ctx);
  if (tab === 'rules') view = renderRules(body, ctx);

  $('#data-export', root).addEventListener('click', async () => {
    const { exportMenu } = await import('./export.js');
    exportMenu();
  });
  // Another screen (or an import) changed the data: redraw, unless there are unsaved edits here.
  const off = onXhsChange(() => {
    if (view?.hasPending?.()) return;
    navigate(`/data/${tab}`, { replace: true });
  });
  window.scrollTo(0, 0);
  return { kind: 'xhs-data', destroy: off };
}

// ── ① XHS배포기록 ──────────────────────────────────────
function renderPosts(body, ctx, focus) {
  const prefs = loadPrefs();
  const extraKeys = [...new Set(ctx.posts.flatMap((p) => Object.keys(p.extra ?? {})))];
  const allCols = postColumns({ contentTypes: ctx.settings.contentTypes, extraKeys });
  let added = [];
  const seq = () => validSeq([...ctx.posts, ...added]);
  const types = [...new Set([...ctx.settings.contentTypes, ...ctx.posts.map((p) => p.contentType).filter(Boolean)])];

  body.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <label class="search !min-h-10 flex-1 min-w-[180px]">${icon('search', 'size-4 text-muted')}<input id="d-q" type="search" placeholder="${esc(t('data.search'))}" value="${esc(prefs.q)}" /></label>
      <select id="d-sort" class="input !h-10 !w-auto text-[13px]" aria-label="${esc(t('data.sort'))}">
        <option value="asc" ${prefs.sort === 'asc' ? 'selected' : ''}>${esc(t('data.oldest'))}</option>
        <option value="desc" ${prefs.sort === 'desc' ? 'selected' : ''}>${esc(t('data.newest'))}</option>
      </select>
      <select id="d-type" class="input !h-10 !w-auto text-[13px]" aria-label="${esc(t('xg.type'))}">
        <option value="">${esc(t('data.allTypes'))}</option>${types.map((x) => `<option ${prefs.type === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}<option value="__none" ${prefs.type === '__none' ? 'selected' : ''}>${esc(t('data.noType'))}</option>
      </select>
      <select id="d-validity" class="input !h-10 !w-auto text-[13px]" aria-label="D+1 유효성">
        <option value="">${esc(t('data.allValidity'))}</option>${['유효', '광고혼입', '미확인'].map((x) => `<option ${prefs.validity === x ? 'selected' : ''}>${x}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-secondary btn-sm" id="d-cols">${icon('eye', 'size-4')}${esc(t('data.columns'))}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="d-types">${esc(t('data.editTypes'))}</button>
      <div class="segmented segmented-2 !w-auto" role="radiogroup" aria-label="${esc(t('data.viewMode'))}">
        <button type="button" class="seg px-3 ${prefs.view === 'table' ? 'is-active' : ''}" data-view="table">${icon('table', 'size-4')}</button>
        <button type="button" class="seg px-3 ${prefs.view === 'cards' ? 'is-active' : ''}" data-view="cards">${icon('grid', 'size-4')}</button>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="d-ocr">${icon('scan', 'size-4')}${esc(t('data.ocr'))}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="d-del">${icon('trash', 'size-4')}${esc(t('data.deleteRow'))}</button>
      <button type="button" class="btn btn-primary btn-sm" id="d-add">${icon('plus', 'size-4')}${esc(t('data.addPost'))}</button>
    </div>
    <div class="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      ${relativeNote()}
      <p class="text-[12px] text-muted">${ctx.baseline ? esc(t('data.baselineInfo', { v: ctx.baseline.version, n: ctx.baseline.size })) : esc(t('data.noBaseline'))}</p>
    </div>
    <div class="mt-2" id="d-host"></div>`;

  const visibleCols = () => allCols.filter((c) => c.id === 'title' || c.id === 'no' || !prefs.hidden.includes(c.id));
  function rows() {
    const q = prefs.q.trim().toLowerCase();
    let list = ordered([...ctx.posts, ...added]).filter((p) => {
      if (prefs.validity && p.validity !== prefs.validity) return false;
      if (prefs.type === '__none' && p.contentType) return false;
      if (prefs.type && prefs.type !== '__none' && p.contentType !== prefs.type) return false;
      if (q && !`${p.title} ${p.memo} ${p.contentType}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (prefs.sort === 'desc') list = list.reverse();
    return list.map((p) => Object.assign(p, { key: p.id, rowCls: p.validity === '광고혼입' ? 'is-admixed' : '' }));
  }

  const host = $('#d-host', body);
  let grid = null;
  let current = rows();
  const rctx = { get baseline() { return ctx.baseline; }, rowIndex: (p) => current.indexOf(p) };
  const valueCtx = { get seq() { return seq(); } };

  function draw() {
    current = rows();
    if (prefs.view === 'cards') {
      grid = null;
      host.innerHTML = cardsHtml(current, ctx);
      return;
    }
    grid = createGrid(host, {
      columns: visibleCols(),
      rows: current,
      frozen: 2,
      value: (p, col) => postValue(p, col, valueCtx),
      render: (p, col, v) => renderPostCell(p, col, v, rctx),
      parse: parseCell,
      editText: editTextOf,
      label: (p) => p.title || t('xg.untitled'),
      onOpen: (p) => (p.isNew ? toast(t('data.saveFirst')) : navigate(`/c/${encodeURIComponent(p.id)}`)),
      async onSave(changes) {
        const byPost = new Map();
        for (const ch of changes) {
          const p = byPost.get(ch.row.id) ?? normalizePost(ch.row);
          applyValue(p, ch.col, ch.after);
          byPost.set(ch.row.id, p);
        }
        await savePosts([...byPost.values()]);
        added = added.filter((p) => !byPost.has(p.id));
        toast(t('data.saved', { n: changes.length }));
      },
    });
    if (focus) grid.focusRow(focus);
  }
  draw();

  body.addEventListener('input', (e) => {
    if (e.target.id !== 'd-q') return;
    prefs.q = e.target.value;
    savePrefs(prefs);
    grid ? grid.setRows((current = rows())) : draw();
  });
  body.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'd-sort' || id === 'd-type' || id === 'd-validity') {
      prefs[{ 'd-sort': 'sort', 'd-type': 'type', 'd-validity': 'validity' }[id]] = e.target.value;
      savePrefs(prefs);
      grid ? grid.setRows((current = rows())) : draw();
    }
  });
  body.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-view]');
    if (v) {
      if (grid?.hasPending()) return toast(t('data.pendingFirst'));
      prefs.view = v.dataset.view;
      savePrefs(prefs);
      body.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b === v));
      return draw();
    }
    const card = e.target.closest('[data-card]');
    if (card) return navigate(`/c/${encodeURIComponent(card.dataset.card)}`);
    if (e.target.closest('#d-add')) {
      const all = [...ctx.posts, ...added];
      const nextNo = Math.max(0, ...all.map((p) => p.no ?? 0)) + 1;
      const today = new Date();
      const p = normalizePost({ no: nextNo, date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`, validity: '미확인' });
      p.isNew = true;
      added.push(p);
      if (prefs.view === 'cards') {
        prefs.view = 'table';
        savePrefs(prefs);
      }
      prefs.q = '';
      prefs.validity = '';
      prefs.type = '';
      $('#d-q', body).value = '';
      $('#d-validity', body).value = '';
      $('#d-type', body).value = '';
      if (grid) grid.setRows((current = rows())); // keeps unsaved edits of other rows
      else draw();
      grid?.focusRow(p.id);
      return toast(t('data.added'));
    }
    if (e.target.closest('#d-ocr')) {
      const p = grid?.selectedRow();
      return navigate(p && !p.isNew ? `/ocr/${encodeURIComponent(p.id)}` : '/ocr');
    }
    if (e.target.closest('#d-del')) {
      const p = grid?.selectedRow();
      if (!p) return toast(t('data.selectRowFirst'));
      if (p.isNew) {
        // Never saved: just drop it (and its unsaved edits).
        grid.dropRow(p.id);
        added = added.filter((x) => x !== p);
        grid.setRows((current = rows())); // keeps unsaved edits of other rows
        return toast(t('data.newRowRemoved'));
      }
      const ok = await confirmDialog({ title: t('post.deleteTitle'), message: t('post.deleteBody', { name: p.title || t('xg.untitled') }), confirmText: t('common.delete'), danger: true });
      if (!ok) return;
      grid.dropRow(p.id);
      ctx.posts = ctx.posts.filter((x) => x.id !== p.id);
      grid.setRows((current = rows()));
      await deletePost(p.id);
      return toast(t('post.deleted'));
    }
    if (e.target.closest('#d-cols')) return columnsSheet(allCols, prefs, () => draw());
    if (e.target.closest('#d-types')) return typesSheet(ctx.settings);
  });
  return { hasPending: () => grid?.hasPending() || added.length > 0 };
}

function cardsHtml(list, ctx) {
  if (!list.length) return `<p class="card py-8 text-center text-muted">${esc(t('grid.empty'))}</p>`;
  const show = ['views', 'ctr', 'exit2s', 'retain5s', 'avgWatchRatio', 'completion', 'newFollowers'];
  const cell = (p, key) => {
    const col = { kind: 'metric', stage: 'd1', metric: key, computed: METRIC[key].computed, excel: METRIC[key].d1 };
    const v = postValue(p, col, { seq: new Map() });
    const r = renderPostCell(p, col, v, { baseline: ctx.baseline, rowIndex: () => 0 });
    return `<div class="rounded-[10px] px-2 py-1.5 ${r.cls || 'bg-surface-2'}"><p class="text-[11px] opacity-75">${esc(METRIC[key].zh)}</p><p class="font-semibold tabular-nums">${esc(r.text || '–')}</p></div>`;
  };
  return `<div class="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">${list
    .map(
      (p) => `<button type="button" class="card text-left" data-card="${esc(p.id)}">
      <div class="flex items-center justify-between gap-2 text-[12px] text-muted"><span class="tabular-nums">${esc(p.date)} ${esc(p.time)} · No.${p.no ?? ''}</span><span class="badge ${p.validity === '유효' ? 'cf-good' : 'cf-mid'}">${esc(p.validity)}</span></div>
      <p class="mt-1 font-semibold">${esc(p.title || t('xg.untitled'))}${p.contentType ? ` <span class="text-[12px] font-normal text-muted">· ${esc(p.contentType)}</span>` : ''}</p>
      <div class="mt-2 grid grid-cols-4 gap-1.5 text-[12px]">${show.map((k) => cell(p, k)).join('')}</div>
    </button>`,
    )
    .join('')}</div>`;
}

function columnsSheet(cols, prefs, done) {
  const groups = [];
  for (const c of cols) {
    if (c.id === 'title' || c.id === 'no') continue;
    if (!groups.length || groups.at(-1).g !== c.group) groups.push({ g: c.group, cols: [] });
    groups.at(-1).cols.push(c);
  }
  openSheet({
    title: t('data.columns'),
    body: `<div class="max-h-[60vh] overflow-y-auto">${groups
      .map(
        (g) => `<fieldset class="mb-3"><legend class="flex w-full items-center justify-between text-[13px] font-semibold">${esc(g.g)}
          <span><button type="button" class="link-btn text-[12px]" data-all="${esc(g.g)}" data-on="1">${esc(t('data.showAll'))}</button> · <button type="button" class="link-btn text-[12px]" data-all="${esc(g.g)}" data-on="0">${esc(t('data.hideAll'))}</button></span></legend>
          <div class="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">${g.cols.map((c) => `<label class="flex items-center gap-2 text-[13px]"><input type="checkbox" data-col="${esc(c.id)}" data-g="${esc(g.g)}" ${prefs.hidden.includes(c.id) ? '' : 'checked'}/> ${esc(c.label)} <span class="text-muted text-[11px]">${esc(c.sub ?? '')}</span></label>`).join('')}</div></fieldset>`,
      )
      .join('')}</div><button type="button" class="btn btn-primary w-full mt-2" data-done>${esc(t('common.ok'))}</button>`,
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        const all = e.target.closest('[data-all]');
        if (all) el.querySelectorAll(`[data-g="${CSS.escape(all.dataset.all)}"]`).forEach((x) => (x.checked = all.dataset.on === '1'));
        if (e.target.closest('[data-done]')) {
          prefs.hidden = [...el.querySelectorAll('[data-col]')].filter((x) => !x.checked).map((x) => x.dataset.col);
          savePrefs(prefs);
          close();
          done();
        }
      });
    },
  });
}

async function typesSheet(settings) {
  const text = await openSheet({
    title: t('data.editTypes'),
    body: `<p class="text-[13px] text-muted">${esc(t('data.typesHelp'))}</p>
      <textarea class="textarea mt-2" rows="8" id="types-ta">${esc(settings.contentTypes.join('\n'))}</textarea>
      <div class="mt-3 grid grid-cols-[1fr_2fr] gap-2"><button type="button" class="btn btn-secondary" data-v="">${esc(t('common.cancel'))}</button><button type="button" class="btn btn-primary" data-v="1">${esc(t('common.save'))}</button></div>`,
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v ? el.querySelector('#types-ta').value : null);
      });
    },
  });
  if (text == null) return;
  const list = [...new Set(text.split('\n').map((s) => s.trim()).filter(Boolean))];
  if (!list.length) return;
  await saveSettings({ ...settings, contentTypes: list });
  toast(t('common.saved'));
}

// ── ② 성과기준 ─────────────────────────────────────────
function renderCriteria(body, ctx) {
  const c = criteria(ctx.posts, ctx.baseline, ctx.settings);
  const fixedLabel = ctx.baseline ? t('crit.fixedV', { v: ctx.baseline.version, n: ctx.baseline.size }) : t('crit.fixed');
  const val = (key, v) => (v == null ? '' : fmt(key, v));
  const trendCls = { up: 'cf-good', down: 'cf-bad', flat: 'cf-mid', sample: 'cf-mid' };
  const impCls = (v) => (v == null ? '' : v > 0.1 ? 'cf-good' : v < -0.1 ? 'cf-bad' : 'cf-mid');
  body.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><p class="kpi-label">${esc(t('crit.valid'))}</p><p class="kpi-value">${c.validCount}</p></div>
      <div class="kpi"><p class="kpi-label">${esc(t('crit.adMixed'))}</p><p class="kpi-value">${c.adMixedCount}</p></div>
      <div class="kpi ${c.coreDown >= 3 ? 'cf-bad' : ''}"><p class="kpi-label">${esc(t('crit.coreDown'))}</p><p class="kpi-value">${c.coreDown}</p></div>
      <div class="kpi"><p class="kpi-label">${esc(t('crit.priority'))}</p><p class="mt-1 font-semibold">${esc(t(`crit.pri.${c.priority}`))}</p></div>
    </div>
    <p class="mt-3 text-[13px]">${esc(t('crit.principle'))}</p>
    <div class="mt-3 table-scroll"><table class="xtable">
      <thead><tr><th>${esc(t('crit.area'))}</th><th>${esc(t('crit.metric'))}</th><th>${esc(t('crit.dir'))}</th><th class="num">${esc(fixedLabel)}</th><th class="num">${esc(t('crit.early5'))}</th><th class="num">${esc(t('crit.recent5'))}</th><th class="num">${esc(t('crit.recent10'))}</th><th class="num">${esc(t('crit.imp'))}</th><th>${esc(t('crit.trend'))}</th><th>${esc(t('crit.core'))}</th><th class="num">${esc(t('crit.n'))}</th><th class="num">${esc(t('crit.adN'))}</th></tr></thead>
      <tbody>${c.rows
        .map(
          (r) => `<tr><td>${esc(t(`crit.area.${r.area}`))}</td><td><b>${esc(METRIC[r.key].zh)}</b> <span class="text-muted text-[12px]">${esc(t(`m.${r.key}`))}</span></td><td>${r.dir < 0 ? '↓' : '↑'}</td>
          <td class="num">${esc(val(r.key, r.fixed))}</td><td class="num">${esc(val(r.key, r.early))}</td><td class="num">${esc(val(r.key, r.recent))}</td><td class="num">${esc(val(r.key, r.recent10))}</td>
          <td class="num ${impCls(r.improvement)}">${esc(r.improvement == null ? (r.early === 0 ? t('crit.zeroBase') : '') : signedPct(r.improvement))}</td>
          <td class="${trendCls[r.trend]}">${esc(t(`crit.t.${r.trend}`))}</td>
          <td><select class="select-mini" data-core="${r.key}"><option value="1" ${r.core ? 'selected' : ''}>${esc(t('crit.coreY'))}</option><option value="0" ${r.core ? '' : 'selected'}>${esc(t('crit.coreN'))}</option></select></td>
          <td class="num">${r.validCount}</td><td class="num">${r.adMixedCount}</td></tr>`,
        )
        .join('')}</tbody></table></div>
    <div class="mt-2 flex flex-wrap gap-x-4">${relativeNote()}<p class="text-[12px] text-muted">${esc(t('crit.zeroNote'))}</p></div>

    <section class="card mt-4">
      <h3 class="text-[15px] font-semibold">${esc(t('crit.recentTable'))}</h3>
      <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('crit.seq'))}</th><th>${esc(t('crit.content'))}</th>${['exposure', 'views', 'ctr', 'exit2s', 'retain5s', 'interactionRate', 'totalInteraction', 'avgWatchRatio', 'completion', 'newFollowers'].map((k) => `<th class="num">${esc(METRIC[k].zh)}</th>`).join('')}</tr></thead>
      <tbody>${c.recent
        .map((p, i) => {
          const seqNo = c.validCount - c.recent.length + i + 1;
          return `<tr><td class="num">${seqNo}</td><td><a class="link-btn" href="#/c/${encodeURIComponent(p.id)}">${esc(p.title)}</a></td>${['exposure', 'views', 'ctr', 'exit2s', 'retain5s', 'interactionRate', 'totalInteraction', 'avgWatchRatio', 'completion', 'newFollowers'].map((k) => `<td class="num">${esc(fmt(k, postValue(p, { kind: 'metric', stage: 'd1', metric: k, computed: METRIC[k].computed }, {})))}</td>`).join('')}</tr>`;
        })
        .join('') || `<tr><td colspan="12" class="text-muted">${esc(t('crit.needFive'))}</td></tr>`}</tbody></table></div>
    </section>

    <section class="card mt-4">
      <h3 class="text-[15px] font-semibold">${esc(t('crit.versions'))}</h3>
      <p class="mt-1 text-[13px] text-muted">${esc(t('crit.versionsHelp'))}</p>
      <ul class="mt-2 flex flex-col gap-1 text-[13px]">${ctx.baselines.map((b) => `<li>Version ${b.version} · ${esc(new Date(b.createdAt).toLocaleDateString(getLang()))} · ${esc(t('crit.basedOn', { n: b.size }))}${b.version === ctx.baseline?.version ? ` <span class="badge cf-good">${esc(t('crit.active'))}</span>` : ` <button type="button" class="link-btn" data-activate="${b.version}">${esc(t('crit.useThis'))}</button>`}${b.note && b.note !== 'initial-11' ? ` · ${esc(b.note)}` : ''}</li>`).join('') || `<li class="text-muted">${esc(t('data.noBaseline'))}</li>`}</ul>
      <a href="#/xhs/baseline" class="btn btn-secondary btn-sm mt-3">${esc(t('crit.propose'))}</a>
    </section>

    ${
      ctx.docs.criteriaNotes
        ? `<section class="card mt-4"><h3 class="text-[15px] font-semibold">${esc(t('crit.notes'))}</h3>
      <p class="mt-1 text-[12px] text-muted">${esc(t('crit.notesSource', { file: ctx.docs.criteriaNotes.source.file }))}</p>
      <ul class="mt-2 flex flex-col gap-1.5 text-[13px] leading-relaxed">${ctx.docs.criteriaNotes.notes.map((n) => `<li><span class="text-muted tabular-nums">${esc(n.cell)}</span> ${esc(n.text)}${/AU열/.test(n.text) ? ` <span class="badge cf-mid">${esc(t('crit.auNote'))}</span>` : ''}</li>`).join('')}</ul></section>`
        : ''
    }`;
  body.addEventListener('change', async (e) => {
    const key = e.target.dataset.core;
    if (!key) return;
    await saveSettings({ ...ctx.settings, core: { ...ctx.settings.core, [key]: e.target.value === '1' } });
    toast(t('common.saved'));
  });
  body.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-activate]');
    if (!a) return;
    const { setActiveBaseline } = await import('../../xhs/store.js');
    await setActiveBaseline(Number(a.dataset.activate));
  });
  return {};
}

// ── ③ 수익기록 ─────────────────────────────────────────
function renderIncome(body, ctx) {
  let added = [];
  const cols = [
    { id: 'no', label: 'No.', num: true, editable: true, width: 52, kind: 'int' },
    { id: 'brand', label: '협업 브랜드', editable: true, width: 140 },
    { id: 'platform', label: '플랫폼', editable: true, width: 80 },
    { id: 'collabType', label: '협업 유형', editable: true, width: 100, options: ['현물협찬', '유료협업', '혼합협업'] },
    { id: 'content', label: '콘텐츠 내용', editable: true, width: 170 },
    { id: 'product', label: '제공 제품·서비스', editable: true, width: 170 },
    { id: 'inKindKRW', label: '현물 협찬 가치', sub: t('inc.won'), num: true, editable: true, width: 120, kind: 'int' },
    { id: 'cashKRW', label: '현금 광고 수익', sub: t('inc.won'), num: true, editable: true, width: 120, kind: 'int' },
    { id: 'date', label: '배포일자', editable: true, width: 112, kind: 'date', inputType: 'date' },
    { id: 'note', label: '비고', editable: true, width: 200 },
    { id: 'postId', label: t('inc.post'), editable: true, width: 160, options: ctx.posts.map((p) => p.title) },
  ];
  const rowsOf = () => [...ctx.income, ...added].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((x) => Object.assign(x, { key: x.id }));
  const totalIn = ctx.income.reduce((a, x) => a + (x.inKindKRW ?? 0), 0);
  const totalCash = ctx.income.reduce((a, x) => a + (x.cashKRW ?? 0), 0);
  body.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><p class="kpi-label">${esc(t('inc.count'))}</p><p class="kpi-value">${ctx.income.length}</p></div>
      <div class="kpi"><p class="kpi-label">${esc(t('inc.inKind'))}</p><p class="kpi-value">${esc(won(totalIn))}</p></div>
      <div class="kpi"><p class="kpi-label">${esc(t('inc.cash'))}</p><p class="kpi-value">${esc(won(totalCash))}</p></div>
    </div>
    <p class="mt-2 text-[12px] text-muted">${esc(t('inc.unitNote'))}</p>
    <div class="mt-2 flex justify-end"><button type="button" class="btn btn-primary btn-sm" id="inc-add">${icon('plus', 'size-4')}${esc(t('inc.add'))}</button></div>
    <div class="mt-2" id="inc-host"></div>`;
  const titleOf = (id) => ctx.posts.find((p) => p.id === id)?.title ?? '';
  const grid = createGrid($('#inc-host', body), {
    columns: cols,
    rows: rowsOf(),
    frozen: 2,
    value: (x, col) => (col.id === 'postId' ? titleOf(x.postId) : x[col.id] ?? (col.num ? null : '')),
    render: (x, col, v) => {
      if (col.kind === 'int') {
        const orig = col.id.endsWith('KRW') && x.source?.cells ? Object.values(x.source.cells).find((c) => typeof c.v === 'number' && Math.round(c.v * 10000) === v) : null;
        return { text: typeof v === 'number' ? (col.id.endsWith('KRW') ? won(v) : String(v)) : '', title: orig ? t('inc.orig', { v: orig.w }) : '' };
      }
      return { text: v ?? '' };
    },
    parse: (col, text) => {
      if (col.id === 'postId') return { ok: true, value: text };
      return parseCell({ ...col, kind: col.kind ?? 'text' }, col.id.endsWith('KRW') ? String(text).replace(/원|₩/g, '') : text);
    },
    editText: (col, v) => (v == null ? '' : String(v)),
    label: (x) => x.brand || x.content || '—',
    async onSave(changes) {
      const byId = new Map();
      for (const ch of changes) {
        const x = byId.get(ch.row.id) ?? normalizeIncome(ch.row);
        if (ch.col.id === 'postId') x.postId = ctx.posts.find((p) => p.title === ch.after)?.id ?? '';
        else x[ch.col.id] = ch.after;
        byId.set(ch.row.id, x);
      }
      await saveIncome([...byId.values()]);
      added = added.filter((x) => !byId.has(x.id));
      toast(t('data.saved', { n: changes.length }));
    },
  });
  $('#inc-add', body).addEventListener('click', () => {
    const x = normalizeIncome({ no: Math.max(0, ...ctx.income.map((i) => i.no ?? 0), ...added.map((i) => i.no ?? 0)) + 1, platform: 'XHS' });
    added.push(x);
    grid.setRows(rowsOf());
    grid.focusRow(x.id);
  });
  return { hasPending: () => grid.hasPending() || added.length > 0 };
}

// ── ④ 운영기준 ─────────────────────────────────────────
function renderRules(body, ctx) {
  const b = ctx.baseline;
  body.innerHTML = `
    <section class="card card-accent">
      <div class="flex items-center gap-2"><span class="badge cf-good">${esc(t('rules.current'))}</span><h3 class="text-[15px] font-semibold">${esc(t('rules.currentTitle'))}</h3></div>
      <ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-[14px] leading-relaxed">
        <li>${esc(b ? t('rules.c1', { v: b.version, n: b.size }) : t('rules.c1none'))}</li>
        <li>${esc(t('rules.c2'))}</li><li>${esc(t('rules.c3'))}</li><li>${esc(t('rules.c4'))}</li><li>${esc(t('rules.c5'))}</li><li>${esc(t('rules.c6'))}</li>
      </ul>
      <label class="field mt-3"><span class="field-label">${esc(t('rules.myNotes'))}</span>
        <textarea class="textarea" rows="4" id="rules-notes" placeholder="${esc(t('rules.myNotesPh'))}">${esc(ctx.settings.currentRules)}</textarea></label>
      <button type="button" class="btn btn-secondary btn-sm mt-2" id="rules-save">${esc(t('common.save'))}</button>
    </section>
    ${ctx.docs.rules
      .map(
        (r) => `<section class="card mt-3">
      <div class="flex flex-wrap items-center gap-2"><span class="badge cf-mid">${esc(t('rules.reference'))}</span><h3 class="text-[15px] font-semibold">${esc(r.title)}</h3></div>
      <p class="mt-1 text-[12px] text-muted">${esc(t('rules.refNote', { file: r.source.file, sheet: r.source.sheet }))}</p>
      <div class="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">${esc(r.text)}</div></section>`,
      )
      .join('') || `<p class="mt-3 text-[13px] text-muted">${esc(t('rules.none'))}</p>`}`;
  $('#rules-save', body).addEventListener('click', async () => {
    await saveSettings({ ...ctx.settings, currentRules: $('#rules-notes', body).value });
    toast(t('common.saved'));
  });
  void saveDocs;
  return {};
}
