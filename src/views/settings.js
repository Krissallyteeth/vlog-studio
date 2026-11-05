import { flushAll } from '../data/autosave.js';
import { getSyncState, onSyncState, signIn, signOut, signUp, syncNow } from '../data/sync.js';
import { exportBackup, getLastBackupAt, importProjects, listProjects } from '../data/repo.js';
import { formatRelative, formatTimestamp, todayString } from '../lib/dates.js';
import { SCHEMA_VERSION, parseBackup } from '../lib/schema.js';
import { $, actionSheet, confirmDialog, downloadFile, esc, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { HOME_NAV, bottomNav, mount } from '../ui/layout.js';
import { getTheme, setTheme } from '../ui/theme.js';

const THEMES = [
  { id: 'system', label: '시스템' },
  { id: 'light', label: '라이트' },
  { id: 'dark', label: '다크' },
];

function syncStatusLine(st) {
  if (st.status === 'syncing') return '동기화 중…';
  if (st.status === 'offline') return '오프라인이에요. 연결되면 자동으로 맞춰요.';
  if (st.status === 'error') return `동기화하지 못했어요: ${st.error}`;
  if (st.lastSyncedAt) return `마지막 동기화 ${formatRelative(st.lastSyncedAt)}`;
  return '';
}

/** Sync account card + the storage notice above it, both depend on the sign-in state. */
function syncSection(st) {
  const signedIn = st.email && st.status !== 'signed-out';
  const notice = signedIn
    ? `<section class="notice">
        ${icon('check', 'size-5 mt-0.5')}
        <div class="flex-1 text-[14px] leading-relaxed">
          <b class="font-semibold">기록이 로그인한 모든 기기와 자동으로 맞춰져요.</b>
          <p class="mt-1 text-muted">이 기기에도 저장돼서 오프라인에서도 쓸 수 있고, 연결되면 알아서 올라가요.</p>
        </div>
      </section>`
    : `<section class="notice notice-strong">
        ${icon('info', 'size-5 mt-0.5')}
        <div class="flex-1 text-[14px] leading-relaxed">
          <b class="font-semibold">지금 기록은 이 기기의 브라우저에만 저장돼요.</b>
          <p class="mt-1 text-muted">${st.status === 'off' ? '' : '아래에서 로그인하면 컴퓨터·폰 어디서든 같은 기록을 이어서 쓸 수 있어요. '}브라우저 데이터를 지우거나 앱을 삭제하면 기록이 사라질 수 있으니 백업 파일도 저장해 두세요.</p>
        </div>
      </section>`;
  if (st.status === 'off') return notice;
  if (signedIn) {
    return `${notice}
      <section class="card">
        <h2 class="text-[16px] font-semibold">기기 간 동기화</h2>
        <p class="mt-1 text-[14px]">${esc(st.email)}</p>
        <p class="mt-0.5 text-[13px] ${st.status === 'error' ? 'text-danger' : 'text-muted'}" aria-live="polite">${esc(syncStatusLine(st))}</p>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-secondary" id="sync-now" ${st.status === 'syncing' ? 'disabled' : ''}>지금 동기화</button>
          <button type="button" class="btn btn-ghost" id="sign-out">로그아웃</button>
        </div>
      </section>`;
  }
  return `${notice}
    <section class="card">
      <h2 class="text-[16px] font-semibold">기기 간 동기화</h2>
      <p class="mt-1 text-[14px] text-muted">컴퓨터와 폰에서 같은 계정으로 로그인하세요. 이 기기에 있던 기록도 계정으로 함께 올라가요.</p>
      <form id="auth-form" class="mt-3 flex flex-col gap-2" novalidate>
        <input name="email" type="email" class="input" autocomplete="email" placeholder="이메일" aria-label="이메일" required />
        <input name="password" type="password" class="input" autocomplete="current-password" placeholder="비밀번호 (8자 이상)" aria-label="비밀번호" minlength="8" required />
        <p class="form-error hidden" id="auth-error" role="alert"></p>
        <div class="grid grid-cols-[2fr_1fr] gap-2">
          <button type="submit" class="btn btn-primary" data-auth="in">로그인</button>
          <button type="submit" class="btn btn-secondary" data-auth="up">회원가입</button>
        </div>
      </form>
    </section>`;
}

async function storageInfo() {
  const s = navigator.storage;
  const [persisted, estimate] = await Promise.all([
    s?.persisted?.().catch(() => undefined),
    s?.estimate?.().catch(() => undefined),
  ]);
  return { persisted, usage: estimate?.usage };
}

export async function renderSettings({ isCurrent }) {
  const [projects, lastBackupAt, storage] = await Promise.all([listProjects(), getLastBackupAt().catch(() => undefined), storageInfo()]);
  if (!isCurrent()) return null;
  const theme = getTheme();

  const root = mount(`
    <div class="view">
      <header class="page-header">
        <p class="eyebrow">Vlog Studio</p>
        <h1 class="page-title">백업 · 설정</h1>
      </header>
      <main class="page-main flex flex-col gap-4">
        <div id="sync-area" class="flex flex-col gap-4"></div>

        <section class="card">
          <h2 class="text-[16px] font-semibold">전체 백업 <span class="zh">JSON</span></h2>
          <p class="mt-1 text-[14px] text-muted">프로젝트 ${projects.length}개 · 마지막 백업 <span id="last-backup">${lastBackupAt ? esc(formatTimestamp(lastBackupAt)) : '없음'}</span></p>
          <button type="button" class="btn btn-primary w-full mt-3" id="backup">${icon('download', 'size-5')}백업 파일 저장</button>
          <p class="mt-2 text-[12px] text-muted">저장한 파일은 클라우드 드라이브나 메신저 '나에게 보내기'에 보관하면 안전해요.</p>
        </section>

        <section class="card">
          <h2 class="text-[16px] font-semibold">백업에서 복원</h2>
          <p class="mt-1 text-[14px] text-muted">Vlog Studio에서 만든 JSON 파일만 불러올 수 있어요. 불러오기 전에 내용을 확인해요.</p>
          <label class="btn btn-secondary w-full mt-3 cursor-pointer">
            ${icon('upload', 'size-5')}백업 파일 선택
            <input type="file" id="import" accept="application/json,.json" class="sr-only" />
          </label>
          <ul id="import-errors" class="form-error mt-3 hidden list-disc pl-5" role="alert"></ul>
        </section>

        <section class="card">
          <h2 class="text-[16px] font-semibold">화면 모드</h2>
          <div class="segmented segmented-3 mt-3" role="radiogroup" aria-label="화면 모드">
            ${THEMES.map((t) => `<button type="button" role="radio" class="seg ${t.id === theme ? 'is-active' : ''}" aria-checked="${t.id === theme}" data-theme="${t.id}">${t.label}</button>`).join('')}
          </div>
        </section>

        <section class="card text-[14px]">
          <h2 class="text-[16px] font-semibold">저장 공간</h2>
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted">
            <dt>영구 저장</dt>
            <dd class="text-ink" id="persist-state">${storage.persisted === true ? '허용됨 (브라우저가 임의로 지우지 않아요)' : storage.persisted === false ? '허용 안 됨' : '확인 불가'}</dd>
            ${storage.usage !== undefined ? `<dt>사용량</dt><dd class="text-ink tabular-nums">${(storage.usage / 1024 / 1024).toFixed(2)} MB</dd>` : ''}
            <dt>앱 버전</dt><dd class="text-ink tabular-nums">${esc(__APP_VERSION__)} · 데이터 스키마 v${SCHEMA_VERSION}</dd>
          </dl>
          ${storage.persisted === false ? '<button type="button" class="btn btn-secondary w-full mt-3" id="persist">영구 저장 요청</button>' : ''}
        </section>

        <section class="card text-[14px] leading-relaxed text-muted">
          <h2 class="text-[16px] font-semibold text-ink">홈 화면에 추가</h2>
          <p class="mt-1"><b class="text-ink">iPhone (Safari)</b>: 공유 버튼 → '홈 화면에 추가'</p>
          <p><b class="text-ink">Android (Chrome)</b>: 메뉴 ⋮ → '앱 설치' 또는 '홈 화면에 추가'</p>
          <p class="mt-1">한 번 열어 두면 오프라인에서도 기록을 열고 작성할 수 있어요.</p>
        </section>
      </main>
      ${bottomNav(HOME_NAV, 'settings')}
    </div>`);

  // Re-render the sync card on state changes, but never while the user is typing into it.
  const syncArea = $('#sync-area', root);
  let busy = false;
  const unsubscribe = onSyncState((st) => {
    if (busy || (syncArea.contains(document.activeElement) && document.activeElement.matches('input'))) return;
    syncArea.innerHTML = syncSection(st);
  });

  syncArea.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const error = $('#auth-error', form);
    const email = form.email.value.trim();
    const password = form.password.value;
    const mode = e.submitter?.dataset.auth ?? 'in';
    const fail = (msg, el) => {
      error.textContent = msg;
      error.classList.remove('hidden');
      el?.focus();
    };
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail('이메일을 확인해 주세요.', form.email);
    if (password.length < 8) return fail('비밀번호는 8자 이상이어야 해요.', form.password);
    busy = true;
    form.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      if (mode === 'up') {
        const { needsConfirm } = await signUp(email, password);
        if (needsConfirm) {
          busy = false;
          form.querySelectorAll('button').forEach((b) => (b.disabled = false));
          fail(`${email}로 인증 메일을 보냈어요. 메일의 링크를 누른 뒤 여기서 로그인하세요.`);
          error.classList.remove('form-error');
          error.classList.add('text-[14px]');
          return;
        }
        toast('가입했어요. 동기화를 시작해요.');
      } else {
        await signIn(email, password);
        toast('로그인했어요. 동기화를 시작해요.');
      }
    } catch (err) {
      busy = false;
      form.querySelectorAll('button').forEach((b) => (b.disabled = false));
      return fail(err.message);
    }
    busy = false;
    document.activeElement?.blur();
    syncArea.innerHTML = syncSection(getSyncState());
  });

  syncArea.addEventListener('click', async (e) => {
    if (e.target.closest('#sync-now')) syncNow();
    if (e.target.closest('#sign-out')) {
      const ok = await confirmDialog({
        title: '로그아웃할까요?',
        message: '이 기기의 기록은 그대로 남지만, 다른 기기와 더 이상 맞춰지지 않아요.',
        confirmText: '로그아웃',
      });
      if (!ok) return;
      await signOut();
      toast('로그아웃했어요.');
    }
  });

  $('#backup', root).addEventListener('click', async () => {
    await flushAll().catch(() => {});
    const backup = await exportBackup();
    downloadFile(`vlog-studio-backup_${todayString()}.json`, JSON.stringify(backup, null, 2));
    $('#last-backup', root).textContent = formatTimestamp(Date.now());
    toast(`프로젝트 ${backup.projectCount}개를 백업했어요.`);
  });

  const errors = $('#import-errors', root);
  $('#import', root).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    errors.classList.add('hidden');
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast('파일이 너무 커요.');
      return;
    }
    const result = parseBackup(await file.text());
    if (!result.ok) {
      errors.innerHTML = result.errors.slice(0, 8).map((m) => `<li>${esc(m)}</li>`).join('');
      errors.classList.remove('hidden');
      toast('백업 파일을 불러올 수 없어요.', { tone: 'error' });
      return;
    }
    const existing = await listProjects();
    const existingIds = new Set(existing.map((p) => p.id));
    const overlap = result.projects.filter((p) => existingIds.has(p.id)).length;
    const when = result.exportedAt ? formatTimestamp(Date.parse(result.exportedAt)) : '알 수 없음';
    const mode = await actionSheet({
      title: `백업 파일: 프로젝트 ${result.projects.length}개 (${when})`,
      actions: [
        { id: 'merge', label: '현재 기록에 합치기', icon: 'copy', hint: overlap ? `같은 프로젝트 ${overlap}개는 백업 내용으로 덮어써요` : '기존 프로젝트는 그대로 유지돼요' },
        { id: 'replace', label: '전체 교체', icon: 'archive', danger: true, hint: `현재 기기의 프로젝트 ${existing.length}개를 모두 지우고 백업으로 바꿔요` },
      ],
    });
    if (!mode) return;
    const ok = await confirmDialog(
      mode === 'replace'
        ? { title: '전체 교체할까요?', message: `현재 프로젝트 ${existing.length}개가 삭제되고 백업의 ${result.projects.length}개로 바뀌어요. 되돌릴 수 없어요.\n필요하면 먼저 현재 데이터를 백업하세요.`, confirmText: '전체 교체', danger: true }
        : { title: '백업을 합칠까요?', message: `${result.projects.length}개 프로젝트를 불러와요.${overlap ? `\n같은 ID의 프로젝트 ${overlap}개는 백업 내용으로 덮어써요.` : ''}`, confirmText: '불러오기', danger: overlap > 0 },
    );
    if (!ok) return;
    await flushAll().catch(() => {});
    const count = await importProjects(result.projects, mode);
    toast(`프로젝트 ${count}개를 복원했어요.`);
    location.hash = '#/';
  });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-theme]');
    if (t) {
      setTheme(t.dataset.theme);
      root.querySelectorAll('[data-theme]').forEach((b) => {
        b.classList.toggle('is-active', b === t);
        b.setAttribute('aria-checked', String(b === t));
      });
    }
    if (e.target.closest('#persist')) {
      const granted = await navigator.storage?.persist?.().catch(() => false);
      $('#persist-state', root).textContent = granted ? '허용됨 (브라우저가 임의로 지우지 않아요)' : '브라우저가 요청을 거절했어요. 홈 화면에 추가하면 허용될 수 있어요.';
      if (granted) e.target.closest('#persist').remove();
    }
  });

  window.scrollTo(0, 0);
  return { kind: 'settings', destroy: unsubscribe };
}
