import { now } from '../lib/ids.js';

const DB_NAME = 'vlog-studio';
// Bump only when adding stores or indexes. Upgrades must never delete stores,
// so data written by older app versions survives every deploy.
const DB_VERSION = 2;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('이 브라우저는 IndexedDB를 지원하지 않아요.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      // Reserved for future voice memo / photo blobs referenced from log.attachments.
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      // v2: local changes not yet uploaded to the sync server. { id, deleted, at } — one row per project.
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab opened a newer version: let it upgrade, reopen on next access.
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

/** One transaction over one or more stores; `work` gets the store (or an array of stores for several names). */
async function run(storeNames, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const names = [storeNames].flat();
    const tx = db.transaction(names, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('저장이 취소되었어요.'));
    const stores = names.map((n) => tx.objectStore(n));
    const req = work(Array.isArray(storeNames) ? stores : stores[0]);
    if (req) req.onsuccess = () => (result = req.result);
  });
}

export const getAllProjects = () => run('projects', 'readonly', (s) => s.getAll());
export const getProjectRecord = (id) => run('projects', 'readonly', (s) => s.get(id));

// Local edits: the project write and its outbox entry land in the same transaction,
// so a change can never be saved without also being queued for upload.
const queued = (p, at) => ({ id: p.id, deleted: false, at });
export const putProject = (p, at = now()) =>
  run(['projects', 'outbox'], 'readwrite', ([s, o]) => {
    s.put(p);
    o.put(queued(p, at));
  });
export const putProjects = (list, at = now()) =>
  run(['projects', 'outbox'], 'readwrite', ([s, o]) => {
    list.forEach((p) => {
      s.put(p);
      o.put(queued(p, at));
    });
  });
export const deleteProjectRecord = (id, at = now()) =>
  run(['projects', 'outbox'], 'readwrite', ([s, o]) => {
    s.delete(id);
    o.put({ id, deleted: true, at });
  });

/** Clear + insert in one transaction: a failed restore leaves the old data untouched. Removed projects are queued as deletions. */
export const replaceAllProjects = (list, at = now()) =>
  run(['projects', 'outbox'], 'readwrite', ([s, o]) => {
    const keep = new Set(list.map((p) => p.id));
    s.getAllKeys().onsuccess = (e) => {
      e.target.result.filter((id) => !keep.has(id)).forEach((id) => o.put({ id, deleted: true, at }));
      s.clear();
      list.forEach((p) => {
        s.put(p);
        o.put(queued(p, at));
      });
    };
  });

// Changes that came FROM the sync server: written without queueing them back.
export const applyRemote = ({ put = [], remove = [] }) =>
  run('projects', 'readwrite', (s) => {
    put.forEach((p) => s.put(p));
    remove.forEach((id) => s.delete(id));
  });

export const getOutbox = () => run('outbox', 'readonly', (s) => s.getAll());
export const queueAll = (at = now()) =>
  run(['projects', 'outbox'], 'readwrite', ([s, o]) => {
    s.getAllKeys().onsuccess = (e) => e.target.result.forEach((id) => o.put({ id, deleted: false, at }));
  });
/** Removes uploaded entries, but keeps any that were re-queued (newer `at`) while the upload was running. */
export const ackOutbox = (entries) =>
  run('outbox', 'readwrite', (o) => {
    entries.forEach((entry) => {
      o.get(entry.id).onsuccess = (e) => {
        if (e.target.result?.at === entry.at) o.delete(entry.id);
      };
    });
  });

export async function getMeta(key) {
  const row = await run('meta', 'readonly', (s) => s.get(key));
  return row?.value;
}
export const setMeta = (key, value) => run('meta', 'readwrite', (s) => void s.put({ key, value }));

export async function closeDB() {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}
