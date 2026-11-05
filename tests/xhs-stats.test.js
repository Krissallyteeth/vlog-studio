import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { computeStage } from '../src/xhs/metrics.js';
import { buildBaseline, criteria, improvement, judge, median, relDiff, trendOf, validBefore, validSeq } from '../src/xhs/stats.js';
import { activeBaseline, listPosts, savePosts } from '../src/xhs/store.js';

// Synthetic posts only — no real account data in the repository.
const post = (i, extra = {}) => ({
  id: `p${i}`,
  no: i,
  title: `T${i}`,
  date: `2026-01-${String(i).padStart(2, '0')}`,
  time: '19:20',
  validity: '유효',
  d1: { exposure: 100 * i, views: 10 * i, ctr: i / 100, exit2s: 0.3 - i / 100, newFollowers: i % 2 },
  ...extra,
});

describe('excel-compatible statistics', () => {
  it('median ignores blanks like Excel MEDIAN', () => {
    expect(median([3, null, 1, undefined, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null])).toBeNull();
  });

  it('reproduces the sheet formulas for total interaction and average watch ratio', () => {
    const s = computeStage({ views: 100, likes: 5, comments: 1, danmaku: 50, favorites: 2, shares: 1, newFollowers: 1, duration: 200, avgWatch: 50 });
    expect(s.totalInteraction).toBeCloseTo(0.1); // 弹幕 excluded
    expect(s.avgWatchRatio).toBeCloseTo(0.25);
    expect(computeStage({ views: 0, likes: 1 }).totalInteraction).toBeNull(); // IFERROR → blank
    expect(computeStage({ avgWatch: 30 }, 120).avgWatchRatio).toBeCloseTo(0.25); // D+2 uses D+1 duration
    expect(computeStage({ views: 100 }).totalInteraction).toBeNull(); // nothing entered → blank, not 0%
    expect(computeStage({ views: 100, likes: 0 }).totalInteraction).toBe(0); // a real 0 stays 0
  });

  it('colours with strict outer bounds, inclusive band, and reversed 2秒退出率', () => {
    expect(judge('views', 121, 100, '유효')).toBe('good');
    expect(judge('views', 120, 100, '유효')).toBe('mid');
    expect(judge('views', 80, 100, '유효')).toBe('mid');
    expect(judge('views', 79, 100, '유효')).toBe('bad');
    expect(judge('ctr', 0.111, 0.1, '유효')).toBe('good');
    expect(judge('exit2s', 0.2, 0.25, '유효')).toBe('good');
    expect(judge('exit2s', 0.3, 0.25, '유효')).toBe('bad');
    expect(judge('views', 500, 100, '광고혼입')).toBe('good'); // reference colour
    expect(judge('views', 500, 100, '미확인')).toBeNull();
    expect(judge('newFollowers', 1, 0, '유효')).toBe('good');
    expect(judge('newFollowers', 1, 0, '광고혼입')).toBeNull();
  });

  it('never divides by a zero median', () => {
    expect(relDiff(3, 0)).toBeNull();
    expect(improvement(0, 5, 1)).toBeNull();
    expect(trendOf(null)).toBe('sample');
    expect(improvement(0.2, 0.25, -1)).toBeCloseTo(-0.25);
  });

  it('keeps the first-11 baseline fixed and moves recent-5 with new posts; ad-mixed posts are excluded', () => {
    const posts = Array.from({ length: 11 }, (_, i) => post(i + 1));
    posts.push(post(12, { validity: '광고혼입', d1: { views: 9999 } }));
    const base = buildBaseline(posts);
    expect(base.postIds).toHaveLength(11);
    expect(base.medians.views).toBe(60);
    let c = criteria(posts, base);
    expect(c.validCount).toBe(11);
    expect(c.adMixedCount).toBe(1);
    expect(c.rows.find((r) => r.key === 'views').recent).toBe(90); // posts 7..11
    posts.push(post(13, { d1: { views: 500 } }));
    c = criteria(posts, base);
    expect(c.rows.find((r) => r.key === 'views').recent).toBe(100); // posts 8..11,13
    expect(c.rows.find((r) => r.key === 'views').fixed).toBe(60); // unchanged
    expect(validSeq(posts).get('p12')).toBeUndefined();
    expect(validBefore(posts, posts.at(-1)).map((p) => p.id)).not.toContain('p12');
  });
});

describe('store', () => {
  it('creates baseline Version 1 once 11 valid posts exist and keeps it when more arrive', async () => {
    await savePosts(Array.from({ length: 10 }, (_, i) => post(i + 1)));
    expect(await activeBaseline()).toBeNull();
    await savePosts([post(11)]);
    const v1 = await activeBaseline();
    expect(v1.version).toBe(1);
    await savePosts([post(13, { d1: { views: 1 } })]);
    expect((await activeBaseline()).medians.views).toBe(v1.medians.views);
    expect((await listPosts()).find((p) => p.id === 'p1').d1.likes).toBeNull(); // blank stays blank
  });
});
