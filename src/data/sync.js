import { SUPABASE_ANON_KEY, SUPABASE_URL, syncConfigured } from '../config.js';
import { buildPush, planPull } from '../lib/syncMerge.js';
import { ackOutbox, applyRemote, deleteMediaRecord, getAllMedia, getAllProjects, getMeta, getOutbox, getProjectRecord, putMedia, putProject, queueAll, setMeta } from './db.js';
import { collectUnusedMedia, setMediaRemote } from './media.js';
import { onLocalChange } from './repo.js';
import { t } from '../i18n/index.js';

/*
 * Device-to-device sync. This device's IndexedDB stays the source the app reads and writes, so
 * everything keeps working offline. When signed in, local changes (the outbox) are uploaded and
 * changes from other devices are pulled in: on start, when the app comes back to the foreground,
 * when the network returns, shortly after each edit, and every 30 s while visible.
 */

const PUSH_DELAY = 1500;
const POLL_MS = 30_000;
const PULL_OVERLAP_MS = 5000; // re-read a little of the past so a slow commit is never skipped
const PAGE = 500;

let client = null;
let user = null;
let running = null;
let again = false;
let pushTimer = null;
let state = { status: syncConfigured() ? 'signed-out' : 'off', email: '', lastSyncedAt: 0, error: '' };
const statusListeners = new Set();
const remoteListeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  statusListeners.forEach((fn) => fn(state));
}
export const getSyncState = () => state;
export function onSyncState(fn) {
  statusListeners.add(fn);
  fn(state);
  return () => statusListeners.delete(fn);
}
/** fn(ids) after projects changed because of another device. */
export function onRemoteChange(fn) {
  remoteListeners.add(fn);
  return () => remoteListeners.delete(fn);
}

// ── Server access (Supabase) ─────────────────────────
// Table + RPC are defined in supabase/schema.sql. push_projects only overwrites older rows.
async function pushRows(rows) {
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await client.rpc('push_projects', { rows: rows.slice(i, i + 50) });
    if (error) throw error;
  }
}

async function pullRows(sinceIso) {
  const out = [];
  let cursor = sinceIso;
  for (;;) {
    let q = client.from('projects').select('id,data,updated_at,deleted,server_updated_at').order('server_updated_at').limit(PAGE);
    if (cursor) q = q.gt('server_updated_at', cursor);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < PAGE) break;
    cursor = data.at(-1).server_updated_at;
  }
  return out;
}

// ── One sync round ───────────────────────────────────
async function round() {
  const outbox = await getOutbox();
  if (outbox.length) {
    const projects = new Map((await getAllProjects()).map((p) => [p.id, p]));
    await pushRows(buildPush(outbox, projects));
    await ackOutbox(outbox);
  }

  const cursorKey = `sync:pulledAt:${user.id}`;
  const last = await getMeta(cursorKey);
  const since = last ? new Date(Date.parse(last) - PULL_OVERLAP_MS).toISOString() : null;
  const rows = await pullRows(since);
  if (rows.length) {
    const local = new Map((await getAllProjects()).map((p) => [p.id, p.updatedAt]));
    const pending = new Set((await getOutbox()).map((e) => e.id));
    const plan = planPull(rows, local, pending);
    if (plan.put.length || plan.remove.length) await applyRemote(plan);
    // This device has the newer copy: queue it again so the next round uploads it.
    for (const id of plan.requeue) {
      const p = await getProjectRecord(id);
      if (p) await putProject(p);
    }
    if (plan.requeue.length) again = true;
    const changedIds = [...plan.put.map((p) => p.id), ...plan.remove];
    await setMeta(cursorKey, rows.at(-1).server_updated_at);
    if (changedIds.length) remoteListeners.forEach((fn) => fn(changedIds));
  }

  await syncMedia();
  // 小红书 performance data (posts, income, settings) — same account, same round.
  const { xhsRound } = await import('../xhs/sync-xhs.js');
  await xhsRound(client, user);
}

// ── Photos (storage bucket "media", one folder per user) ──
const mediaPath = (id) => `${user.id}/${id}`;

async function syncMedia() {
  await collectUnusedMedia();
  for (const m of await getAllMedia()) {
    if (m.deleted) {
      const { error } = await client.storage.from('media').remove([mediaPath(m.id)]);
      if (error) throw error;
      await deleteMediaRecord(m.id);
    } else if (!m.uploaded && m.blob) {
      const { error } = await client.storage.from('media').upload(mediaPath(m.id), m.blob, { contentType: m.type, upsert: true });
      if (error) throw error;
      // Re-read: the record may have changed while uploading.
      const cur = (await getAllMedia()).find((x) => x.id === m.id);
      if (cur && !cur.deleted) await putMedia({ ...cur, uploaded: true });
    }
  }
}

async function downloadMedia(id) {
  if (!user) return null;
  const { data, error } = await client.storage.from('media').download(mediaPath(id));
  return error ? null : data;
}

export function syncNow() {
  if (!user) return Promise.resolve();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setState({ status: 'offline' });
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  setState({ status: 'syncing', error: '' });
  running = (async () => {
    try {
      do {
        again = false;
        await round();
      } while (again);
      setState({ status: 'synced', lastSyncedAt: Date.now() });
    } catch (err) {
      console.error(err);
      setState({ status: 'error', error: err?.message ?? String(err) });
    } finally {
      running = null;
    }
  })();
  return running;
}

function schedulePush() {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, PUSH_DELAY);
}

// ── Account ──────────────────────────────────────────
async function onSignedIn(nextUser) {
  if (user?.id === nextUser.id) return;
  user = nextUser;
  setState({ status: 'syncing', email: user.email ?? '' });
  // First sign-in on this device (or a different account): upload everything that is here.
  if ((await getMeta('sync:userId')) !== user.id) {
    await queueAll();
    // Photos uploaded under another account must be uploaded again into this one.
    for (const m of await getAllMedia()) if (m.uploaded && m.blob) await putMedia({ ...m, uploaded: false });
    await setMeta('sync:userId', user.id);
  }
  syncNow();
}

function onSignedOut() {
  user = null;
  clearTimeout(pushTimer);
  setState({ status: 'signed-out', email: '', lastSyncedAt: 0 });
}

function authError(error) {
  const m = error?.message ?? '';
  if (/invalid login credentials/i.test(m)) return t('auth.err.credentials');
  if (/email not confirmed/i.test(m)) return t('auth.err.unconfirmed');
  if (/already registered/i.test(m)) return t('auth.err.registered');
  if (/password should be at least/i.test(m)) return t('auth.shortPassword');
  if (/signups not allowed/i.test(m)) return t('auth.err.signupsOff');
  if (/rate limit/i.test(m)) return t('auth.err.rateLimit');
  return m || t('auth.err.generic');
}

export async function signIn(email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authError(error));
  await onSignedIn(data.user);
}

/** Resolves { needsConfirm } — true when Supabase sends a confirmation email first. */
export async function signUp(email, password) {
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw new Error(authError(error));
  if (data.session) {
    await onSignedIn(data.user);
    return { needsConfirm: false };
  }
  return { needsConfirm: true };
}

export async function signOut() {
  await syncNow().catch(() => {});
  await client.auth.signOut();
  onSignedOut();
}

// ── Start ────────────────────────────────────────────
let started = false;
export async function initSync() {
  if (started || !syncConfigured()) return;
  started = true;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'vs-auth' },
  });
  client.auth.onAuthStateChange((event, session) => {
    // Supabase calls back inside its own lock; do the work after it returns.
    setTimeout(() => {
      if (session?.user) onSignedIn(session.user);
      else if (event === 'SIGNED_OUT') onSignedOut();
    }, 0);
  });
  const { data } = await client.auth.getSession();
  if (data.session?.user) await onSignedIn(data.session.user);

  onLocalChange(schedulePush);
  import('../xhs/store.js').then((m) => m.onXhsChange(schedulePush));
  setMediaRemote({ download: downloadMedia, changed: schedulePush });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    else if (user) syncNow(); // upload before the app goes to the background
  });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => user && setState({ status: 'offline' }));
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, POLL_MS);
}
