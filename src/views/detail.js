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

const TABS = [
  { id: 'plan', label: '기획', zh: '策划', icon: 'idea', mod: planTab },
  { id: 'route', label: '동선', zh: '行程', icon: 'route', mod: routeTab },
  { id: 'shots', label: '촬영', zh: '镜头', icon: 'camera', mod: shotsTab },
  { id: 'field', label: '현장 기록', zh: '现场', icon: 'note', mod: fieldTab },
  { id: 'edit', label: '편집', zh: '后期', icon: 'film', mod: editTab },
];
const lastTab = new Map();

// "Next step" button at the bottom of each tab, so the flow continues without the bottom nav.
const NEXT_STEP = {
  plan: { tab: 'route', label: '동선 짜러 가기' },
  route: { tab: 'shots', label: '촬영 준비하러 가기', when: (p) => p.places.length > 0 },
  shots: { tab: 'field', label: '현장 기록 남기러 가기', when: (p) => p.places.length > 0 },
  field: { tab: 'edit', label: '영상으로 엮으러 가기', when: (_, sub) => !sub },
};

const SAVE_TEXT = { idle: '', pending: '입력 중', saving: '저장 중…', saved: '저장됨', error: '저장 실패' };

export async function renderDetail([id, tab, sub], { isCurrent, previous }) {
  if (previous?.kind === 'detail' && previous.projectId === id && tab) {
    previous.show(tab, sub);
    return previous;
  }
  const project = await getProject(id);
  if (!isCurrent()) return null;
  if (!project) {
    toast('프로젝트를 찾을 수 없어요. 삭제되었을 수 있어요.');
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
        <a href="#/" class="icon-btn" aria-label="프로젝트 목록으로">${icon('chevronLeft')}</a>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-[16px] font-semibold leading-tight" id="d-name"></h1>
          <div class="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
            <span class="tabular-nums" id="d-range"></span>
            <button type="button" id="d-status" class="status-btn" aria-label="상태 변경"></button>
          </div>
        </div>
        <span id="save-state" class="save-state" aria-live="polite"></span>
        <button type="button" class="icon-btn" id="d-more" aria-label="프로젝트 메뉴">${icon('more')}</button>
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
    commit: () => saveNow(project).catch((err) => toast(`저장 실패: ${err.message}`, { tone: 'error' })),
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
      btn.innerHTML = `${esc(next.label)} ${icon('chevronRight', 'size-4')}`;
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
      title: '프로젝트 상태',
      actions: STATUSES.map((s) => ({ id: s.id, label: s.label, active: s.id === project.status })),
    });
    if (!next || next === project.status) return;
    project.status = next;
    await ctx.commit();
    refreshHeader();
    toast('상태를 바꿨어요.');
  }

  async function openMenu() {
    const choice = await actionSheet({
      title: project.name,
      actions: [
        { id: 'info', label: '프로젝트 정보 수정', icon: 'edit', hint: '이름 · 촬영 날짜 · 장소 · 유형' },
        { id: 'status', label: '상태 변경', icon: 'flag' },
        { id: 'md', label: 'Markdown 파일로 내보내기', icon: 'download', hint: 'AI에 붙여 넣어 대본 만들기 좋게 정리돼요' },
        { id: 'copy', label: '프로젝트 내용 복사', icon: 'doc', hint: 'Markdown 형식으로 클립보드에 복사' },
        { id: 'dup', label: '프로젝트 복제', icon: 'copy', hint: '모든 기록이 독립된 사본으로 복제돼요' },
        { id: 'del', label: '프로젝트 삭제', icon: 'trash', danger: true },
      ],
    });
    if (!choice) return;
    await flushAll().catch(() => {});
    if (choice === 'info') navigate(`/p/${encodeURIComponent(id)}/info`);
    if (choice === 'status') changeStatus();
    if (choice === 'md') {
      downloadFile(`${safeFileName(project.name)}_${project.startDate}.md`, projectToMarkdown(project), 'text/markdown');
      toast('Markdown 파일을 내보냈어요.');
    }
    if (choice === 'copy') {
      toast((await copyText(projectToMarkdown(project))) ? '프로젝트 내용을 복사했어요.' : '복사하지 못했어요.');
    }
    if (choice === 'dup') {
      const copy = await duplicateProject(id);
      toast('복제했어요. 복사본을 열었어요.');
      navigate(`/p/${encodeURIComponent(copy.id)}/${current.tab}`);
    }
    if (choice === 'del') {
      const ok = await confirmDialog({
        title: '프로젝트를 삭제할까요?',
        message: `"${project.name}"의 기획, 동선, 체크리스트, 현장 기록, 편집 구성이 모두 삭제되며 되돌릴 수 없어요.\n필요하면 먼저 백업하세요.`,
        confirmText: '삭제',
        danger: true,
      });
      if (!ok) return;
      await deleteProject(id);
      toast('프로젝트를 삭제했어요.');
      navigate('/', { replace: true });
    }
  }

  $('#d-status', root).addEventListener('click', changeStatus);
  $('#d-more', root).addEventListener('click', openMenu);
  const saveState = $('#save-state', root);
  const unsubscribe = onSaveStatus((s) => {
    saveState.dataset.state = s;
    saveState.innerHTML = s === 'saved' ? `${icon('check', 'size-3.5')}${SAVE_TEXT[s]}` : esc(SAVE_TEXT[s] ?? '');
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
      toast('다른 기기에서 이 프로젝트를 삭제했어요.');
      navigate('/', { replace: true });
      return;
    }
    if (fresh.updatedAt <= project.updatedAt) return;
    Object.assign(project, fresh);
    refreshHeader();
    ctx.rerender();
    toast('다른 기기에서 수정한 내용을 불러왔어요.');
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
