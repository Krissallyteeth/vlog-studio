import { listProjects, getLastBackupAt, saveProject } from '../data/repo.js';
import { CUSTOM_TYPE_PREFIX, SORT_OPTIONS, STATUSES, TYPES, labelOf, typeLabels } from '../lib/constants.js';
import { formatRange, formatRelative, isEndBeforeStart, isValidDate, isWithinRange } from '../lib/dates.js';
import { projectProgress } from '../lib/progress.js';
import { filterProjects, sortProjects } from '../lib/sort.js';
import { $, actionSheet, esc, openSheet, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { HOME_NAV, bottomNav, mount, offlineBadge } from '../ui/layout.js';

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
  return `
    <li class="card project-card" data-id="${esc(p.id)}">
      <a class="card-link" href="#/p/${encodeURIComponent(p.id)}" aria-label="${esc(p.name)} 열기"></a>
      <div class="flex items-center justify-between gap-2 text-[13px] text-muted">
        <button type="button" class="card-edit inline-flex items-center gap-1.5 tabular-nums" data-edit="dates" aria-label="촬영 날짜 수정: ${esc(formatRange(p.startDate, p.endDate))}">${icon('calendar', 'size-4')}${esc(formatRange(p.startDate, p.endDate))}</button>
        <button type="button" class="card-edit" data-edit="status" aria-label="상태 변경: ${esc(labelOf(STATUSES, p.status))}">${statusPill(p.status)}</button>
      </div>
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <h2 class="mt-1.5 text-[18px] font-semibold leading-snug tracking-tight"><button type="button" class="card-edit line-clamp-2 text-left" data-edit="name" aria-label="프로젝트명 수정: ${esc(p.name)}">${esc(p.name)}</button></h2>
          <button type="button" class="card-edit mt-0.5 inline-flex max-w-full items-center gap-1.5 text-[14px] text-muted" data-edit="location" aria-label="촬영 지역 수정">${icon('pin', 'size-4 shrink-0')}<span class="line-clamp-1 text-left">${p.location ? esc(p.location) : '촬영 지역 추가'}</span></button>
        </div>
        ${icon('chevronRight', 'size-5 text-muted')}
      </div>
      <div class="mt-3 flex items-center gap-3">
        <div class="progress flex-1" role="progressbar" aria-label="작성 진행률" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
        <span class="text-[12px] font-medium tabular-nums w-9 text-right">${pct}%</span>
      </div>
      <p class="mt-2 text-[12px] text-muted">${types.length ? `${esc(types.join(' · '))} · ` : ''}마지막 수정 ${esc(formatRelative(p.updatedAt))}</p>
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
          <button type="button" class="btn btn-secondary" data-cancel>취소</button>
          <button type="submit" class="btn btn-primary">저장</button>
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
      title: '프로젝트 상태',
      actions: STATUSES.map((st) => ({ id: st.id, label: st.label, active: st.id === p.status })),
    });
    if (!next || next === p.status) return null;
    p.status = next;
    return '상태를 바꿨어요.';
  }

  if (field === 'name' || field === 'location') {
    const isName = field === 'name';
    const r = await formSheet({
      title: isName ? '프로젝트명' : '주요 촬영 지역 / 장소',
      body: `<input name="v" class="input" maxlength="${isName ? 80 : 120}" value="${esc(p[field])}" placeholder="${isName ? '예: 전주 당일치기 Vlog' : '예: 전주 · 한옥마을'}" aria-label="${isName ? '프로젝트명' : '촬영 지역'}" enterkeyhint="done" autofocus />`,
      read: (form) => {
        const v = form.v.value.trim();
        return isName && !v ? { error: '프로젝트명을 입력해 주세요.', focus: form.v } : { value: v };
      },
    });
    if (!r || r.value === p[field]) return null;
    p[field] = r.value;
    return '저장했어요.';
  }

  if (field === 'dates') {
    const r = await formSheet({
      title: '촬영 날짜',
      body: `
        <div class="grid grid-cols-2 gap-3">
          <label class="field"><span class="field-label">시작일 <span class="req">필수</span></span><input name="start" type="date" class="input" required value="${esc(p.startDate)}" /></label>
          <label class="field"><span class="field-label">종료일 <span class="opt">선택</span></span><input name="end" type="date" class="input" min="${esc(p.startDate)}" value="${esc(p.endDate)}" /></label>
        </div>
        <p class="text-[13px] text-muted">하루 촬영이면 종료일은 비워 두세요.</p>`,
      read: (form) => {
        const start = form.start.value;
        const end = form.end.value;
        if (!isValidDate(start)) return { error: '촬영 시작일을 선택해 주세요.', focus: form.start };
        if (end && isEndBeforeStart(start, end)) return { error: '종료일은 시작일 이후로 선택해 주세요.', focus: form.end };
        return { value: { start, end: end && end !== start ? end : '' } };
      },
    });
    if (!r || (r.value.start === p.startDate && r.value.end === p.endDate)) return null;
    p.startDate = r.value.start;
    p.endDate = r.value.end;
    const outside = p.places.filter((pl) => pl.date && !isWithinRange(pl.date, p.startDate, p.endDate)).length;
    return outside ? `저장했어요. 촬영 기간 밖 방문일이 ${outside}곳 있어요.` : '저장했어요.';
  }
  return null;
}

/** Filter options: built-in types, then any type the user wrote on a project. */
function typeOptions(projects) {
  const custom = [...new Set(projects.flatMap((p) => p.customTypes ?? []))].sort((a, b) => a.localeCompare(b, 'ko'));
  return [
    { id: 'all', label: '모든 유형' },
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
  const needsBackup = projects.length > 0 && (!lastBackupAt || Date.now() - lastBackupAt > BACKUP_NUDGE_MS);

  const app = mount(`
    <div class="view">
      <header class="page-header">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="eyebrow">Vlog Studio ${offlineBadge()}</p>
            <h1 class="page-title">나의 Vlog</h1>
            <p class="mt-1 text-[14px] text-muted">촬영 프로젝트를 한곳에서 관리해요.</p>
          </div>
          <a href="#/new" class="icon-btn icon-btn-solid mt-1" aria-label="새 프로젝트 만들기">${icon('plus')}</a>
        </div>
      </header>
      <main class="page-main">
        ${
          needsBackup
            ? `<a href="#/settings" class="notice mb-4">
                ${icon('archive', 'size-5 mt-0.5')}
                <span class="flex-1"><b class="font-semibold">백업을 권장해요</b><br><span class="text-muted">기록은 이 기기 브라우저에만 저장돼요. ${lastBackupAt ? `마지막 백업 ${esc(formatRelative(lastBackupAt))}` : '아직 백업한 적이 없어요.'}</span></span>
                ${icon('chevronRight', 'size-5 text-muted mt-0.5')}
              </a>`
            : ''
        }
        ${
          projects.length
            ? `
        <label class="search">
          ${icon('search', 'size-5 text-muted')}
          <input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="프로젝트 또는 장소 검색" value="${esc(prefs.query)}" aria-label="프로젝트 또는 장소 검색" />
        </label>
        <div class="chip-row mt-3" role="group" aria-label="상태 필터" id="status-chips">
          ${[{ id: 'all', label: '전체' }, ...STATUSES]
            .map((s) => `<button type="button" class="chip" data-status="${s.id}" aria-pressed="${prefs.status === s.id}">${esc(s.label)}</button>`)
            .join('')}
        </div>
        <div class="mt-4 mb-2.5 flex items-center justify-between gap-2">
          <p id="count" class="text-[14px] text-muted" aria-live="polite"></p>
          <div class="flex items-center gap-1.5">
            <label class="select-pill">
              <span class="sr-only">영상 유형</span>
              <span aria-hidden="true" data-label-for="type">${esc(labelOf(typeOpts, prefs.type))}</span>
              <select id="type">${typeOptionsHtml()}</select>
              ${icon('chevronDown', 'size-4')}
            </label>
            <label class="select-pill">
              ${icon('sort', 'size-4')}
              <span class="sr-only">정렬</span>
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
          <h2 class="text-[18px] font-semibold">첫 Vlog 프로젝트를 만들어 보세요</h2>
          <p class="mt-1.5 text-[14px] text-muted leading-relaxed">기획 → 동선 → 촬영 체크 → 현장 기록 → 편집까지<br>한 프로젝트 안에서 차곡차곡 쌓여요.</p>
          <a href="#/new" class="btn btn-primary mt-5">${icon('plus')}새 프로젝트</a>
          <a href="#/settings" class="btn btn-ghost mt-2 text-[14px]">백업 파일에서 복원하기</a>
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
    $('#count', app).textContent = filtering ? `${shown.length}개 찾음 · 전체 ${projects.length}개` : `총 ${projects.length}개 프로젝트`;
    list.innerHTML = shown.length
      ? shown.map(card).join('')
      : `<li class="empty">
          <div class="empty-icon">${icon('search', 'size-6')}</div>
          <p class="font-semibold">조건에 맞는 프로젝트가 없어요</p>
          <p class="mt-1 text-[14px] text-muted">검색어나 필터를 바꿔 보세요.</p>
          <button type="button" class="btn btn-secondary mt-4" id="reset-filters">필터 초기화</button>
        </li>`;
  }
  renderList();

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
        toast(`저장하지 못했어요: ${err.message}`, { tone: 'error' });
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
      app.querySelector('[data-label-for="type"]').textContent = '모든 유형';
      app.querySelectorAll('[data-status]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.status === 'all')));
      renderList();
    }
  });

  requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  return {
    kind: 'home',
    leave() {
      savedScroll = window.scrollY;
    },
  };
}
