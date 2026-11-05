import { describe, expect, it } from 'vitest';
import { createProject } from '../src/lib/schema.js';
import { filterProjects, sortProjects } from '../src/lib/sort.js';

const make = (name, startDate, updatedAt, createdAt = updatedAt, extra = {}) => ({
  ...createProject({ name, startDate, ...extra }, createdAt),
  updatedAt,
});
const names = (list) => list.map((p) => p.name);

describe('default sort: shoot date, newest first', () => {
  const projects = [
    make('서울 가을 일상', '2026-10-27', 1000),
    make('전주 당일치기 Vlog', '2026-11-04', 500),
    make('홍대 호텔 Vlog', '2026-10-30', 800),
  ];

  it('orders by start date descending', () => {
    expect(names(sortProjects(projects))).toEqual(['전주 당일치기 Vlog', '홍대 호텔 Vlog', '서울 가을 일상']);
  });

  it('editing an old project does not move it to the top', () => {
    const old = projects[0];
    old.updatedAt = 999999; // just edited
    expect(names(sortProjects(projects))[2]).toBe('서울 가을 일상');
    expect(names(sortProjects(projects, 'updatedDesc'))[0]).toBe('서울 가을 일상');
  });

  it('same shoot date → most recently modified first → most recently created first', () => {
    const list = [
      make('A', '2026-11-04', 100, 10),
      make('B', '2026-11-04', 300, 20),
      make('C', '2026-11-04', 300, 30),
      make('D', '2026-11-05', 1, 1),
    ];
    expect(names(sortProjects(list))).toEqual(['D', 'C', 'B', 'A']);
  });

  it('compares dates numerically and puts invalid dates last', () => {
    const list = [make('ok-old', '2025-12-31', 1), make('ok-new', '2026-01-01', 1)];
    list.push({ ...make('broken', '2026-01-01', 5), startDate: '2026-13-40' });
    expect(names(sortProjects(list))).toEqual(['ok-new', 'ok-old', 'broken']);
    expect(names(sortProjects(list, 'shootAsc'))).toEqual(['ok-old', 'ok-new', 'broken']);
  });

  it('does not mutate the input and supports created order', () => {
    const list = [make('first', '2026-01-01', 5, 1), make('second', '2025-01-01', 5, 2)];
    const copy = [...list];
    expect(names(sortProjects(list, 'createdDesc'))).toEqual(['second', 'first']);
    expect(list).toEqual(copy);
  });
});

describe('search and filters', () => {
  const projects = [
    make('전주 당일치기 Vlog', '2026-11-04', 1, 1, { location: '전주 · 한옥마을', status: 'editing', type: 'travel' }),
    make('홍대 호텔 Vlog', '2026-10-30', 1, 1, { location: '서울 · 홍대', status: 'shooting', type: 'travel' }),
    make('원룸 인테리어', '2026-10-01', 1, 1, { location: '집', status: 'editing', type: 'interior' }),
  ];
  projects[2].places = [{ name: '이케아 광명점' }];

  it('matches name, location and route place names', () => {
    expect(names(filterProjects(projects, { query: 'vlog' }))).toHaveLength(2);
    expect(names(filterProjects(projects, { query: '한옥' }))).toEqual(['전주 당일치기 Vlog']);
    expect(names(filterProjects(projects, { query: '이케아' }))).toEqual(['원룸 인테리어']);
    expect(names(filterProjects(projects, { query: '서울 홍대' }))).toEqual(['홍대 호텔 Vlog']);
  });

  it('matches a project by any of its types, including custom ones', () => {
    const both = make('전주 미식 여행', '2026-11-04', 1, 1, { types: ['travel', 'lifestyle'], customTypes: ['맛집'] });
    const list = [both, make('원룸', '2026-10-01', 1, 1, { types: ['interior'] })];
    expect(names(filterProjects(list, { type: 'travel' }))).toEqual(['전주 미식 여행']);
    expect(names(filterProjects(list, { type: 'lifestyle' }))).toEqual(['전주 미식 여행']);
    expect(names(filterProjects(list, { type: 'custom:맛집' }))).toEqual(['전주 미식 여행']);
    expect(names(filterProjects(list, { type: 'custom:캠핑' }))).toEqual([]);
  });

  it('combines status, type and search', () => {
    expect(names(filterProjects(projects, { status: 'editing' }))).toHaveLength(2);
    expect(names(filterProjects(projects, { status: 'editing', type: 'interior' }))).toEqual(['원룸 인테리어']);
    expect(filterProjects(projects, { status: 'editing', query: '홍대' })).toEqual([]);
  });
});
