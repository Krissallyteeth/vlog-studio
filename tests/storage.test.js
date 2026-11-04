import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { flushAll, hasPendingSaves, saveNow, scheduleSave } from '../src/data/autosave.js';
import { closeDB, replaceAllProjects } from '../src/data/db.js';
import {
  createNewProject,
  deleteProject,
  duplicateProject,
  exportBackup,
  getProject,
  importProjects,
  listProjects,
  saveProject,
} from '../src/data/repo.js';
import { normalizePlace, normalizeShot, parseBackup } from '../src/lib/schema.js';
import { sortProjects } from '../src/lib/sort.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await replaceAllProjects([]);
});

describe('IndexedDB repository', () => {
  it('creates a project and keeps it after the connection is reopened (page reload)', async () => {
    const p = await createNewProject({ name: '전주 당일치기 Vlog', startDate: '2026-11-04', endDate: '2026-11-05' });
    await closeDB();
    const loaded = await getProject(p.id);
    expect(loaded).toMatchObject({ name: '전주 당일치기 Vlog', startDate: '2026-11-04', endDate: '2026-11-05' });
  });

  it('keeps default shoot-date order after editing an old project', async () => {
    const old = await createNewProject({ name: '서울 가을 일상', startDate: '2026-10-27' });
    await createNewProject({ name: '홍대 호텔 Vlog', startDate: '2026-10-30' });
    await createNewProject({ name: '전주 당일치기 Vlog', startDate: '2026-11-04' });
    old.plan.theme = '수정함';
    await saveProject(old);
    const list = sortProjects(await listProjects());
    expect(list.map((p) => p.name)).toEqual(['전주 당일치기 Vlog', '홍대 호텔 Vlog', '서울 가을 일상']);
    expect(list[2].updatedAt).toBeGreaterThan(list[0].updatedAt);
  });

  it('same-day projects: the one edited last comes first', async () => {
    const a = await createNewProject({ name: 'A', startDate: '2026-11-04' });
    await createNewProject({ name: 'B', startDate: '2026-11-04' });
    expect(sortProjects(await listProjects()).map((p) => p.name)).toEqual(['B', 'A']);
    await saveProject(a);
    expect(sortProjects(await listProjects()).map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('duplicates into an independent record and deletes', async () => {
    const p = await createNewProject({ name: '원본', startDate: '2026-11-04' });
    p.places.push(normalizePlace({ name: '한옥마을', shots: [normalizeShot({ desc: '전경' })] }));
    await saveProject(p);
    const copy = await duplicateProject(p.id);
    copy.places[0].shots[0].done = true;
    await saveProject(copy);
    expect((await getProject(p.id)).places[0].shots[0].done).toBe(false);
    expect(await listProjects()).toHaveLength(2);
    await deleteProject(p.id);
    expect((await listProjects()).map((x) => x.name)).toEqual(['원본 (복사본)']);
  });

  it('persists route order changes and shot checks', async () => {
    const p = await createNewProject({ name: '동선', startDate: '2026-11-04' });
    p.places.push(normalizePlace({ name: '1번' }), normalizePlace({ name: '2번' }), normalizePlace({ name: '3번' }));
    await saveProject(p);
    [p.places[0], p.places[1]] = [p.places[1], p.places[0]];
    p.places[2].shots.push(normalizeShot({ type: 'detail', desc: '손', done: true }));
    await saveNow(p);
    const loaded = await getProject(p.id);
    expect(loaded.places.map((x) => x.name)).toEqual(['2번', '1번', '3번']);
    expect(loaded.places[2].shots[0]).toMatchObject({ type: 'detail', done: true });
  });

  it('JSON backup → replace restore → merge restore', async () => {
    await createNewProject({ name: '하나', startDate: '2026-11-01' });
    await createNewProject({ name: '둘', startDate: '2026-11-02' });
    const backup = await exportBackup();
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);

    await replaceAllProjects([]);
    await createNewProject({ name: '새 기기', startDate: '2026-11-03' });
    await importProjects(parsed.projects, 'merge');
    expect((await listProjects()).map((p) => p.name).sort()).toEqual(['둘', '새 기기', '하나']);

    await importProjects(parsed.projects, 'replace');
    expect((await listProjects()).map((p) => p.name).sort()).toEqual(['둘', '하나']);
  });
});

describe('autosave', () => {
  it('debounces typing into one write and flushes on demand', async () => {
    const p = await createNewProject({ name: '현장', startDate: '2026-11-04' });
    const before = p.updatedAt;
    p.plan.theme = 'ㄱ';
    scheduleSave(p, 50);
    p.plan.theme = '가을';
    scheduleSave(p, 50);
    expect((await getProject(p.id)).plan.theme).toBe('');
    await wait(120);
    const saved = await getProject(p.id);
    expect(saved.plan.theme).toBe('가을');
    expect(saved.updatedAt).toBeGreaterThan(before);
  });

  it('flushAll writes pending edits immediately (navigation / page hide)', async () => {
    const p = await createNewProject({ name: '현장', startDate: '2026-11-04' });
    p.story.finalLine = '비 덕분에 느려진 하루';
    scheduleSave(p, 60_000);
    expect(hasPendingSaves()).toBe(true);
    await flushAll();
    expect(hasPendingSaves()).toBe(false);
    expect((await getProject(p.id)).story.finalLine).toBe('비 덕분에 느려진 하루');
  });
});
