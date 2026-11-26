import { afterEach, describe, expect, it } from 'vitest';
import { applyLang } from '../src/i18n/index.js';
import { followHistory, simulate } from '../src/xhs/ad-sim.js';
import { normalizePost } from '../src/xhs/store.js';
import { adSimHtml } from '../src/views/xhs/ad-sim.js';

// Fictional orders only.
afterEach(() => applyLang('ko'));

let n = 0;
const ad = (spend, follows, extra = {}) => ({ id: `a${++n}`, orderNo: `T${n}`, stage: 'D+1', goal: '关注', spend, order: { follows }, ...extra });
const post = (ads) => normalizePost({ id: `p${++n}`, date: '2026-01-01', validity: '유효', ads });

describe('followHistory', () => {
  it('uses only 关注 orders with spend and a follower result, credit counted as delivered money', () => {
    const posts = [post([ad(40, 20), ad(30, 10, { credit: 10 })]), post([ad(50, 0), ad(30, 30, { goal: '点赞收藏量' }), ad(null, 5), { ...ad(0, 0), pending: true }])];
    const h = followHistory(posts);
    expect(h.n).toBe(3);
    expect(h.zeroFollow).toBe(1);
    expect(h.rate).toEqual({ min: 0, median: 0.25, max: 0.5 }); // 0/50, 10/40, 20/40
    expect(h.cost).toEqual({ min: 2, median: 2.5, max: 3 }); // real spend only: 40/20, 30/10
    expect(h.reference).toBe(false);
  });
  it('marks fewer than 3 orders as reference', () => {
    expect(followHistory([post([ad(40, 20)])]).reference).toBe(true);
  });
});

describe('simulate', () => {
  const h = followHistory([post([ad(40, 20), ad(30, 10, { credit: 10 }), ad(50, 5)])]);
  it('multiplies the past rates by spend + credit and prices followers on real spend', () => {
    const r = simulate(h, { spend: 60, credit: 20 });
    expect(r.total).toBe(80);
    expect(r.creditShare).toBe(0.25);
    expect(r.followers).toEqual({ min: 8, median: 20, max: 40 }); // rates 0.1 · 0.25 · 0.5
    expect(r.realCost).toEqual({ best: 1.5, median: 3, worst: 7.5 });
    expect(r.perTotal).toBe(4);
  });
  it('needs a positive amount and history', () => {
    expect(simulate(h, { spend: 0 })).toBeNull();
    expect(simulate(followHistory([]), { spend: 50 })).toBeNull();
  });
});

describe('card', () => {
  it.each(['ko', 'en', 'zh'])('renders without raw keys in %s', (lang) => {
    applyLang(lang);
    expect(adSimHtml([post([ad(40, 20), ad(30, 10)])])).not.toMatch(/\bsim\.[a-z]/);
    expect(adSimHtml([])).not.toMatch(/\bsim\.[a-z]/);
  });
});
