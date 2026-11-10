import { describe, expect, it } from 'vitest';
import { adComment } from '../src/xhs/ad-comment.js';
import { normalizePost } from '../src/xhs/store.js';

// Synthetic posts and 薯条 orders (made-up numbers).
let n = 0;
const order = (goal, start, spend, report, extra = {}) => ({ id: `a${++n}`, orderNo: `o${n}`, stage: 'D+1', executed: true, goal, start, spend, order: report, ...extra });
const post = (id, date, ads) => normalizePost({ id, title: id, date, validity: '유효', d1: { views: 300 }, ads });

describe('ad comment', () => {
  const past = [
    post('p1', '2026-09-01', [order('点赞收藏量', '2026-09-02T10:00', 60, { reads: 100, likes: 30, favorites: 10, follows: 1 })]),
    post('p2', '2026-09-10', [order('点赞收藏量', '2026-09-11T10:00', 60, { reads: 120, likes: 25, favorites: 5, follows: 0 })]),
    post('p3', '2026-09-20', [order('关注', '2026-09-21T10:00', 60, { reads: 200, follows: 20 })]),
    post('p4', '2026-10-01', [order('关注', '2026-10-02T10:00', 60, { reads: 180, follows: 15 })]),
  ];

  it('compares the result with the estimate and the price with earlier orders of the same goal', () => {
    const ad = order('点赞收藏量', '2026-11-09T22:56', 60, { reads: 124, likes: 44, favorites: 7, follows: 2 }, { goalResult: 51, estimate: [11, 41] });
    const all = [...past, post('now', '2026-11-06', [ad])];
    const items = adComment(all.at(-1).ads[0], all);
    expect(items.map((x) => x.key)).toEqual(['aboveEst', 'unitCheaper', 'followsSide']);
    expect(items[0].vars).toMatchObject({ r: 51, over: 10 });
    // 60/51 = 1.18 vs median of 60/40 = 1.5 and 60/30 = 2 → 1.75
    expect(items[1].vars).toMatchObject({ cost: 1.18, usual: 1.75, n: 2 });
    expect(items[1].ref).toBe(true); // under 3 orders: a reference
    // followers: 60/2 = 30 each vs 关注 orders 3 and 4 → median 3.5
    expect(items[2].vars).toMatchObject({ f: 2, per: 30, followUsual: 3.5 });
  });

  it('only uses orders started before this one, and says when there are too few', () => {
    const ad = order('关注', '2026-09-25T10:00', 50, { reads: 150, follows: 10 });
    const all = [...past, post('now', '2026-09-24', [ad])];
    const items = adComment(all.at(-1).ads[0], all);
    expect(items.map((x) => x.key)).toEqual(['fewSame']); // only one 关注 order before 09-25
    expect(items[0].vars).toMatchObject({ what: 'follow', cost: 5, n: 1 });
  });

  it('says nothing for an ad without a report', () => {
    const ad = order('关注', '2026-11-01T10:00', 60, {});
    expect(adComment(ad, [...past, post('x', '2026-10-31', [ad])])).toEqual([]);
  });
});
