import { afterEach, describe, expect, it } from 'vitest';
import { applyLang } from '../src/i18n/index.js';
import { postAdContext } from '../src/xhs/ad-sim.js';
import { postFunnel } from '../src/xhs/funnel.js';
import { applies, calibrate, learnAds, learnEdit, learnFunnel, learnModel, recentMedian, signature, spearman } from '../src/xhs/learning.js';
import { normalizePost } from '../src/xhs/store.js';
import { learningCardHtml } from '../src/views/xhs/learning.js';

// Fictional numbers only.
afterEach(() => applyLang('ko'));

let n = 0;
const usual = { exposure: 1000, views: 100, ctr: 0.1, exit2s: 0.3, retain5s: 0.5, duration: 60, avgWatch: 24, completion: 0.2, interactionRate: 0.08, favorites: 4, shares: 2, newFollowers: 2 };
const mk = (d1, extra = {}) => {
  n += 1;
  return normalizePost({ id: `p${n}`, date: `2026-02-${String(n).padStart(2, '0')}`, validity: '유효', d1: { ...usual, ...d1 }, ...extra });
};

describe('spearman', () => {
  it('ranks, with ties', () => {
    expect(spearman([[1, 10], [2, 20], [3, 30]])).toBeCloseTo(1);
    expect(spearman([[1, 30], [2, 20], [3, 10]])).toBeCloseTo(-1);
    expect(spearman([[1, 1], [1, 2]])).toBeNull();
    expect(spearman([[1, 5], [1, 5], [1, 5]])).toBeNull();
  });
});

describe('learnFunnel', () => {
  // On this made-up account the 5-second retention moves with followers; the click rate does not.
  const posts = Array.from({ length: 10 }, (_, i) => mk({ retain5s: 0.3 + i * 0.03, newFollowers: 1 + i, ctr: [0.1, 0.12, 0.09, 0.11, 0.1, 0.12, 0.09, 0.11, 0.1, 0.12][i] }));
  it('becomes active from 8 posts and puts the step that moves with followers first', () => {
    const m = learnFunnel(posts);
    expect(m.status).toBe('active');
    expect(m.order[0]).toBe('opening');
    expect(m.steps.find((s) => s.step === 'opening').weight).toBeGreaterThan(0.4); // shrunk from 1
  });
  it('stays learning with fewer posts', () => {
    expect(learnFunnel(posts.slice(0, 5))).toMatchObject({ status: 'learning', n: 5, need: 8 });
  });
  it('reorders weak steps only when active and not locked', () => {
    const baseline = { version: 1, size: 10, postIds: posts.map((p) => p.id), medians: { exposure: 1000, views: 100, ctr: 0.1, exit2s: 0.3, retain5s: 0.5, avgWatchRatio: 0.4, completion: 0.2, interactionRate: 0.08 } };
    const post = mk({ ctr: 0.05, retain5s: 0.2 });
    const all = [...posts, post];
    expect(postFunnel(post, all, baseline).checks.map((c) => c.step)).toEqual(['click', 'opening']);
    const model = learnModel(all, baseline);
    expect(postFunnel(post, all, baseline, 'd1', model)).toMatchObject({ learned: true });
    expect(postFunnel(post, all, baseline, 'd1', model).checks.map((c) => c.step)).toEqual(['opening', 'click']);
    const locked = learnModel(all, baseline, { locked: { funnel: true } });
    expect(applies(locked, 'funnel')).toBe(false);
    expect(postFunnel(post, all, baseline, 'd1', locked).checks.map((c) => c.step)).toEqual(['click', 'opening']);
  });
});

describe('learnEdit', () => {
  it('counts whether the next post improved the checked step', () => {
    const posts = [mk({}), mk({}), mk({}), mk({ ctr: 0.05 }), mk({ ctr: 0.07 }), mk({ ctr: 0.04 }), mk({ ctr: 0.09 })];
    const baseline = { version: 1, size: 3, postIds: posts.slice(0, 3).map((p) => p.id), medians: { exposure: 1000, views: 100, ctr: 0.1, exit2s: 0.3, retain5s: 0.5, avgWatchRatio: 0.4, completion: 0.2, interactionRate: 0.08 } };
    const m = learnEdit(posts, baseline);
    // click flagged on 0.05 → next 0.07 (better), 0.07 → 0.04 (worse), 0.04 → 0.09 (better)
    expect(m.steps.click).toMatchObject({ n: 3, improved: 2, verdict: 'helps' });
    expect(m.status).toBe('active');
    expect(learnEdit(posts, null).n).toBe(0);
  });
});

describe('learnAds', () => {
  const order = (date, est, result) => ({ id: `a${++n}`, orderNo: `T${n}`, stage: 'D+1', start: `${date}T20:00`, goal: '关注', spend: 40, estimate: est, goalResult: result, order: { follows: result } });
  const posts = [mk({}, { ads: [order('2026-03-01', [10, 30], 30)] }), mk({}, { ads: [order('2026-03-03', [10, 30], 20)] }), mk({}, { ads: [order('2026-03-05', [10, 30], 40)] })];
  it('learns how results run against the platform middle and adjusts ranges', () => {
    const m = learnAds(posts);
    expect(m).toMatchObject({ status: 'active', n: 3, ratio: 1.5, recency: true });
    const model = learnModel(posts, null);
    expect(calibrate(model, [4, 12])).toEqual([6, 18]);
    expect(calibrate(learnModel(posts, null, { locked: { ads: true } }), [4, 12])).toBeNull();
  });
  it('adds the adjusted range to the quote comments', () => {
    const post = mk({}, { adQuotes: [{ stage: 'D+1', capturedAt: '2026-03-10T18:00:00+08:00', estimate: [4, 12], pay: 40 }] });
    const all = [...posts, post];
    const ctx = postAdContext(post, all, null, learnModel(all, null));
    expect(ctx.comments.find((c) => c.key === 'quoteCalibrated')).toMatchObject({ vars: { alo: 6, ahi: 18, r: 150 } });
  });
});

describe('recentMedian', () => {
  it('leans to the newest values', () => {
    expect(recentMedian([1, 1, 1, 9, 9], 1)).toBe(9);
    expect(recentMedian([1, 2, 3], 1000)).toBe(2);
    expect(recentMedian([])).toBeNull();
  });
});

describe('learning card', () => {
  it.each(['ko', 'en', 'zh'])('renders without raw keys in %s', (lang) => {
    applyLang(lang);
    const model = learnModel([mk({}), mk({})], null, { locked: { ads: true } });
    const log = [{ at: '2026-03-01T10:00:00+08:00', area: 'funnel', from: 'click>opening', to: 'opening>click' }, { at: '2026-03-01T10:00:00+08:00', area: 'edit', from: '', to: 'click:helps' }, { at: '2026-03-01T10:00:00+08:00', area: 'ads', from: '1.2', to: '1.5' }];
    const html = learningCardHtml(model, log);
    expect(html).not.toMatch(/\b(lr|fn)\.[a-z]/);
    expect(html).toContain('data-lr-lock="funnel"');
    expect(signature(model)).toEqual({ funnel: '', edit: '', ads: '' });
  });
});
