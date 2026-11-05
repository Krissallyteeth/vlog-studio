import { uid } from '../lib/ids.js';
import { getAllMedia, getAllProjects, getMedia, putMedia, deleteMediaRecord } from './db.js';

/*
 * Shot-list photos. Each picked or dropped image is shrunk on the device (longest side 1024 px,
 * WebP ~0.6 quality, JPEG where WebP encoding is unavailable): enough to recognise the shot,
 * usually 40–120 KB. The blob is kept in IndexedDB; the sync engine uploads it and fetches
 * photos added on other devices on demand.
 */

const MAX_SIDE = 1024;
const QUALITY = 0.6;
const GRACE_MS = 60_000; // a photo just added may not be referenced by a saved project yet

let remote = null; // { download(id) -> Blob | null, changed() } set by the sync engine
export const setMediaRemote = (r) => (remote = r);

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    img.src = url;
  });
}

const toBlob = (canvas, type) => new Promise((r) => canvas.toBlob((b) => r(b), type, QUALITY));

/** File -> compressed Blob (image/webp or image/jpeg). EXIF orientation is applied by the browser. */
export async function compressImage(file) {
  const { img, url } = await loadImage(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; // transparent PNGs become white, not black, in JPEG
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    let blob = await toBlob(canvas, 'image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg');
    if (!blob) throw new Error('encode');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Compresses and stores images; resolves with the new media ids (non-images are skipped). */
export async function addPhotos(files) {
  const ids = [];
  for (const file of files) {
    if (!file?.type?.startsWith('image/')) continue;
    try {
      const blob = await compressImage(file);
      const id = uid();
      await putMedia({ id, blob, type: blob.type, createdAt: Date.now(), uploaded: false, deleted: false });
      ids.push(id);
    } catch {
      /* unreadable image (e.g. HEIC on a desktop browser): skipped, the caller reports it */
    }
  }
  if (ids.length) remote?.changed();
  return ids;
}

const urls = new Map(); // id -> object URL (kept for the session; photos are small)
const loading = new Map();

/** Object URL for a photo, downloading it from the sync server when this device doesn't have it yet. */
export function photoUrl(id) {
  if (urls.has(id)) return Promise.resolve(urls.get(id));
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    let rec = await getMedia(id);
    if (!rec?.blob && remote) {
      const blob = await remote.download(id).catch(() => null);
      if (blob) {
        rec = { id, blob, type: blob.type, createdAt: Date.now(), uploaded: true, deleted: false };
        await putMedia(rec);
      }
    }
    if (!rec?.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    urls.set(id, url);
    return url;
  })().finally(() => loading.delete(id));
  loading.set(id, p);
  return p;
}

/**
 * Photos no project references any more (shot, place or project deleted) are marked deleted;
 * the sync engine then removes them from the server and from this device.
 */
export async function collectUnusedMedia(now = Date.now()) {
  const used = new Set((await getAllProjects()).flatMap((p) => p.places.flatMap((pl) => pl.shots.flatMap((s) => s.photos ?? []))));
  const unused = (await getAllMedia()).filter((m) => !m.deleted && !used.has(m.id) && now - m.createdAt > GRACE_MS);
  for (const m of unused) {
    if (m.uploaded) await putMedia({ ...m, blob: null, deleted: true });
    else await deleteMediaRecord(m.id); // never left this device
  }
  if (unused.length) remote?.changed();
  return unused.length;
}
