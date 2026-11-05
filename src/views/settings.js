import { flushAll } from '../data/autosave.js';
import { getSyncState, onSyncState, signIn, signOut, signUp, syncNow } from '../data/sync.js';
import { exportBackup, getLastBackupAt, importProjects, listProjects } from '../data/repo.js';
import { formatRelative, formatTimestamp, todayString } from '../lib/dates.js';
import { SCHEMA_VERSION, parseBackup } from '../lib/schema.js';
import { $, actionSheet, confirmDialog, downloadFile, esc, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { HOME_NAV, bottomNav, mount } from '../ui/layout.js';
import { getTheme, setTheme } from '../ui/theme.js';
import { LANG_OPTIONS, getLangPref, setLangPref, t } from '../i18n/index.js';
import { navigate } from '../router.js';

const THEMES = [
  { id: 'system', get label() { return t('theme.system'); } },
  { id: 'light', get label() { return t('theme.light'); } },
  { id: 'dark', get label() { return t('theme.dark'); } },
];

function syncStatusLine(st) {
  if (st.status === 'syncing') return t('sync.syncingLong');
  if (st.status === 'offline') return t('sync.offline');
  if (st.status === 'error') return t('sync.failed', { msg: st.error });
  if (st.lastSyncedAt) return t('sync.last', { v: formatRelative(st.lastSyncedAt) });
  return '';
}

/** Sync account card + the storage notice above it, both depend on the sign-in state. */
function syncSection(st) {
  const signedIn = st.email && st.status !== 'signed-out';
  const notice = signedIn
    ? `<section class="notice">
        ${icon('check', 'size-5 mt-0.5')}
        <div class="flex-1 text-[14px] leading-relaxed">
          <b class="font-semibold">${esc(t('sync.onTitle'))}</b>
          <p class="mt-1 text-muted">${esc(t('sync.onBody'))}</p>
        </div>
      </section>`
    : `<section class="notice notice-strong">
        ${icon('info', 'size-5 mt-0.5')}
        <div class="flex-1 text-[14px] leading-relaxed">
          <b class="font-semibold">${esc(t('sync.offTitle'))}</b>
          <p class="mt-1 text-muted">${st.status === 'off' ? '' : `${esc(t('sync.offLogin'))} `}${esc(t('sync.offBody'))}</p>
        </div>
      </section>`;
  if (st.status === 'off') return notice;
  if (signedIn) {
    return `${notice}
      <section class="card">
        <h2 class="text-[16px] font-semibold">${esc(t('sync.title'))}</h2>
        <p class="mt-1 text-[14px]">${esc(st.email)}</p>
        <p class="mt-0.5 text-[13px] ${st.status === 'error' ? 'text-danger' : 'text-muted'}" aria-live="polite">${esc(syncStatusLine(st))}</p>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-secondary" id="sync-now" ${st.status === 'syncing' ? 'disabled' : ''}>${esc(t('sync.now'))}</button>
          <button type="button" class="btn btn-ghost" id="sign-out">${esc(t('auth.signOut'))}</button>
        </div>
      </section>`;
  }
  return `${notice}
    <section class="card">
      <h2 class="text-[16px] font-semibold">${esc(t('sync.title'))}</h2>
      <p class="mt-1 text-[14px] text-muted">${esc(t('sync.loginHint'))}</p>
      <form id="auth-form" class="mt-3 flex flex-col gap-2" novalidate>
        <input name="email" type="email" class="input" autocomplete="email" placeholder="${esc(t('auth.email'))}" aria-label="${esc(t('auth.email'))}" required />
        <input name="password" type="password" class="input" autocomplete="current-password" placeholder="${esc(t('auth.passwordPh'))}" aria-label="${esc(t('auth.password'))}" minlength="8" required />
        <p class="form-error hidden" id="auth-error" role="alert"></p>
        <div class="grid grid-cols-[2fr_1fr] gap-2">
          <button type="submit" class="btn btn-primary" data-auth="in">${esc(t('auth.signIn'))}</button>
          <button type="submit" class="btn btn-secondary" data-auth="up">${esc(t('auth.signUp'))}</button>
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
        <h1 class="page-title">${esc(t('settings.title'))}</h1>
      </header>
      <main class="page-main flex flex-col gap-4">
        <div id="sync-area" class="flex flex-col gap-4"></div>

        <section class="card">
          <h2 class="text-[16px] font-semibold">${esc(t('settings.backup'))}</h2>
          <p class="mt-1 text-[14px] text-muted">${esc(t('settings.backupInfo', { n: projects.length }))} <span id="last-backup">${esc(lastBackupAt ? formatTimestamp(lastBackupAt) : t('settings.none'))}</span></p>
          <button type="button" class="btn btn-primary w-full mt-3" id="backup">${icon('download', 'size-5')}${esc(t('settings.backupBtn'))}</button>
          <p class="mt-2 text-[12px] text-muted">${esc(t('settings.backupTip'))}</p>
        </section>

        <section class="card">
          <h2 class="text-[16px] font-semibold">${esc(t('settings.restore'))}</h2>
          <p class="mt-1 text-[14px] text-muted">${esc(t('settings.restoreInfo'))}</p>
          <label class="btn btn-secondary w-full mt-3 cursor-pointer">
            ${icon('upload', 'size-5')}${esc(t('settings.restoreBtn'))}
            <input type="file" id="import" accept="application/json,.json" class="sr-only" />
          </label>
          <ul id="import-errors" class="form-error mt-3 hidden list-disc pl-5" role="alert"></ul>
        </section>

        <section class="card">
          <h2 class="text-[16px] font-semibold">${esc(t('settings.theme'))}</h2>
          <div class="segmented segmented-3 mt-3" role="radiogroup" aria-label="${esc(t('settings.theme'))}">
            ${THEMES.map((th) => `<button type="button" role="radio" class="seg ${th.id === theme ? 'is-active' : ''}" aria-checked="${th.id === theme}" data-theme="${th.id}">${esc(th.label)}</button>`).join('')}
          </div>
        </section>

        <section class="card">
          <h2 class="text-[16px] font-semibold">${esc(t('settings.language'))} <span class="text-[13px] font-normal text-muted">Language · 语言</span></h2>
          <div class="segmented segmented-4 mt-3" role="radiogroup" aria-label="${esc(t('settings.language'))}">
            ${LANG_OPTIONS.map((l) => `<button type="button" role="radio" class="seg ${l.id === getLangPref() ? 'is-active' : ''}" aria-checked="${l.id === getLangPref()}" data-lang="${l.id}">${esc(l.label ?? t('settings.langSystem'))}</button>`).join('')}
          </div>
          <p class="mt-2 text-[12px] text-muted">${esc(t('settings.languageHint'))}</p>
        </section>

        <section class="card text-[14px]">
          <h2 class="text-[16px] font-semibold">${esc(t('settings.storage'))}</h2>
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted">
            <dt>${esc(t('settings.persist'))}</dt>
            <dd class="text-ink" id="persist-state">${esc(storage.persisted === true ? t('settings.persistOn') : storage.persisted === false ? t('settings.persistOff') : t('settings.persistUnknown'))}</dd>
            ${storage.usage !== undefined ? `<dt>${esc(t('settings.usage'))}</dt><dd class="text-ink tabular-nums">${(storage.usage / 1024 / 1024).toFixed(2)} MB</dd>` : ''}
            <dt>${esc(t('settings.version'))}</dt><dd class="text-ink tabular-nums">${esc(__APP_VERSION__)} · ${esc(t('settings.schema', { v: SCHEMA_VERSION }))}</dd>
          </dl>
          ${storage.persisted === false ? `<button type="button" class="btn btn-secondary w-full mt-3" id="persist">${esc(t('settings.persistBtn'))}</button>` : ''}
        </section>

        <section class="card text-[14px] leading-relaxed text-muted">
          <h2 class="text-[16px] font-semibold text-ink">${esc(t('settings.install'))}</h2>
          <p class="mt-1"><b class="text-ink">iPhone (Safari)</b>: ${esc(t('settings.installIos'))}</p>
          <p><b class="text-ink">Android (Chrome)</b>: ${esc(t('settings.installAndroid'))}</p>
          <p class="mt-1">${esc(t('settings.installOffline'))}</p>
        </section>
      </main>
      ${bottomNav(HOME_NAV, 'more')}
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
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail(t('auth.badEmail'), form.email);
    if (password.length < 8) return fail(t('auth.shortPassword'), form.password);
    busy = true;
    form.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      if (mode === 'up') {
        const { needsConfirm } = await signUp(email, password);
        if (needsConfirm) {
          busy = false;
          form.querySelectorAll('button').forEach((b) => (b.disabled = false));
          fail(t('auth.confirmSent', { email }));
          error.classList.remove('form-error');
          error.classList.add('text-[14px]');
          return;
        }
        toast(t('auth.signedUp'));
      } else {
        await signIn(email, password);
        toast(t('auth.signedIn'));
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
        title: t('auth.signOutTitle'),
        message: t('auth.signOutBody'),
        confirmText: t('auth.signOut'),
      });
      if (!ok) return;
      await signOut();
      toast(t('auth.signedOut'));
    }
  });

  $('#backup', root).addEventListener('click', async () => {
    await flushAll().catch(() => {});
    const backup = await exportBackup();
    downloadFile(`vlog-studio-backup_${todayString()}.json`, JSON.stringify(backup, null, 2));
    $('#last-backup', root).textContent = formatTimestamp(Date.now());
    toast(t('settings.backedUp', { n: backup.projectCount }));
  });

  const errors = $('#import-errors', root);
  $('#import', root).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    errors.classList.add('hidden');
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast(t('settings.tooBig'));
      return;
    }
    const result = parseBackup(await file.text());
    if (!result.ok) {
      errors.innerHTML = result.errors.slice(0, 8).map((m) => `<li>${esc(m)}</li>`).join('');
      errors.classList.remove('hidden');
      toast(t('settings.cantRead'), { tone: 'error' });
      return;
    }
    const existing = await listProjects();
    const existingIds = new Set(existing.map((p) => p.id));
    const overlap = result.projects.filter((p) => existingIds.has(p.id)).length;
    const when = result.exportedAt ? formatTimestamp(Date.parse(result.exportedAt)) : t('settings.unknown');
    const mode = await actionSheet({
      title: t('restore.title', { n: result.projects.length, when }),
      actions: [
        { id: 'merge', label: t('restore.merge'), icon: 'copy', hint: overlap ? t('restore.mergeOverlap', { n: overlap }) : t('restore.mergeKeep') },
        { id: 'replace', label: t('restore.replace'), icon: 'archive', danger: true, hint: t('restore.replaceHint', { n: existing.length }) },
      ],
    });
    if (!mode) return;
    const ok = await confirmDialog(
      mode === 'replace'
        ? { title: t('restore.replaceTitle'), message: t('restore.replaceBody', { n: existing.length, m: result.projects.length }), confirmText: t('restore.replace'), danger: true }
        : { title: t('restore.mergeTitle'), message: t('restore.mergeBody', { n: result.projects.length }) + (overlap ? `\n${t('restore.mergeBodyOverlap', { n: overlap })}` : ''), confirmText: t('restore.import'), danger: overlap > 0 },
    );
    if (!ok) return;
    await flushAll().catch(() => {});
    const count = await importProjects(result.projects, mode);
    toast(t('restore.done', { n: count }));
    location.hash = '#/';
  });

  root.addEventListener('click', async (e) => {
    const th = e.target.closest('[data-theme]');
    if (th) {
      setTheme(th.dataset.theme);
      root.querySelectorAll('[data-theme]').forEach((b) => {
        b.classList.toggle('is-active', b === th);
        b.setAttribute('aria-checked', String(b === th));
      });
    }
    const lang = e.target.closest('[data-lang]');
    if (lang && lang.dataset.lang !== getLangPref()) {
      setLangPref(lang.dataset.lang);
      navigate('/settings', { replace: true }); // redraw this screen in the new language
    }
    if (e.target.closest('#persist')) {
      const granted = await navigator.storage?.persist?.().catch(() => false);
      $('#persist-state', root).textContent = granted ? t('settings.persistOn') : t('settings.persistDenied');
      if (granted) e.target.closest('#persist').remove();
    }
  });

  window.scrollTo(0, 0);
  return { kind: 'settings', destroy: unsubscribe };
}
