import { deleteProject, listProjects, getLastBackupAt, saveProject } from '../data/repo.js';
import { CUSTOM_TYPE_PREFIX, SORT_OPTIONS, STATUSES, TYPES, labelOf, typeLabels } from '../lib/constants.js';
import { formatRange, formatRelative, isEndBeforeStart, isValidDate, isWithinRange } from '../lib/dates.js';
import { projectProgress } from '../lib/progress.js';
import { filterProjects, sortProjects } from '../lib/sort.js';
import { $, actionSheet, confirmDialog, esc, openSheet, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { HOME_NAV, bottomNav, mount, offlineBadge } from '../ui/layout.js';
import { swipeRows } from '../ui/swipe.js';
import { navigate } from '../router.js';
import { getSyncState, onRemoteChange, onSyncState } from '../data/sync.js';
import { getLang, t } from '../i18n/index.js';

const PREFS_KEY = 'vs-home-prefs';
const DEFAULT_PREFS = { query: '', status: 'all', type: 'all', sort: 'shootDesc' };
const BACKUP_NUDGE_MS = 7 * 24 * 60 * 60 * 1000;
let savedScroll = 0;

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(sessionStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
function savePrefs(p) {
  try {
    sessionStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export const statusPill = (status) => `<span class="status status-${esc(status)}">${esc(labelOf(STATUSES, status))}</span>`;

function card(p) {
  const pct = projectProgress(p);
  const types = typeLabels(p);
  // The whole card opens the project via a stretched link; date, status, name and place sit above it as edit buttons.
  // Swiping the card left reveals the delete button behind it.
  return `
    <li class="swipe-row" data-id="${esc(p.id)}">
     <button type="button" class="swipe-action" data-delete aria-label="${esc(t('home.deleteAria', { name: p.name }))}">${icon('trash', 'size-5')}<span>${esc(t('common.delete'))}</span></button>
     <div class="card project-card swipe-fg">
      <a class="card-link" href="#/p/${encodeURIComponent(p.id)}" aria-label="${esc(t('home.openAria', { name: p.name }))}"></a>
      <div class="flex items-center justify-between gap-2 text-[13px] text-muted">
        <button type="button" class="card-edit inline-flex items-center gap-1.5 tabular-nums" data-edit="dates" aria-label="${esc(t('home.editDatesAria', { v: formatRange(p.startDate, p.endDate) }))}">${icon('calendar', 'size-4')}${esc(formatRange(p.startDate, p.endDate))}</button>
        <button type="button" class="card-edit" data-edit="status" aria-label="${esc(t('home.editStatusAria', { v: labelOf(STATUSES, p.status) }))}">${statusPill(p.status)}</button>
      </div>
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <h2 class="mt-1.5 text-[18px] font-semibold leading-snug tracking-tight"><button type="button" class="card-edit line-clamp-2 text-left" data-edit="name" aria-label="${esc(t('home.editNameAria', { v: p.name }))}">${esc(p.name)}</button></h2>
          <button type="button" class="card-edit mt-0.5 inline-flex max-w-full items-center gap-1.5 text-[14px] text-muted" data-edit="location" aria-label="${esc(t('home.editLocationAria'))}">${icon('pin', 'size-4 shrink-0')}<span class="line-clamp-1 text-left">${esc(p.location || t('home.addLocation'))}</span></button>
        </div>
        ${icon('chevronRight', 'size-5 text-muted')}
      </div>
      <div class="mt-3 flex items-center gap-3">
        <div class="progress flex-1" role="progressbar" aria-label="${esc(t('home.progress'))}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
        <span class="text-[12px] font-medium tabular-nums w-9 text-right">${pct}%</span>
      </div>
      <p class="mt-2 text-[12px] text-muted">${types.length ? `${esc(types.join(' · '))} · ` : ''}${esc(t('home.lastEdited', { v: formatRelative(p.updatedAt) }))}</p>
     </div>
    </li>`;
}

/** Small form in a bottom sheet. `read(form)` returns { value } to save, or { error, focus? } to keep it open. */
function formSheet({ title, body, read }) {
  return openSheet({
    title,
    body: `
      <form class="flex flex-col gap-3" novalidate>
        ${body}
        <p class="form-error hidden" role="alert"></p>
        <div class="mt-1 grid grid-cols-[1fr_2fr] gap-2">
          <button type="button" class="btn btn-secondary" data-cancel>${esc(t('common.cancel'))}</button>
          <button type="submit" class="btn btn-primary">${esc(t('common.save'))}</button>
        </div>
      </form>`,
    onMount(el, close) {
      const form = $('form', el);
      const error = $('.form-error', el);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = read(form);
        if (!r.error) return close(r);
        error.textContent = r.error;
        error.classList.remove('hidden');
        r.focus?.focus();
      });
      $('[data-cancel]', el).addEventListener('click', () => close(null));
    },
  });
}

/** Edits one card field in place. Resolves with a toast message, or null when nothing changed. */
async function quickEdit(p, field) {
  if (field === 'status') {
    const next = await actionSheet({
      title: t('project.status'),
      actions: STATUSES.map((st) => ({ id: st.id, label: st.label, active: st.id === p.status })),
    });
    if (!next || next === p.status) return null;
    p.status = next;
    return t('project.statusChanged');
  }

  if (field === 'name' || field === 'location') {
    const isName = field === 'name';
    const r = await formSheet({
      title: isName ? t('project.name') : t('project.location'),
      body: `<input name="v" class="input" maxlength="${isName ? 80 : 120}" value="${esc(p[field])}" placeholder="${esc(isName ? t('project.namePh') : t('project.locationPh'))}" aria-label="${esc(isName ? t('project.name') : t('project.location'))}" enterkeyhint="done" autofocus />`,
      read: (form) => {
        const v = form.v.value.trim();
        return isName && !v ? { error: t('project.nameRequired'), focus: form.v } : { value: v };
      },
    });
    if (!r || r.value === p[field]) return null;
    p[field] = r.value;
    return t('common.saved');
  }

  if (field === 'dates') {
    const r = await formSheet({
      title: t('project.dates'),
      body: `
        <div class="grid grid-cols-2 gap-3">
          <label class="field"><span class="field-label">${esc(t('project.start'))} <span class="req">${esc(t('common.required'))}</span></span><input name="start" type="date" class="input" required value="${esc(p.startDate)}" /></label>
          <label class="field"><span class="field-label">${esc(t('project.end'))} <span class="opt">${esc(t('common.optional'))}</span></span><input name="end" type="date" class="input" min="${esc(p.startDate)}" value="${esc(p.endDate)}" /></label>
        </div>
        <p class="text-[13px] text-muted">${esc(t('project.oneDayHint'))}</p>`,
      read: (form) => {
        const start = form.start.value;
        const end = form.end.value;
        if (!isValidDate(start)) return { error: t('project.startRequired'), focus: form.start };
        if (end && isEndBeforeStart(start, end)) return { error: t('project.endBeforeStart'), focus: form.end };
        return { value: { start, end: end && end !== start ? end : '' } };
      },
    });
    if (!r || (r.value.start === p.startDate && r.value.end === p.endDate)) return null;
    p.startDate = r.value.start;
    p.endDate = r.value.end;
    const outside = p.places.filter((pl) => pl.date && !isWithinRange(pl.date, p.startDate, p.endDate)).length;
    return outside ? t('project.savedOutside', { n: outside }) : t('common.saved');
  }
  return null;
}

/** Filter options: built-in types, then any type the user wrote on a project. */
function typeOptions(projects) {
  const custom = [...new Set(projects.flatMap((p) => p.customTypes ?? []))].sort((a, b) => a.localeCompare(b, 'ko'));
  return [
    { id: 'all', label: t('home.allTypes') },
    ...TYPES,
    ...custom.map((c) => ({ id: `${CUSTOM_TYPE_PREFIX}${c}`, label: c })),
  ];
}

export async function renderHome({ isCurrent }) {
  const [projects, lastBackupAt] = await Promise.all([listProjects(), getLastBackupAt().catch(() => undefined)]);
  if (!isCurrent()) return null;
  const prefs = loadPrefs();
  const typeOpts = typeOptions(projects);
  if (!typeOpts.some((o) => o.id === prefs.type)) prefs.type = 'all';
  const synced = Boolean(getSyncState().email);
  const needsBackup = !synced && projects.length > 0 && (!lastBackupAt || Date.now() - lastBackupAt > BACKUP_NUDGE_MS);

  const app = mount(`
    <div class="view">
      <header class="page-header">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="eyebrow">Vlog Studio ${offlineBadge()} <span id="sync-badge"></span></p>
            <h1 class="page-title">${esc(t('home.title'))}</h1>
            <p class="mt-1 text-[14px] text-muted">${esc(t('home.sub'))}</p>
          </div>
          <a href="#/new" class="icon-btn icon-btn-solid mt-1" aria-label="${esc(t('home.newAria'))}">${icon('plus')}</a>
        </div>
      </header>
      <main class="page-main">
        ${
          needsBackup
            ? `<a href="#/settings" class="notice mb-4">
                ${icon('archive', 'size-5 mt-0.5')}
                <span class="flex-1"><b class="font-semibold">${esc(t('home.backupTitle'))}</b><br><span class="text-muted">${esc(t('home.backupBody'))}${getLang() === 'zh' ? '' : ' '}${esc(lastBackupAt ? t('home.lastBackup', { v: formatRelative(lastBackupAt) }) : t('home.neverBackedUp'))}</span></span>
                ${icon('chevronRight', 'size-5 text-muted mt-0.5')}
              </a>`
            : ''
        }
        ${
          projects.length
            ? `
        <label class="search">
          ${icon('search', 'size-5 text-muted')}
          <input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="${esc(t('home.search'))}" value="${esc(prefs.query)}" aria-label="${esc(t('home.search'))}" />
        </label>
        <div class="chip-row mt-3" role="group" aria-label="${esc(t('home.statusFilter'))}" id="status-chips">
          ${[{ id: 'all', label: t('home.all') }, ...STATUSES]
            .map((s) => `<button type="button" class="chip" data-status="${s.id}" aria-pressed="${prefs.status === s.id}">${esc(s.label)}</button>`)
            .join('')}
        </div>
        <div class="mt-4 mb-2.5 flex items-center justify-between gap-2">
          <p id="count" class="text-[14px] text-muted" aria-live="polite"></p>
          <div class="flex items-center gap-1.5">
            <label class="select-pill">
              <span class="sr-only">${esc(t('project.types'))}</span>
              <span aria-hidden="true" data-label-for="type">${esc(labelOf(typeOpts, prefs.type))}</span>
              <select id="type">${typeOptionsHtml()}</select>
              ${icon('chevronDown', 'size-4')}
            </label>
            <label class="select-pill">
              ${icon('sort', 'size-4')}
              <span class="sr-only">${esc(t('home.sort'))}</span>
              <span aria-hidden="true" data-label-for="sort">${esc(labelOf(SORT_OPTIONS, prefs.sort))}</span>
              <select id="sort">
                ${SORT_OPTIONS.map((o) => `<option value="${o.id}" ${prefs.sort === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
              </select>
              ${icon('chevronDown', 'size-4')}
            </label>
          </div>
        </div>
        <ul id="list" class="flex flex-col gap-3"></ul>`
            : `
        <div class="empty mt-6">
          <div class="empty-icon">${icon('film', 'size-7')}</div>
          <h2 class="text-[18px] font-semibold">${esc(t('home.emptyTitle'))}</h2>
          <p class="mt-1.5 text-[14px] text-muted leading-relaxed">${esc(t('home.emptyFlow'))}<br>${esc(t('home.emptyBody'))}</p>
          <a href="#/new" class="btn btn-primary mt-5">${icon('plus')}${esc(t('nav.new'))}</a>
          <a href="#/settings" class="btn btn-ghost mt-2 text-[14px]">${esc(t('home.restore'))}</a>
        </div>`
        }
      </main>
      ${bottomNav(HOME_NAV, 'home')}
    </div>`);

  function typeOptionsHtml() {
    return typeOpts.map((o) => `<option value="${esc(o.id)}" ${prefs.type === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  }

  const list = $('#list', app);
  function renderList() {
    if (!list) return;
    const shown = sortProjects(filterProjects(projects, prefs), prefs.sort);
    const filtering = prefs.query.trim() || prefs.status !== 'all' || prefs.type !== 'all';
    $('#count', app).textContent = filtering ? t('home.found', { n: shown.length, total: projects.length }) : t('home.count', { n: projects.length });
    list.innerHTML = shown.length
      ? shown.map(card).join('')
      : `<li class="empty">
          <div class="empty-icon">${icon('search', 'size-6')}</div>
          <p class="font-semibold">${esc(t('home.noMatch'))}</p>
          <p class="mt-1 text-[14px] text-muted">${esc(t('home.noMatchHint'))}</p>
          <button type="button" class="btn btn-secondary mt-4" id="reset-filters">${esc(t('home.resetFilters'))}</button>
        </li>`;
  }
  renderList();
  const swipe = swipeRows(app);

  async function removeProject(p) {
    const ok = await confirmDialog({
      title: t('project.deleteTitle'),
      message: t('project.deleteBody', { name: p.name }),
      confirmText: t('common.delete'),
      danger: true,
    });
    if (!ok) return swipe.close();
    try {
      await deleteProject(p.id);
    } catch (err) {
      toast(t('common.deleteFailed', { msg: err.message }), { tone: 'error' });
      return swipe.close();
    }
    projects.splice(projects.indexOf(p), 1);
    toast(t('project.deleted'));
    if (!projects.length) return navigate('/', { replace: true }); // reload into the empty-state screen
    renderList();
  }

  app.addEventListener('input', (e) => {
    if (e.target.id !== 'q') return;
    prefs.query = e.target.value;
    savePrefs(prefs);
    renderList();
  });
  app.addEventListener('change', (e) => {
    if (e.target.id === 'sort' || e.target.id === 'type') {
      prefs[e.target.id] = e.target.value;
      app.querySelector(`[data-label-for="${e.target.id}"]`).textContent = e.target.selectedOptions[0].textContent;
      savePrefs(prefs);
      renderList();
    }
  });
  app.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-delete]');
    if (del) {
      const p = projects.find((x) => x.id === del.closest('[data-id]').dataset.id);
      if (p) removeProject(p);
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const p = projects.find((x) => x.id === edit.closest('[data-id]').dataset.id);
      if (!p) return;
      const before = structuredClone(p);
      const message = await quickEdit(p, edit.dataset.edit);
      if (!message) return;
      try {
        await saveProject(p);
        toast(message);
      } catch (err) {
        Object.assign(p, before);
        toast(t('common.saveFailed', { msg: err.message }), { tone: 'error' });
      }
      renderList();
      app.querySelector(`[data-id="${CSS.escape(p.id)}"] [data-edit="${edit.dataset.edit}"]`)?.focus({ preventScroll: true });
      return;
    }
    const chip = e.target.closest('[data-status]');
    if (chip) {
      prefs.status = chip.dataset.status;
      app.querySelectorAll('[data-status]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      savePrefs(prefs);
      renderList();
    }
    if (e.target.closest('#reset-filters')) {
      Object.assign(prefs, { query: '', status: 'all', type: 'all' });
      savePrefs(prefs);
      $('#q', app).value = '';
      $('#type', app).value = 'all';
      app.querySelector('[data-label-for="type"]').textContent = t('home.allTypes');
      app.querySelectorAll('[data-status]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.status === 'all')));
      renderList();
    }
  });

  const badge = $('#sync-badge', app);
  const SYNC_BADGE = { syncing: t('sync.syncing'), synced: t('sync.synced'), offline: '', error: t('sync.errorBadge') };
  const offSync = onSyncState((st) => {
    const text = st.email ? (SYNC_BADGE[st.status] ?? '') : '';
    badge.className = text ? `pill ${st.status === 'error' ? 'pill-warm' : 'pill-muted'}` : '';
    badge.textContent = text;
  });
  // Another device changed something: reload the list, unless the user is in the middle of something here.
  const offRemote = onRemoteChange(() => {
    const busy = document.querySelector('.overlay') || app.querySelector('.swipe-row.is-open, .swipe-row.is-dragging') || document.activeElement?.id === 'q';
    if (!busy) navigate('/', { replace: true });
  });

  requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  return {
    kind: 'home',
    leave() {
      savedScroll = window.scrollY;
    },
    destroy() {
      offSync();
      offRemote();
    },
  };
}
