import { now } from '../lib/ids.js';

/*
 * 小红书 performance data lives in its own IndexedDB database, separate from the planning
 * database ("vlog-studio"), so the planning schema stays untouched (older app versions can still
 * open it). Every local write of a post / income record / setting also records an outbox entry in
 * the same transaction; the sync engine uploads those when signed in (xhs/sync-xhs.js).
 * Screenshots ("shots") stay on the device and are never queued.
 */

const DB_NAME = 'vlog-studio-xhs';
const DB_VERSION = 2; // v2: outbox
export const STORES = ['posts', 'income', 'shots', 'meta'];
const KIND = { posts: 'post', income: 'income', meta: 'meta' };
/** Meta keys starting with "local:" are device-only (sync cursors, markers). */
export const isLocalKey = (key) => String(key).startsWith('local:');

let dbPromise = null;

export function openXhsDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
      }
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function run(names, mode, work) {
  const db = await openXhsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([names].flat(), mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    const stores = [names].flat().map((n) => tx.objectStore(n));
    const req = work(Array.isArray(names) ? stores : stores[0]);
    if (req) req.onsuccess = () => (result = req.result);
  });
}

const idOf = (store, rec) => (store === 'meta' ? rec.key : rec.id);
const queued = (store, id) => KIND[store] && !(store === 'meta' && isLocalKey(id));
const entry = (store, id, deleted, at) => ({ key: `${KIND[store]}:${id}`, kind: KIND[store], id, deleted, at });

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const getOne = (store, id) => run(store, 'readonly', (s) => s.get(id));

/** Local write: records + outbox entries in one transaction. */
export const putMany = (store, list) =>
  run(KIND[store] ? [store, 'outbox'] : store, 'readwrite', (stores) => {
    const [s, o] = Array.isArray(stores) ? stores : [stores];
    const at = now();
    for (const x of list) {
      s.put(x);
      if (o && queued(store, idOf(store, x))) o.put(entry(store, idOf(store, x), false, at));
    }
  });

export const deleteOne = (store, id) =>
  run(KIND[store] ? [store, 'outbox'] : store, 'readwrite', (stores) => {
    const [s, o] = Array.isArray(stores) ? stores : [stores];
    s.delete(id);
    if (o && queued(store, id)) o.put(entry(store, id, true, now()));
  });

export async function getMetaValue(key) {
  return (await getOne('meta', key))?.value;
}
export const setMetaValue = (key, value) => putMany('meta', [{ key, value, updatedAt: Date.now() }]);

/** Replaces whole stores (restore / delete-all); removed records are queued as deletions. */
export const replaceStores = (data) => {
  const names = Object.keys(data);
  const synced = names.filter((n) => KIND[n]);
  return run([...names, ...(synced.length ? ['outbox'] : [])], 'readwrite', (stores) => {
    const o = synced.length ? stores.at(-1) : null;
    const at = now();
    names.forEach((name, i) => {
      const s = stores[i];
      const keep = new Set(data[name].map((x) => idOf(name, x)));
      const fill = () => {
        s.clear();
        for (const x of data[name]) {
          s.put(x);
          if (o && queued(name, idOf(name, x))) o.put(entry(name, idOf(name, x), false, at));
        }
      };
      if (!o || !KIND[name]) return fill();
      s.getAllKeys().onsuccess = (e) => {
        for (const id of e.target.result) if (!keep.has(id) && queued(name, id)) o.put(entry(name, id, true, at));
        fill();
      };
    });
  });
};

// ── Sync helpers (used by xhs/sync-xhs.js only) ──────────
export const getOutbox = () => run('outbox', 'readonly', (s) => s.getAll());
/** Removes uploaded entries, but keeps any re-queued (newer `at`) while the upload ran. */
export const ackOutbox = (entries) =>
  run('outbox', 'readwrite', (o) => {
    for (const en of entries) {
      o.get(en.key).onsuccess = (e) => {
        if (e.target.result?.at === en.at) o.delete(en.key);
      };
    }
  });
/** Queues every synced record (first sign-in on this device). */
export const queueAllXhs = () =>
  run(['posts', 'income', 'meta', 'outbox'], 'readwrite', ([p, i, m, o]) => {
    const at = now();
    p.getAllKeys().onsuccess = (e) => e.target.result.forEach((id) => o.put(entry('posts', id, false, at)));
    i.getAllKeys().onsuccess = (e) => e.target.result.forEach((id) => o.put(entry('income', id, false, at)));
    m.getAllKeys().onsuccess = (e) => e.target.result.filter((k) => !isLocalKey(k)).forEach((id) => o.put(entry('meta', id, false, at)));
  });
/** Changes that came from the server: written WITHOUT queueing them back. */
export const applyRemoteXhs = ({ put = {}, remove = {} }) => {
  const names = [...new Set([...Object.keys(put), ...Object.keys(remove)])];
  if (!names.length) return Promise.resolve();
  return run(names, 'readwrite', (stores) => {
    names.forEach((n, i) => {
      for (const x of put[n] ?? []) stores[i].put(x);
      for (const id of remove[n] ?? []) stores[i].delete(id);
    });
  });
};

export async function closeXhsDB() {
  if (!dbPromise) return;
  (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
}
