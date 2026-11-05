/*
 * 小红书 performance data lives in its own IndexedDB database, separate from the planning
 * database ("vlog-studio"). That keeps the planning data's schema untouched (an older app
 * version can still open it) and keeps these device-only records apart from the synced ones.
 * Swapping this module for a cloud backend later only means re-implementing these functions.
 */

const DB_NAME = 'vlog-studio-xhs';
const DB_VERSION = 1;
export const STORES = ['posts', 'income', 'shots', 'meta'];

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

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const getOne = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const putMany = (store, list) => run(store, 'readwrite', (s) => void list.forEach((x) => s.put(x)));
export const deleteOne = (store, id) => run(store, 'readwrite', (s) => void s.delete(id));
export async function getMetaValue(key) {
  return (await getOne('meta', key))?.value;
}
export const setMetaValue = (key, value) => putMany('meta', [{ key, value }]);

/** Replaces the whole contents of the given stores in one transaction (restore / delete-all). */
export const replaceStores = (data) =>
  run(Object.keys(data), 'readwrite', (stores) => {
    Object.keys(data).forEach((name, i) => {
      stores[i].clear();
      data[name].forEach((x) => stores[i].put(x));
    });
  });

export async function closeXhsDB() {
  if (!dbPromise) return;
  (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
}
