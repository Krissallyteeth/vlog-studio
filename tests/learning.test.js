import { afterEach, describe, expect, it } from 'vitest';
import { applyLang } from '../src/i18n/index.js';
import { postAdContext } from '../src/xhs/ad-sim.js';
import { postFunnel } from '../src/xhs/funnel.js';
import { applies, calibrate, learnAds, learnAdvice, learnBaseline, learnEdit, learnFactors, learnFunnel, learnModel, learnTitles, recentMedian, signature, spearman, timeSlot } from '../src/xhs/learning.js';
import { adviceAt } from '../src/xhs/ad-advice.js';
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
    expect(signature(model)).toEqual({ funnel: '', edit: '', ads: '', advice: '', factors: '', baseline: '', titles: '' });
  });
});

describe('learnAdvice', () => {
  const day = (i) => `2026-04-${String(i).padStart(2, '0')}`;
  const base = [1, 2, 3, 4].map((i) => normalizePost({ id: `b${i}`, date: day(i), validity: '유효', d1: { ...usual, views: 100 } }));
  // Ads on D+1: high-view posts got cheap followers, low-view posts dear ones.
  const adPost = (i, views, follows) => normalizePost({ id: `a${i}`, date: day(i), validity: '유효', d1: { ...usual, views }, ads: [{ id: `ad${i}`, orderNo: `O${i}`, stage: 'D+1', start: `${day(i + 1)}T20:00`, goal: '关注', spend: 40, order: { follows } }] });
  const posts = [...base, adPost(6, 200, 20), adPost(8, 200, 20), adPost(10, 50, 10), adPost(12, 200, 20), adPost(14, 50, 10), adPost(16, 200, 20)];
  it('counts how often each signal pointed the right way and turns it into a weight', () => {
    const m = learnAdvice(posts, null);
    expect(m.n).toBe(5); // the first ad has no earlier price to compare with
    expect(m.status).toBe('active');
    expect(m.signals.views).toMatchObject({ n: 5, right: 5, weight: 1.5 });
  });
  it('scales the advice score by the learned weights, only when active and not locked', () => {
    const post = normalizePost({ id: 'x', date: day(20), validity: '유효', d1: { ...usual, views: 400 } });
    const all = [...posts, post];
    expect(adviceAt(post, all, null, 'd1').verdict).toBe('go');
    const weak = { advice: { status: 'active', locked: false, weights: { views: 0.25 } } };
    expect(adviceAt(post, all, null, 'd1', weak)).toMatchObject({ verdict: 'hold', weighted: true });
    expect(adviceAt(post, all, null, 'd1', { advice: { ...weak.advice, locked: true } }).verdict).toBe('go');
  });
});

describe('learnFactors', () => {
  const mkType = (i, type, followers, time) => normalizePost({ id: `f${i}`, date: `2026-05-${String(i).padStart(2, '0')}`, time, validity: '유효', contentType: type, d1: { ...usual, views: 100, newFollowers: followers } });
  const posts = [
    ...[1, 2, 3, 4, 5].map((i) => mkType(i, '인테리어', 5, '19:30')),
    ...[6, 7, 8, 9, 10].map((i) => mkType(i, '여행', 1, '08:00')),
    mkType(11, '위스키', 9, '12:00'),
  ];
  it('ranks factors by the difference between their groups (3+ posts each)', () => {
    const m = learnFactors(posts, { experiments: [] });
    expect(m.status).toBe('active');
    const top = m.results.find((r) => r.factor === 'type' && r.outcome === 'followRate');
    expect(top.best).toMatchObject({ level: '인테리어', n: 5, median: 0.05 });
    expect(top.worst.level).toBe('여행');
    expect(top.groups.map((g) => g.level)).not.toContain('위스키'); // 1 post: not compared
  });
  it('needs 10 valid posts', () => {
    expect(learnFactors(posts.slice(0, 6)).status).toBe('learning');
  });
  it('puts posting times into slots', () => {
    expect([timeSlot('07:10'), timeSlot('12:00'), timeSlot('19:30'), timeSlot('23:00'), timeSlot('')]).toEqual(['morning', 'day', 'evening', 'night', null]);
  });
});

describe('learnBaseline', () => {
  const mkB = (i, d1) => normalizePost({ id: `g${i}`, date: `2026-06-${String(i).padStart(2, '0')}`, validity: '유효', d1: { ...usual, ...d1 } });
  const first = Array.from({ length: 11 }, (_, i) => mkB(i + 1, {}));
  const baseline = { version: 1, size: 11, postIds: first.map((p) => p.id), medians: { views: 100, ctr: 0.1, exit2s: 0.3, retain5s: 0.5 } };
  it('waits for 11 valid posts after the baseline', () => {
    expect(learnBaseline([...first, mkB(12, { views: 300 })], baseline)).toMatchObject({ status: 'learning', n: 1 });
  });
  it('suggests a new baseline when 2+ core metrics moved the same way (last 11 and last 5)', () => {
    const later = Array.from({ length: 11 }, (_, i) => mkB(12 + i, { views: 300, ctr: 0.15 }));
    const m = learnBaseline([...first, ...later], baseline);
    expect(m.status).toBe('active');
    expect(m.shifted).toEqual(['views', 'ctr']);
  });
  it('holds when results stay near the baseline', () => {
    const later = Array.from({ length: 11 }, (_, i) => mkB(12 + i, { views: 105 }));
    expect(learnBaseline([...first, ...later], baseline)).toMatchObject({ status: 'steady', shifted: [] });
    expect(learnBaseline(first, null).status).toBe('learning');
  });
});

describe('learnTitles and the brief', () => {
  const mkT = (i, title, ctr) => normalizePost({ id: `t${i}`, date: `2026-07-${String(i).padStart(2, '0')}`, title, validity: '유효', d1: { ...usual, ctr } });
  const posts = [
    ...[1, 2, 3, 4, 5].map((i) => mkT(i, `${i}个收纳方法`, 0.15)),
    ...[6, 7, 8, 9, 10].map((i) => mkT(i, '我的新家日常', 0.08)),
  ];
  it('compares click rates by title traits (3+ titles each side)', () => {
    const m = learnTitles(posts);
    expect(m.status).toBe('active');
    expect(m.traits[0]).toMatchObject({ key: 'digits', with: { n: 5, ctr: 0.15 }, without: { n: 5, ctr: 0.08 } });
    expect(learnTitles(posts.slice(0, 6)).status).toBe('learning');
  });
  it('adds my title patterns to the Claude brief', async () => {
    const { buildBrief, parseEvidence, analyzeEvidence, SEARCH_SCHEMA } = await import('../src/xhs/search-evidence.js');
    const ev = parseEvidence({ schema: SEARCH_SCHEMA, collectedAt: '2026-01-01T10:00:00+08:00', keywords: [{ keyword: '收纳', status: 'ok' }], notes: [] });
    const brief = buildBrief(ev, analyzeEvidence(ev), { myTitles: learnTitles(posts).traits });
    expect(brief).toContain('[내 계정 제목 패턴]');
    expect(brief).toContain('숫자가 들어간 제목: 15.0%(5편) vs 아닌 제목 8.0%(5편)');
    expect(buildBrief(ev, analyzeEvidence(ev))).not.toContain('[내 계정 제목 패턴]');
  });
});
