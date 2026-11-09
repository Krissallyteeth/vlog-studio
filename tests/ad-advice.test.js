import { describe, expect, it } from 'vitest';
import { normalizePost } from '../src/xhs/store.js';
import { adTimeline, adviceAt } from '../src/xhs/ad-advice.js';

const base = { medians: { ctr: 0.13 } };
const P = (i, views, ad) =>
  normalizePost({ id: `p${i}`, title: `T${i}`, date: `2026-03-${String(i * 2).padStart(2, '0')}`, validity: '유효', d1: { views, ctr: 0.13 }, ads: ad ? [{ stage: 'D+1', spend: 60, goal: '关注', start: `2026-03-${String(i * 2 + 1).padStart(2, '0')}T10:00`, order: { reads: 200, follows: ad } }] : [] });

describe('ad advice, with only what was known then', () => {
  const posts = [P(1, 500, 30), P(2, 450, 25), P(3, 100, 6), P(4, 120, 5), P(5, 520), P(6, 90, 4)];
  it('a post above my usual D+1 views, where follower ads were cheap, is a go', () => {
    const a = adviceAt(posts[4], posts, base, 'd1');
    expect(a.verdict).toBe('go');
    expect(a.expect).toMatchObject({ cost: 2.18, n: 2 });
  });
  it('later posts are not used to judge an earlier one', () => {
    expect(adviceAt(posts[1], posts, base, 'd1').verdict).toBe('unknown'); // only one post before it
  });
  it('describes higher actual cost without proving that the advice was right', () => {
    const tl = adTimeline(posts[5], posts, base, { today: '2026-04-01' });
    expect(tl.d1.verdict).toBe('skip');
    expect(tl.final).toMatchObject({ key: 'against', outcome: 'bad' });
  });
});
