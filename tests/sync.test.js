import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ackOutbox, getOutbox, queueAll, replaceAllProjects } from '../src/data/db.js';
import { createNewProject, deleteProject, getProject, importProjects, saveProject } from '../src/data/repo.js';
import { createProject } from '../src/lib/schema.js';
import { buildPush, planPull } from '../src/lib/syncMerge.js';

const row = (p, extra = {}) => ({ id: p.id, data: p, updated_at: p.updatedAt, deleted: false, ...extra });

describe('planPull: newest edit wins per project', () => {
  const p = createProject({ name: '전주', startDate: '2026-11-05' }, 1000);

  it('adds projects this device does not have', () => {
    expect(planPull([row(p)], new Map(), new Set()).put.map((x) => x.name)).toEqual(['전주']);
  });

  it('takes a newer server copy and keeps a newer local one', () => {
    const newer = { ...p, name: '전주 (폰에서 수정)', updatedAt: 2000 };
    expect(planPull([row(newer)], new Map([[p.id, 1000]]), new Set()).put[0].name).toBe('전주 (폰에서 수정)');
    expect(planPull([row(p)], new Map([[p.id, 3000]]), new Set())).toEqual({ put: [], remove: [], requeue: [p.id] });
    expect(planPull([row(p)], new Map([[p.id, 1000]]), new Set())).toEqual({ put: [], remove: [], requeue: [] });
  });

  it('applies deletions unless this device edited the project later', () => {
    const del = { id: p.id, data: null, updated_at: 5000, deleted: true };
    expect(planPull([del], new Map([[p.id, 1000]]), new Set()).remove).toEqual([p.id]);
    expect(planPull([del], new Map([[p.id, 6000]]), new Set()).requeue).toEqual([p.id]);
    expect(planPull([del], new Map(), new Set())).toEqual({ put: [], remove: [], requeue: [] });
  });

  it('never overwrites projects with unsent local changes, and skips broken rows', () => {
    const newer = { ...p, updatedAt: 9000 };
    expect(planPull([row(newer)], new Map([[p.id, 1000]]), new Set([p.id])).put).toEqual([]);
    expect(planPull([{ id: 'x', data: null, updated_at: 1, deleted: false }], new Map(), new Set()).put).toEqual([]);
  });

  it('upgrades old-format projects from the server', () => {
    const v1 = { ...p, schemaVersion: 1, type: 'travel' };
    delete v1.types;
    expect(planPull([row(v1)], new Map(), new Set()).put[0].types).toEqual(['travel']);
  });
});

describe('outbox (local changes waiting for upload)', () => {
  beforeEach(async () => {
    await replaceAllProjects([]);
    await ackOutbox(await getOutbox());
  });

  it('queues every save, create and delete', async () => {
    const a = await createNewProject({ name: 'A', startDate: '2026-11-05' });
    const b = await createNewProject({ name: 'B', startDate: '2026-11-05' });
    await deleteProject(b.id);
    const box = Object.fromEntries((await getOutbox()).map((e) => [e.id, e.deleted]));
    expect(box).toEqual({ [a.id]: false, [b.id]: true });

    const rows = buildPush(await getOutbox(), new Map([[a.id, await getProject(a.id)]]));
    expect(rows.find((r) => r.id === a.id)).toMatchObject({ deleted: false, data: { name: 'A' } });
    expect(rows.find((r) => r.id === b.id)).toMatchObject({ deleted: true, data: null });
  });

  it('keeps an entry that was re-queued while an upload was running', async () => {
    const a = await createNewProject({ name: 'A', startDate: '2026-11-05' });
    const sent = await getOutbox();
    a.name = 'A2';
    await saveProject(a); // edited during the upload
    await ackOutbox(sent);
    expect((await getOutbox()).map((e) => e.id)).toEqual([a.id]);
    await ackOutbox(await getOutbox());
    expect(await getOutbox()).toEqual([]);
  });

  it('queues removed projects as deletions on a full restore, and everything on first sign-in', async () => {
    const a = await createNewProject({ name: 'A', startDate: '2026-11-05' });
    await ackOutbox(await getOutbox());
    const restored = createProject({ name: 'R', startDate: '2026-01-01' }, 1);
    await importProjects([restored], 'replace');
    const box = Object.fromEntries((await getOutbox()).map((e) => [e.id, e.deleted]));
    expect(box).toEqual({ [a.id]: true, [restored.id]: false });
    expect((await getProject(restored.id)).updatedAt).toBeGreaterThan(1); // a restore wins over other devices

    await ackOutbox(await getOutbox());
    await queueAll();
    expect((await getOutbox()).map((e) => e.id)).toEqual([restored.id]);
  });
});
