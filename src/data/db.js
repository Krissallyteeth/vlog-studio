const DB_NAME = 'vlog-studio';
// Bump only when adding stores or indexes. Upgrades must never delete stores,
// so data written by older app versions survives every deploy.
const DB_VERSION = 1;

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

async function run(storeName, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('저장이 취소되었어요.'));
    const req = work(tx.objectStore(storeName));
    if (req) req.onsuccess = () => (result = req.result);
  });
}

export const getAllProjects = () => run('projects', 'readonly', (s) => s.getAll());
export const getProjectRecord = (id) => run('projects', 'readonly', (s) => s.get(id));
export const putProject = (p) => run('projects', 'readwrite', (s) => void s.put(p));
export const deleteProjectRecord = (id) => run('projects', 'readwrite', (s) => void s.delete(id));
export const putProjects = (list) => run('projects', 'readwrite', (s) => void list.forEach((p) => s.put(p)));

/** Clear + insert in one transaction: a failed restore leaves the old data untouched. */
export const replaceAllProjects = (list) =>
  run('projects', 'readwrite', (s) => {
    s.clear();
    list.forEach((p) => s.put(p));
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
