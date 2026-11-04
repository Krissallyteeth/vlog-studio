import { describe, expect, it } from 'vitest';
import { projectToMarkdown } from '../src/lib/markdown.js';
import { formatDuration, projectProgress, shotStats, totalSeconds } from '../src/lib/progress.js';
import {
  SCHEMA_VERSION,
  buildBackup,
  cloneProject,
  createProject,
  normalizeLog,
  normalizePlace,
  normalizeScene,
  normalizeShot,
  parseBackup,
} from '../src/lib/schema.js';

function sample() {
  const p = createProject({ name: '전주 당일치기 Vlog', startDate: '2026-11-04', endDate: '2026-11-05', location: '전주 · 한옥마을' });
  p.plan.theme = '느린 하루';
  p.plan.direction = '골목을 천천히 걸으며 기록해 본다';
  p.plan.highlights.push({ id: 'h1', text: '경기전 대나무 숲' });
  p.plan.values = ['emotion', 'aesthetic'];
  const place = normalizePlace({ name: '한옥마을', date: '2026-11-04', time: '10:00' });
  place.shots.push(normalizeShot({ type: 'env', desc: '골목 전경', done: true }), normalizeShot({ type: 'reaction', desc: '첫 입' }));
  p.places.push(place);
  const log = normalizeLog({ placeId: place.id, placeName: place.name, feeling: '여유', surprise: '작은 책방' });
  p.logs.push(log);
  p.story.finalLine = '비 덕분에 더 느려진 하루';
  p.story.noTwist = true;
  p.scenes.push(
    normalizeScene({ title: '오프닝', link: `log:${log.id}`, seconds: 12, highlight: true }),
    normalizeScene({ title: '골목', link: `place:${place.id}`, seconds: 45 }),
  );
  return p;
}

describe('project schema', () => {
  it('creates projects with ids, timestamps, version and defaults', () => {
    const p = createProject({ name: '  테스트 ', startDate: '2026-11-04' }, 1234);
    expect(p.id).toBeTruthy();
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p).toMatchObject({ name: '테스트', createdAt: 1234, updatedAt: 1234, status: 'planning', target: { min: 120, max: 180 } });
  });

  it('drops an end date that is before the start date', () => {
    expect(createProject({ name: 'x', startDate: '2026-11-04', endDate: '2026-11-01' }).endDate).toBe('');
  });

  it('keeps pre-shoot direction and post-shoot final line as separate fields', () => {
    const p = sample();
    expect(p.plan.direction).not.toBe(p.story.finalLine);
  });
});

describe('duplicate', () => {
  it('creates new ids everywhere and remaps internal links', () => {
    const src = sample();
    const copy = cloneProject(src, 99);
    expect(copy.id).not.toBe(src.id);
    expect(copy.name).toBe('전주 당일치기 Vlog (복사본)');
    expect(copy.places[0].id).not.toBe(src.places[0].id);
    expect(copy.places[0].shots[0].id).not.toBe(src.places[0].shots[0].id);
    expect(copy.logs[0].placeId).toBe(copy.places[0].id);
    expect(copy.scenes[0].link).toBe(`log:${copy.logs[0].id}`);
    expect(copy.scenes[1].link).toBe(`place:${copy.places[0].id}`);
    expect(copy.createdAt).toBe(99);
  });

  it('is fully independent of the original', () => {
    const src = sample();
    const copy = cloneProject(src);
    copy.places[0].shots[0].done = false;
    copy.plan.values.push('fun');
    expect(src.places[0].shots[0].done).toBe(true);
    expect(src.plan.values).toEqual(['emotion', 'aesthetic']);
  });
});

describe('backup validation', () => {
  it('round-trips a backup', () => {
    const p = sample();
    const result = parseBackup(JSON.stringify(buildBackup([p])));
    expect(result.ok).toBe(true);
    expect(result.projects[0]).toEqual(p);
  });

  it('rejects broken JSON, foreign files and newer schema versions', () => {
    expect(parseBackup('{oops').ok).toBe(false);
    expect(parseBackup('[]').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ projects: [] })).errors[0]).toMatch(/Vlog Studio/);
    expect(parseBackup(JSON.stringify({ app: 'vlog-studio', schemaVersion: 99, projects: [] })).errors[0]).toMatch(/새로운 버전/);
    expect(parseBackup(JSON.stringify({ app: 'vlog-studio', schemaVersion: 1 })).ok).toBe(false);
  });

  it('reports invalid projects instead of importing them', () => {
    const good = sample();
    const data = buildBackup([good, { ...good, id: 'x2', startDate: '2026-02-30' }, { ...good, id: 'x3', name: '' }, { ...good }]);
    const result = parseBackup(JSON.stringify(data));
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.join('\n')).toMatch(/촬영 시작일/);
    expect(result.errors.join('\n')).toMatch(/프로젝트명/);
    expect(result.errors.join('\n')).toMatch(/중복/);
  });

  it('fills missing fields from partial (older) records', () => {
    const result = parseBackup(JSON.stringify({ app: 'vlog-studio', schemaVersion: 1, projects: [{ id: 'a', name: '최소', startDate: '2026-01-01' }] }));
    expect(result.ok).toBe(true);
    expect(result.projects[0].places).toEqual([]);
    expect(result.projects[0].story.finalLine).toBe('');
  });
});

describe('progress and durations', () => {
  it('computes shot completion and total scene length', () => {
    const p = sample();
    expect(shotStats(p.places[0])).toEqual({ done: 1, total: 2, pct: 50 });
    expect(totalSeconds(p.scenes)).toBe(57);
    expect(formatDuration(57)).toBe('0:57');
    expect(formatDuration(150)).toBe('2:30');
    expect(projectProgress(createProject({ name: 'x', startDate: '2026-01-01' }))).toBe(0);
    expect(projectProgress(p)).toBeGreaterThan(50);
  });
});

describe('markdown export', () => {
  it('contains every section in a readable order', () => {
    const md = projectToMarkdown(sample());
    const order = ['# 전주 당일치기 Vlog', '2026.11.04 – 11.05', '전주 · 한옥마을', '느린 하루', '골목을 천천히 걸으며 기록해 본다',
      '## 2. 실제 동선', '- [x] 环境镜头', '- [ ] 反应镜头', '## 3. 현장 기록', '작은 책방', '최종', '비 덕분에 더 느려진 하루',
      '감정 흐름', '반전 없음', '## 5. 편집 장면 구성', '0:57', '1. 오프닝 (12초) ★ 하이라이트'];
    let pos = -1;
    for (const s of order.filter((x) => x !== '최종')) {
      const next = md.indexOf(s, pos + 1);
      expect(next, `missing or out of order: ${s}`).toBeGreaterThan(pos);
      pos = next;
    }
  });
});
