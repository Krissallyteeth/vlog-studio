import { flushAll, hasPendingSaves, onSaveStatus, saveNow, scheduleSave } from '../data/autosave.js';
import { onRemoteChange } from '../data/sync.js';
import { deleteProject, duplicateProject, getProject } from '../data/repo.js';
import { STATUSES } from '../lib/constants.js';
import { formatRange } from '../lib/dates.js';
import { projectToMarkdown } from '../lib/markdown.js';
import { navigate } from '../router.js';
import { $, actionSheet, autoGrowAll, confirmDialog, copyText, downloadFile, esc, safeFileName, toast } from '../ui/dom.js';
import { bindInputs } from '../ui/fields.js';
import { icon } from '../ui/icons.js';
import { bottomNav, mount } from '../ui/layout.js';
import { statusPill } from './home.js';
import * as planTab from './tabs/plan.js';
import * as routeTab from './tabs/route.js';
import * as shotsTab from './tabs/shots.js';
import * as fieldTab from './tabs/field.js';
import * as editTab from './tabs/edit.js';
import { t } from '../i18n/index.js';

const TABS = [
  { id: 'plan', get label() { return t('tab.plan'); }, icon: 'idea', mod: planTab },
  { id: 'route', get label() { return t('tab.route'); }, icon: 'route', mod: routeTab },
  { id: 'shots', get label() { return t('tab.shots'); }, icon: 'camera', mod: shotsTab },
  { id: 'field', get label() { return t('tab.field'); }, icon: 'note', mod: fieldTab },
  { id: 'edit', get label() { return t('tab.edit'); }, icon: 'film', mod: editTab },
];
const lastTab = new Map();

// "Next step" button at the bottom of each tab, so the flow continues without the bottom nav.
const NEXT_STEP = {
  plan: { tab: 'route', label: 'next.route' },
  route: { tab: 'shots', label: 'next.shots', when: (p) => p.places.length > 0 },
  shots: { tab: 'field', label: 'next.field', when: (p) => p.places.length > 0 },
  field: { tab: 'edit', label: 'next.edit', when: (_, sub) => !sub },
};

const SAVE_TEXT = { idle: '', pending: 'save.pending', saving: 'save.saving', saved: 'save.saved', error: 'save.error' };

export async function renderDetail([id, tab, sub], { isCurrent, previous }) {
  if (previous?.kind === 'detail' && previous.projectId === id && tab) {
    previous.show(tab, sub);
    return previous;
  }
  const project = await getProject(id);
  if (!isCurrent()) return null;
  if (!project) {
    toast(t('project.notFoundDeleted'));
    navigate('/', { replace: true });
    return null;
  }
  if (!TABS.some((t) => t.id === tab)) {
    navigate(`/p/${encodeURIComponent(id)}/${lastTab.get(id) ?? 'plan'}`, { replace: true });
    return null;
  }

  const base = `#/p/${encodeURIComponent(id)}`;
  const root = mount(`
    <div class="view">
      <header class="top-bar detail-bar">
        <a href="#/" class="icon-btn" aria-label="${esc(t('detail.backToList'))}">${icon('chevronLeft')}</a>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-[16px] font-semibold leading-tight" id="d-name"></h1>
          <div class="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
            <span class="tabular-nums" id="d-range"></span>
            <button type="button" id="d-status" class="status-btn" aria-label="${esc(t('detail.changeStatus'))}"></button>
          </div>
        </div>
        <span id="save-state" class="save-state" aria-live="polite"></span>
        <button type="button" class="icon-btn" id="d-more" aria-label="${esc(t('detail.menu'))}">${icon('more')}</button>
      </header>
      <main class="page-main pb-36" id="pane-host"></main>
      <div id="d-nav"></div>
    </div>`);

  const host = $('#pane-host', root);
  let current = { tab: null, sub: undefined, cleanup: null };

  function refreshHeader() {
    $('#d-name', root).textContent = project.name;
    $('#d-range', root).textContent = formatRange(project.startDate, project.endDate);
    $('#d-status', root).innerHTML = statusPill(project.status);
    document.title = `${project.name} · Vlog Studio`;
  }

  const ctx = {
    project,
    changed: () => scheduleSave(project),
    commit: () => saveNow(project).catch((err) => toast(t('common.saveFailed', { msg: err.message }), { tone: 'error' })),
    touch(path) {
      const m = /^logs#([^.]+)\./.exec(path);
      if (m) {
        const log = project.logs.find((l) => l.id === m[1]);
        if (log) log.updatedAt = Date.now();
      }
    },
    rerender: () => show(current.tab, current.sub, { keepScroll: true }),
    go: (t, s, opts) => navigate(`/p/${encodeURIComponent(id)}/${t}${s ? `/${encodeURIComponent(s)}` : ''}`, opts),
    refreshHeader,
  };

  function show(tabId, subId, { keepScroll = false } = {}) {
    const def = TABS.find((t) => t.id === tabId) ?? TABS[0];
    current.cleanup?.();
    lastTab.set(id, def.id);
    const pane = document.createElement('div');
    pane.className = keepScroll ? 'pane' : 'pane pane-enter';
    const next = NEXT_STEP[def.id];
    if (next && (next.when?.(project, subId) ?? true)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary w-full mt-5';
      btn.innerHTML = `${esc(t(next.label))} ${icon('chevronRight', 'size-4')}`;
      btn.addEventListener('click', () => ctx.go(next.tab));
      host.replaceChildren(pane, btn);
    } else {
      host.replaceChildren(pane);
    }
    bindInputs(pane, ctx);
    current = { tab: def.id, sub: subId, cleanup: def.mod.render(ctx, pane, subId) ?? null };
    autoGrowAll(pane);
    $('#d-nav', root).innerHTML = bottomNav(
      TABS.map((t) => ({ ...t, href: `${base}/${t.id}` })),
      def.id,
    );
    if (!keepScroll) window.scrollTo(0, 0);
  }

  async function changeStatus() {
    const next = await actionSheet({
      title: t('project.status'),
      actions: STATUSES.map((s) => ({ id: s.id, label: s.label, active: s.id === project.status })),
    });
    if (!next || next === project.status) return;
    project.status = next;
    await ctx.commit();
    refreshHeader();
    toast(t('project.statusChanged'));
  }

  async function openMenu() {
    const choice = await actionSheet({
      title: project.name,
      actions: [
        { id: 'info', label: t('form.editTitle'), icon: 'edit', hint: t('menu.infoHint') },
        { id: 'xhs', label: t('menu.xhs'), icon: 'chart', hint: t('menu.xhsHint') },
        { id: 'status', label: t('detail.changeStatus'), icon: 'flag' },
        { id: 'md', label: t('menu.md'), icon: 'download', hint: t('menu.mdHint') },
        { id: 'copy', label: t('menu.copy'), icon: 'doc', hint: t('menu.copyHint') },
        { id: 'dup', label: t('menu.dup'), icon: 'copy', hint: t('menu.dupHint') },
        { id: 'del', label: t('menu.del'), icon: 'trash', danger: true },
      ],
    });
    if (!choice) return;
    await flushAll().catch(() => {});
    if (choice === 'info') navigate(`/p/${encodeURIComponent(id)}/info`);
    if (choice === 'xhs') {
      const { listPosts } = await import('../xhs/store.js');
      const linked = (await listPosts()).filter((p) => p.projectId === id);
      if (linked.length === 1) navigate(`/c/${encodeURIComponent(linked[0].id)}`);
      else if (linked.length > 1) navigate('/contents');
      else toast(t('menu.xhsNone'));
    }
    if (choice === 'status') changeStatus();
    if (choice === 'md') {
      downloadFile(`${safeFileName(project.name)}_${project.startDate}.md`, projectToMarkdown(project), 'text/markdown');
      toast(t('menu.mdDone'));
    }
    if (choice === 'copy') {
      toast((await copyText(projectToMarkdown(project))) ? t('menu.copyDone') : t('menu.copyFailed'));
    }
    if (choice === 'dup') {
      const copy = await duplicateProject(id);
      toast(t('menu.dupDone'));
      navigate(`/p/${encodeURIComponent(copy.id)}/${current.tab}`);
    }
    if (choice === 'del') {
      const ok = await confirmDialog({
        title: t('project.deleteTitle'),
        message: t('project.deleteBody', { name: project.name }),
        confirmText: t('common.delete'),
        danger: true,
      });
      if (!ok) return;
      await deleteProject(id);
      toast(t('project.deleted'));
      navigate('/', { replace: true });
    }
  }

  $('#d-status', root).addEventListener('click', changeStatus);
  $('#d-more', root).addEventListener('click', openMenu);
  const saveState = $('#save-state', root);
  const unsubscribe = onSaveStatus((s) => {
    saveState.dataset.state = s;
    const text = SAVE_TEXT[s] ? t(SAVE_TEXT[s]) : '';
    saveState.innerHTML = s === 'saved' ? `${icon('check', 'size-3.5')}${esc(text)}` : esc(text);
  });

  // Another device edited this project: show its version, unless there are unsaved edits here or the user
  // is typing (then this device's next save is newer and wins anyway).
  const offRemote = onRemoteChange(async (ids) => {
    if (!ids.includes(id) || hasPendingSaves()) return;
    const el = document.activeElement;
    if (el && root.contains(el) && el.matches('input, textarea, select')) return;
    if (document.querySelector('.overlay')) return;
    const fresh = await getProject(id);
    if (!fresh) {
      toast(t('sync.deletedElsewhere'));
      navigate('/', { replace: true });
      return;
    }
    if (fresh.updatedAt <= project.updatedAt) return;
    Object.assign(project, fresh);
    refreshHeader();
    ctx.rerender();
    toast(t('sync.loadedElsewhere'));
  });

  refreshHeader();
  show(tab, sub);

  return {
    kind: 'detail',
    projectId: id,
    show,
    destroy() {
      current.cleanup?.();
      unsubscribe();
      offRemote();
      document.title = 'Vlog Studio';
    },
  };
}
