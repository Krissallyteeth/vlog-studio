import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { $, confirmDialog, esc, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { cachedFormulaValues, mergeInto, planImport, sha256 } from '../../xhs/excel-import.js';
import { getDocs, getImports, getSettings, listIncome, listPosts, recordImport, saveDocs, saveIncome, savePosts, saveSettings } from '../../xhs/store.js';
import { xhsPage } from './shell.js';

/*
 * Excel import: choose file → verification screen (nothing saved yet) → confirm → save.
 * Every original cell is compared with the value the app will store.
 */

const STATUS_CLASS = { ok: '', 'formula-ok': '', check: 'cf-mid', mismatch: 'cf-bad', 'formula-diff': 'cf-bad' };

export async function renderImport({ isCurrent }) {
  if (!isCurrent()) return null;
  const root = xhsPage({
    nav: 'data',
    back: '#/data',
    title: t('imp.title'),
    sub: t('imp.sub'),
    body: `
      <section class="card drop-target" id="imp-drop">
        <div class="drop-overlay" aria-hidden="true">${icon('upload', 'size-6')}<span>${esc(t('imp.dropHere'))}</span></div>
        <p class="text-[14px]">${esc(t('imp.pickHint'))}</p>
        <label class="btn btn-primary mt-3 cursor-pointer">${icon('upload', 'size-5')}${esc(t('imp.pick'))}
          <input type="file" id="imp-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="sr-only" />
        </label>
        <p class="mt-3 text-[12px] text-muted">${esc(t('imp.privacy'))}</p>
      </section>
      <div id="imp-result" class="mt-4"></div>`,
  });
  const result = $('#imp-result', root);
  let plan = null;

  async function load(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) return toast(t('imp.notXlsx'), { tone: 'error' });
    result.innerHTML = `<p class="card text-[14px]">${esc(t('imp.reading'))}</p>`;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const [{ default: ExcelJS }, hash, cached] = await Promise.all([import('exceljs'), sha256(bytes), cachedFormulaValues(bytes)]);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes);
      plan = planImport(wb, { fileName: file.name, hash, cached, existingPosts: await listPosts(), existingIncome: await listIncome(), previousImports: await getImports() });
      renderPlan();
    } catch (err) {
      console.error(err);
      result.innerHTML = `<p class="card form-error">${esc(t('imp.failed', { msg: t(`imp.err.${err.message}`) === `imp.err.${err.message}` ? err.message : t(`imp.err.${err.message}`) }))}</p>`;
    }
  }

  function renderPlan() {
    const c = plan.counts;
    const card = (label, value, tone = '') => `<div class="kpi ${tone}"><p class="kpi-label">${esc(label)}</p><p class="kpi-value">${esc(String(value))}</p></div>`;
    const problems = plan.comparisons.filter((x) => !['ok', 'formula-ok'].includes(x.status));
    result.innerHTML = `
      ${plan.alreadyImported ? `<p class="notice notice-strong mb-3">${icon('info', 'size-5 mt-0.5')}<span>${esc(t('imp.already'))}</span></p>` : ''}
      <section class="card">
        <h2 class="text-[16px] font-semibold">${esc(t('imp.summary'))}</h2>
        <p class="mt-1 text-[13px] text-muted break-all">${esc(plan.fileName)}</p>
        <div class="kpi-grid mt-3">
          ${card(t('imp.c.sheets'), `${c.sheets}/4`, c.sheets === 4 ? 'cf-good' : 'cf-mid')}
          ${card(t('imp.c.posts'), c.posts)}
          ${card(t('imp.c.validAd'), `${c.valid} / ${c.adMixed}`)}
          ${card(t('imp.c.new'), c.new)}
          ${card(t('imp.c.duplicate'), c.duplicate)}
          ${card(t('imp.c.conflict'), c.conflict, c.conflict ? 'cf-mid' : '')}
          ${card(t('imp.c.missing'), `${c.missingCells}/${c.d1Expected}`, c.missingCells ? 'cf-mid' : '')}
          ${card(t('imp.c.errors'), c.check + c.mismatch, c.check + c.mismatch ? 'cf-bad' : 'cf-good')}
          ${card(t('imp.c.formula'), `${c.formulaOk} / ${c.formulaDiff}`, c.formulaDiff ? 'cf-bad' : 'cf-good')}
          ${card(t('imp.c.lost'), `${c.missingRecords} / ${c.missingFields}`, 'cf-good')}
          ${card(t('imp.c.income'), `${c.income} (${t('imp.newN', { n: c.incomeNew })})`)}
          ${card(t('imp.c.compared'), c.compared)}
        </div>
        <p class="mt-3 text-[12px] text-muted">${esc(t('imp.missingHelp'))}</p>
      </section>

      <section class="card mt-3">
        <h2 class="text-[16px] font-semibold">${esc(t('imp.sheets'))}</h2>
        <div class="table-scroll mt-2"><table class="xtable">
          <thead><tr><th>${esc(t('imp.sheet'))}</th><th>${esc(t('imp.found'))}</th><th>${esc(t('imp.rowsCols'))}</th><th>${esc(t('imp.cells'))}</th><th>${esc(t('imp.formulas'))}</th></tr></thead>
          <tbody>${plan.sheets.map((s) => `<tr><td>${esc(s.name)}</td><td class="${s.found ? 'cf-good' : 'cf-bad'}">${s.found ? '✓' : '✕'}</td><td>${s.found ? `${s.rowCount} × ${s.colCount}` : ''}</td><td>${s.nonEmpty ?? ''}</td><td>${s.formulas ?? ''}</td></tr>`).join('')}</tbody>
        </table></div>
        ${plan.extraSheets.length ? `<p class="mt-2 text-[12px] text-muted">${esc(t('imp.extraSheets', { names: plan.extraSheets.join(', ') }))}</p>` : ''}
        ${plan.posts.unknownColumns.length ? `<p class="mt-2 text-[12px]">${esc(t('imp.unknownCols', { cols: plan.posts.unknownColumns.map((x) => `${x.col}:${x.header}`).join(', ') }))}</p>` : ''}
        <p class="mt-2 text-[12px] text-muted">${esc(t('imp.formulaRows', { n: plan.posts.stats.formulaOnlyRows }))}</p>
      </section>

      ${
        plan.matches.some((m) => m.status === 'conflict')
          ? `<section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('imp.conflicts'))}</h2>
          <p class="mt-1 text-[13px] text-muted">${esc(t('imp.conflictHelp'))}</p>
          ${plan.matches
            .map((m, i) =>
              m.status !== 'conflict'
                ? ''
                : `<div class="mt-3 border-t border-line pt-3">
              <p class="font-semibold">${esc(m.record.title)} <span class="text-muted text-[13px]">(${esc(t('imp.row', { n: m.record.source.row }))})</span></p>
              <ul class="mt-1 text-[13px]">${m.diffs.map((d) => `<li>${esc(d.field)}: <span class="text-muted">${esc(t('imp.inApp'))}</span> ${esc(String(d.app ?? '∅'))} → <span class="text-muted">Excel</span> ${esc(String(d.excel ?? '∅'))}</li>`).join('')}</ul>
              <div class="segmented segmented-2 mt-2" role="radiogroup">
                <button type="button" class="seg ${m.choice === 'keep' ? 'is-active' : ''}" data-choice="${i}" data-v="keep">${esc(t('imp.keep'))}</button>
                <button type="button" class="seg ${m.choice === 'overwrite' ? 'is-active' : ''}" data-choice="${i}" data-v="overwrite">${esc(t('imp.overwrite'))}</button>
              </div></div>`,
            )
            .join('')}</section>`
          : ''
      }

      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-[16px] font-semibold">${esc(t('imp.compare'))}</h2>
          <label class="flex items-center gap-2 text-[13px]"><input type="checkbox" id="imp-only-problems" ${problems.length ? 'checked' : ''}/> ${esc(t('imp.onlyProblems', { n: problems.length }))}</label>
        </div>
        <p class="mt-1 text-[12px] text-muted">${esc(t('imp.legend'))}</p>
        <div id="imp-table" class="table-scroll mt-2 max-h-[60vh]"></div>
      </section>

      <div class="sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] z-10 mt-4 grid grid-cols-[1fr_2fr] gap-2">
        <button type="button" class="btn btn-secondary" id="imp-cancel">${esc(t('common.cancel'))}</button>
        <button type="button" class="btn btn-primary" id="imp-save">${esc(t('imp.confirm'))}</button>
      </div>`;
    renderTable();
  }

  function renderTable() {
    const only = $('#imp-only-problems', root)?.checked;
    const list = plan.comparisons.filter((x) => !only || !['ok', 'formula-ok'].includes(x.status));
    $('#imp-table', root).innerHTML = list.length
      ? `<table class="xtable">
      <thead><tr><th>${esc(t('imp.th.post'))}</th><th>${esc(t('imp.th.cell'))}</th><th>${esc(t('imp.th.item'))}</th><th>${esc(t('imp.th.excel'))}</th><th>${esc(t('imp.th.app'))}</th><th>${esc(t('imp.th.status'))}</th></tr></thead>
      <tbody>${list
        .map(
          (x) => `<tr class="${STATUS_CLASS[x.status]}">
          <td>${esc(x.post ?? '')}</td><td class="tabular-nums">${esc(x.cell)}</td>
          <td>${esc(x.header)}${x.formula ? `<span class="block text-[11px] text-muted" title="${esc(x.formula)}">ƒ ${esc(x.formula.slice(0, 48))}${x.formula.length > 48 ? '…' : ''}</span>` : ''}</td>
          <td class="num">${esc(x.excel)}</td><td class="num">${esc(x.app)}</td><td>${esc(t(`imp.st.${x.status}`))}</td></tr>`,
        )
        .join('')}</tbody></table>`
      : `<p class="py-6 text-center text-[14px] text-muted">${esc(t('imp.allMatch'))}</p>`;
  }

  async function save() {
    const c = plan.counts;
    const toSave = [];
    for (const m of plan.matches) {
      if (m.status === 'new') toSave.push(m.record);
      else if (m.status === 'conflict' && m.choice === 'overwrite') toSave.push(mergeInto(m.existing, m.record));
    }
    const income = plan.incomeMatches.filter((m) => m.status === 'new').map((m) => m.record);
    const ok = await confirmDialog({
      title: t('imp.confirmTitle'),
      message: t('imp.confirmBody', { posts: toSave.length, income: income.length, skipped: c.duplicate + plan.matches.filter((m) => m.status === 'conflict' && m.choice === 'keep').length }),
      confirmText: t('imp.confirm'),
    });
    if (!ok) return;
    if (toSave.length) await savePosts(toSave, { touch: false });
    if (income.length) await saveIncome(income);
    // Sheet texts: the 기준 sheet is kept as a past reference, not as the current rule set.
    const docs = await getDocs();
    const stamp = new Date().toISOString();
    if (plan.rules?.texts.length && !docs.rules.some((r) => r.hash === plan.hash)) {
      docs.rules.push({ id: `rules-${plan.hash.slice(0, 8)}`, hash: plan.hash, title: plan.rules.texts[0].text.split('\n')[0], text: plan.rules.texts.map((x) => x.text).join('\n\n'), status: 'reference', source: { file: plan.fileName, sheet: '기준', cells: plan.rules.texts.map((x) => x.cell) }, importedAt: stamp });
    }
    if (plan.criteria?.notes.length) docs.criteriaNotes = { notes: plan.criteria.notes, source: { file: plan.fileName, sheet: '성과기준' }, importedAt: stamp };
    if (plan.posts.headerText) docs.postsHeader = { cells: plan.posts.headerText, file: plan.fileName };
    await saveDocs(docs);
    const settings = await getSettings();
    if (plan.criteria?.settings && !Object.keys(settings.core).length) await saveSettings({ ...settings, core: plan.criteria.settings.core });
    await recordImport({ fileName: plan.fileName, hash: plan.hash, at: Date.now(), counts: c, saved: toSave.length, income: income.length });
    toast(t('imp.saved', { n: toSave.length }));
    navigate('/data', { replace: true });
  }

  root.addEventListener('change', (e) => {
    if (e.target.id === 'imp-file') load(e.target.files?.[0]);
    if (e.target.id === 'imp-only-problems') renderTable();
  });
  root.addEventListener('click', (e) => {
    const ch = e.target.closest('[data-choice]');
    if (ch) {
      plan.matches[Number(ch.dataset.choice)].choice = ch.dataset.v;
      return renderPlan();
    }
    if (e.target.closest('#imp-cancel')) {
      plan = null;
      result.innerHTML = '';
    }
    if (e.target.closest('#imp-save')) save();
  });
  const drop = $('#imp-drop', root);
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragging');
    load(e.dataTransfer.files?.[0]);
  });
  window.scrollTo(0, 0);
  return { kind: 'xhs-import' };
}
