import { describe, expect, it } from 'vitest';
import { normalizePost } from '../src/xhs/store.js';
import { adInsights, opsBrief, postFocus } from '../src/xhs/insights.js';

// Synthetic posts: D+1 views and an ad (关注 goal) with a report.
const P = (i, views, ad, extra = {}) =>
  normalizePost({ id: `p${i}`, no: i, title: `T${i}`, date: `2026-03-${String(i).padStart(2, '0')}`, validity: '유효', followers: 1000 + i * 10, d1: { views, exposure: views * 8, ctr: 0.12, exit2s: 0.25, retain5s: 0.55, completion: 0.07 }, ads: ad ? [{ stage: 'D+2', spend: 60, goal: '关注', start: `2026-03-${String(i + 2).padStart(2, '0')}T10:00`, order: { reads: 200, follows: ad, profileViews: ad * 3 } }] : [], ...extra });
const base = { version: 1, medians: { views: 300, exposure: 2400, ctr: 0.13, exit2s: 0.25, retain5s: 0.56, avgWatchRatio: 0.22, completion: 0.07, interactionRate: 0.1 } };

describe('adaptive insights', () => {
  it('posts with strong D+1 views get cheaper followers; the cut is the median of my own views', () => {
    const posts = [P(1, 500, 30), P(2, 450, 25), P(3, 100, 6), P(4, 120, 5)];
    const ins = adInsights(posts).find((x) => x.key === 'naturalCut');
    expect(ins.vars).toMatchObject({ highWins: true, cut: 285, cheap: 2.18, dear: 10.91 });
    expect(ins.ref).toBe(true); // two orders per side: shown as a reference
  });
  it('the sentence turns when the data turns', () => {
    const posts = [P(1, 500, 5), P(2, 450, 6), P(3, 100, 30), P(4, 120, 25)];
    expect(adInsights(posts).find((x) => x.key === 'naturalCut').vars.highWins).toBe(false);
  });
  it('says nothing with one order per side', () => {
    expect(adInsights([P(1, 500, 30), P(2, 100, 6)]).find((x) => x.key === 'naturalCut')).toBeUndefined();
  });
});

describe('what to fix', () => {
  it('a post: the earliest weak funnel step, my top posts as the target, the views it cost', () => {
    const posts = [P(1, 600), P(2, 500), P(3, 400), P(4, 200, null, {})];
    posts[0].d1.ctr = 0.18;
    posts[1].d1.ctr = 0.17;
    posts[2].d1.ctr = 0.16;
    posts[3].d1.ctr = 0.07;
    const f = postFocus(posts[3], posts, base);
    expect(f.items[0]).toMatchObject({ key: 'focus.ctr', vars: { pct: 46, top: 0.17, gain: 96 } });
  });
  it('the briefing names the step most recent posts miss, with my best post as the example', () => {
    const posts = [1, 2, 3, 4, 5, 6].map((i) => P(i, 200));
    posts.forEach((p, i) => (p.d1.ctr = i === 0 ? 0.2 : 0.08));
    const b = opsBrief(posts, base, { today: '2026-03-08' });
    expect(b.map((x) => x.key).slice(0, 2)).toEqual(['recentDown', 'weak.ctr']);
    expect(b[1].vars).toMatchObject({ below: 5, n: 5, best: 'T1' });
  });
});
