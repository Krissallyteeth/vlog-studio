import { todayString } from '../../lib/dates.js';
import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { $, actionSheet, confirmDialog, downloadFile, esc, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { buildWorkbook, postsCsv } from '../../xhs/excel-export.js';
import { activeBaseline, deleteAll, exportAll, getDocs, getSettings, importAll, listIncome, listPosts } from '../../xhs/store.js';
import { getAll } from '../../xhs/db.js';
import { xhsPage } from './shell.js';

async function gather() {
  const [posts, income, baseline, settings, docs] = await Promise.all([listPosts(), listIncome(), activeBaseline(), getSettings(), getDocs()]);
  return { posts, income, baseline, settings, docs };
}

export async function exportExcel() {
  const wb = await buildWorkbook(await gather());
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `VLOG운영기록_vlog-studio_${todayString()}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(t('exp.excelDone'));
}

export async function exportCsv() {
  downloadFile(`xhs-posts_${todayString()}.csv`, postsCsv(await listPosts()), 'text/csv');
  toast(t('exp.csvDone'));
}

export async function exportJson(withScreenshots = false) {
  const data = await exportAll({ withScreenshots });
  downloadFile(`vlog-studio-xhs-backup_${todayString()}.json`, JSON.stringify(data, null, 2));
  toast(t('exp.jsonDone', { n: data.posts.length }));
}

export async function exportMenu() {
  const choice = await actionSheet({
    title: t('data.export'),
    actions: [
      { id: 'xlsx', label: t('exp.excel'), icon: 'table', hint: t('exp.excelHint') },
      { id: 'csv', label: t('exp.csv'), icon: 'doc', hint: t('exp.csvHint') },
      { id: 'json', label: t('exp.json'), icon: 'archive', hint: t('exp.jsonHint') },
    ],
  });
  if (choice === 'xlsx') await exportExcel();
  if (choice === 'csv') await exportCsv();
  if (choice === 'json') await exportJson();
}

// ── 성과 데이터 백업 화면 ────────────────────────────────
export async function renderBackup({ isCurrent }) {
  const [posts, income, shots] = await Promise.all([listPosts(), listIncome(), getAll('shots')]);
  if (!isCurrent()) return null;
  const shotBytes = shots.reduce((s, x) => s + (x.blob?.size ?? 0), 0);
  const root = xhsPage({
    nav: 'more',
    back: '#/more',
    title: t('more.xhsBackup'),
    sub: t('exp.sub'),
    body: `
      <section class="notice notice-strong">${icon('info', 'size-5 mt-0.5')}<div class="text-[14px] leading-relaxed"><b>${esc(t('exp.localTitle'))}</b><p class="mt-1 text-muted">${esc(t('exp.localBody'))}</p></div></section>
      <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('exp.now'))}</h2>
        <p class="mt-1 text-[14px] text-muted">${esc(t('exp.counts', { posts: posts.length, income: income.length, shots: shots.length, mb: (shotBytes / 1048576).toFixed(1) }))}</p>
        <div class="mt-3 grid gap-2 sm:grid-cols-3">
          <button type="button" class="btn btn-primary" data-x="json">${icon('download', 'size-5')}${esc(t('exp.json'))}</button>
          <button type="button" class="btn btn-secondary" data-x="xlsx">${icon('table', 'size-5')}${esc(t('exp.excel'))}</button>
          <button type="button" class="btn btn-secondary" data-x="csv">${icon('doc', 'size-5')}${esc(t('exp.csv'))}</button>
        </div>
        <label class="mt-2 flex items-center gap-2 text-[13px]"><input type="checkbox" id="exp-shots" /> ${esc(t('exp.withShots'))}</label>
      </section>
      <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('exp.restore'))}</h2>
        <p class="mt-1 text-[14px] text-muted">${esc(t('exp.restoreHint'))}</p>
        <label class="btn btn-secondary mt-3 cursor-pointer">${icon('upload', 'size-5')}${esc(t('exp.pick'))}<input type="file" id="exp-file" accept="application/json,.json" class="sr-only" /></label>
      </section>
      <section class="card mt-3 text-[14px] leading-relaxed"><h2 class="text-[16px] font-semibold">${esc(t('exp.howTitle'))}</h2>
        <ol class="mt-2 list-decimal pl-5"><li>${esc(t('exp.how1'))}</li><li>${esc(t('exp.how2'))}</li><li>${esc(t('exp.how3'))}</li><li>${esc(t('exp.how4'))}</li></ol></section>
      <section class="card mt-3"><h2 class="text-[16px] font-semibold text-danger">${esc(t('exp.deleteAll'))}</h2>
        <p class="mt-1 text-[14px] text-muted">${esc(t('exp.deleteHint'))}</p>
        <button type="button" class="btn btn-ghost text-danger mt-2" data-x="delete">${icon('trash', 'size-4')}${esc(t('exp.deleteAll'))}</button></section>`,
  });
  root.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'json') return exportJson($('#exp-shots', root).checked);
    if (x === 'xlsx') return exportExcel();
    if (x === 'csv') return exportCsv();
    if (x === 'delete') {
      const ok = await confirmDialog({ title: t('exp.deleteTitle'), message: t('exp.deleteBody', { n: posts.length }), confirmText: t('exp.deleteAll'), danger: true });
      if (!ok) return;
      const sure = await confirmDialog({ title: t('exp.deleteTitle2'), message: t('exp.deleteBody2'), confirmText: t('exp.deleteAll'), danger: true });
      if (!sure) return;
      await deleteAll();
      toast(t('exp.deleted'));
      navigate('/xhs/backup', { replace: true });
    }
  });
  root.addEventListener('change', async (e) => {
    if (e.target.id !== 'exp-file') return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast(t('exp.notBackup'), { tone: 'error' });
    }
    if (data?.app !== 'vlog-studio-xhs') return toast(t('exp.notBackup'), { tone: 'error' });
    const mode = await actionSheet({
      title: t('exp.restoreTitle', { n: data.posts?.length ?? 0, when: data.exportedAt ?? '' }),
      actions: [
        { id: 'merge', label: t('restore.merge'), icon: 'copy', hint: t('exp.mergeHint') },
        { id: 'replace', label: t('restore.replace'), icon: 'archive', danger: true, hint: t('exp.replaceHint', { n: posts.length }) },
      ],
    });
    if (!mode) return;
    if (mode === 'replace' && !(await confirmDialog({ title: t('restore.replaceTitle'), message: t('exp.replaceHint', { n: posts.length }), confirmText: t('restore.replace'), danger: true }))) return;
    const r = await importAll(data, mode);
    toast(t('exp.restored', { n: r.posts }));
    navigate('/data', { replace: true });
  });
  return { kind: 'xhs-backup' };
}
