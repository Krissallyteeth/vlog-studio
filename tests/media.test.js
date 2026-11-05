import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteMediaRecord, getAllMedia, putMedia, replaceAllProjects } from '../src/data/db.js';
import { collectUnusedMedia } from '../src/data/media.js';
import { createNewProject, saveProject } from '../src/data/repo.js';
import { MAX_PHOTOS, cloneProject, normalizePlace, normalizeShot } from '../src/lib/schema.js';

const media = (id, extra = {}) => ({ id, blob: new Blob(['x']), type: 'image/webp', createdAt: 0, uploaded: false, deleted: false, ...extra });

describe('shot photos in the project data', () => {
  it('keeps only valid photo ids, at most MAX_PHOTOS', () => {
    const ids = Array.from({ length: MAX_PHOTOS + 3 }, (_, i) => `photo-${String(i).padStart(4, '0')}`);
    const s = normalizeShot({ photos: [...ids, 42, '../etc', ''] });
    expect(s.photos).toHaveLength(MAX_PHOTOS);
    expect(s.photos.every((x) => x.startsWith('photo-'))).toBe(true);
    expect(normalizeShot({}).photos).toEqual([]);
  });

  it('a duplicated project points to the same photos', () => {
    const place = normalizePlace({ name: 'a' });
    place.shots.push(normalizeShot({ photos: ['photo-0001'] }));
    const copy = cloneProject({ ...normalizePlace(), id: 'p', name: 'x', places: [place], logs: [], scenes: [], plan: { highlights: [] } });
    expect(copy.places[0].shots[0].photos).toEqual(['photo-0001']);
  });
});

describe('collectUnusedMedia', () => {
  beforeEach(async () => {
    await replaceAllProjects([]);
    for (const m of await getAllMedia()) await deleteMediaRecord(m.id);
  });

  it('keeps used and just-added photos, drops local-only orphans, marks uploaded orphans for server deletion', async () => {
    const p = await createNewProject({ name: 'A', startDate: '2026-11-05' });
    const place = normalizePlace({ name: 'x' });
    place.shots.push(normalizeShot({ photos: ['used-photo-1'] }));
    p.places.push(place);
    await saveProject(p);
    const now = 10 * 60_000;
    await putMedia(media('used-photo-1'));
    await putMedia(media('orphan-local'));
    await putMedia(media('orphan-uploaded', { uploaded: true }));
    await putMedia(media('just-added', { createdAt: now - 1000 }));

    expect(await collectUnusedMedia(now)).toBe(2);
    const byId = Object.fromEntries((await getAllMedia()).map((m) => [m.id, m]));
    expect(Object.keys(byId).sort()).toEqual(['just-added', 'orphan-uploaded', 'used-photo-1']);
    expect(byId['orphan-uploaded']).toMatchObject({ deleted: true, blob: null });
    expect(byId['used-photo-1'].deleted).toBe(false);
  });
});
