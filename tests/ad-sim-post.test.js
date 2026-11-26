import { afterEach, describe, expect, it } from 'vitest';
import { applyLang } from '../src/i18n/index.js';
import { postAdContext } from '../src/xhs/ad-sim.js';
import { normalizePost } from '../src/xhs/store.js';
import { adSimHtml } from '../src/views/xhs/ad-sim.js';

// Fictional numbers only.
afterEach(() => applyLang('ko'));

let n = 0;
const d1 = (views, extra = {}) => ({ views, exposure: views * 10, ctr: 0.1, exit2s: 0.3, retain5s: 0.5, duration: 60, avgWatch: 24, completion: 0.2, interactionRate: 0.08, favorites: 4, shares: 2, newFollowers: 2, ...extra });
// An order starts on D+2, so it never mixes into the D+1 views of its own post.
const withAd = (date, views, spend, follows) => normalizePost({ id: `p${++n}`, date, validity: '유효', d1: d1(views), ads: [{ id: `a${n}`, orderNo: `T${n}`, stage: 'D+2', start: `${date.slice(0, 8)}${String(Number(date.slice(8)) + 2).padStart(2, '0')}T20:00`, goal: '关注', spend, order: { follows } }] });
const plain = (date, views) => normalizePost({ id: `p${++n}`, date, validity: '유효', d1: d1(views) });

// Posts with high D+1 views got cheap followers (40元 → 20), low ones dear (40元 → 4).
const history = [withAd('2026-01-01', 300, 40, 20), withAd('2026-01-03', 320, 40, 20), withAd('2026-01-05', 80, 40, 4), withAd('2026-01-07', 90, 40, 4), plain('2026-01-09', 200)];
const baseline = { version: 1, size: 5, postIds: history.map((p) => p.id), medians: { exposure: 2000, views: 200, ctr: 0.1, exit2s: 0.3, retain5s: 0.5, avgWatchRatio: 0.4, completion: 0.2, interactionRate: 0.08 } };

describe('postAdContext', () => {
  it('uses orders on posts like this one (same side of my median views)', () => {
    const post = plain('2026-01-20', 400);
    const ctx = postAdContext(post, [...history, post], baseline);
    expect(ctx.which).toBe('d1');
    expect(ctx.similar).toMatchObject({ n: 2, high: true, cost: { median: 2 } });
    expect(ctx.history.rate.median).toBe(0.5);
    expect(ctx.comments.find((c) => c.key === 'similarCheap')).toBeTruthy(); // 2元 vs all 6元
  });

  it('warns that followers cost more on low-view posts', () => {
    const post = plain('2026-01-20', 50);
    const ctx = postAdContext(post, [...history, post], baseline);
    expect(ctx.similar).toMatchObject({ high: false, cost: { median: 10 } });
    expect(ctx.comments[0].key).toBe('similarDear');
  });

  it('compares the platform quote with my usual cost and my simulator', () => {
    const post = normalizePost({ ...plain('2026-01-20', 400), adQuotes: [{ stage: 'D+1', capturedAt: '2026-01-21T18:00:00+08:00', estimate: [4, 12], pay: 40 }] });
    const keys = postAdContext(post, [...history, post], baseline).comments.map((c) => c.key);
    // 40元 / 8 = 5元 per follower vs 2元 on similar posts; my records say 20 for 40元.
    expect(keys).toContain('quoteDear');
    expect(keys).toContain('quoteCautious');
  });

  it('flags a weak click or opening and needs views to say anything', () => {
    const post = normalizePost({ id: 'w', date: '2026-01-20', validity: '유효', d1: d1(400, { ctr: 0.05 }) });
    expect(postAdContext(post, [...history, post], baseline).comments.map((c) => c.key)).toContain('funnelWeak');
    expect(postAdContext(normalizePost({ id: 'e', date: '2026-01-20' }), history, baseline)).toMatchObject({ which: null, comments: [] });
  });

  it('falls back to all orders with fewer than 2 similar ones', () => {
    const post = plain('2026-01-20', 400);
    const ctx = postAdContext(post, [history[0], history[2], history[3], history[4], post], baseline);
    expect(ctx.similar).toBeNull();
    expect(ctx.comments[0]).toMatchObject({ key: 'similarFew', vars: { min: 2 } });
  });
});

describe('card on a post', () => {
  it.each(['ko', 'en', 'zh'])('renders the comments without raw keys in %s', (lang) => {
    applyLang(lang);
    const post = normalizePost({ ...plain('2026-01-20', 400), adQuotes: [{ stage: 'D+1', capturedAt: '2026-01-21T18:00:00+08:00', estimate: [4, 12], pay: 40 }] });
    const html = adSimHtml([...history, post], { post, baseline });
    expect(html).toContain('id="sim-comment"');
    expect(html).not.toMatch(/\b(sim|adv|fn)\.[a-z]/);
  });
});
