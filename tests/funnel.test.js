import { afterEach, describe, expect, it } from 'vitest';
import { applyLang } from '../src/i18n/index.js';
import { funnelReference, postFunnel } from '../src/xhs/funnel.js';
import { normalizePost } from '../src/xhs/store.js';
import { funnelHtml } from '../src/views/xhs/funnel.js';

// Fictional numbers only.
afterEach(() => applyLang('ko'));

const usual = { exposure: 1000, views: 100, ctr: 0.1, exit2s: 0.3, retain5s: 0.5, duration: 60, avgWatch: 24, completion: 0.2, interactionRate: 0.08, likes: 5, favorites: 4, shares: 2, comments: 1, newFollowers: 2 };
const mk = (id, d1 = usual, extra = {}) => normalizePost({ id, date: '2026-01-01', validity: '유효', d1, d2: { ...d1, views: (d1.views ?? 0) * 2 }, ...extra });
const refPosts = ['a', 'b', 'c'].map((id) => mk(id));
const baseline = { version: 1, size: 3, postIds: refPosts.map((p) => p.id), medians: { exposure: 1000, views: 100, ctr: 0.1, exit2s: 0.3, retain5s: 0.5, avgWatchRatio: 0.4, completion: 0.2, interactionRate: 0.08 } };
const run = (post, which = 'd1') => postFunnel(post, [...refPosts, post], baseline, which);

describe('reference', () => {
  it('uses the stored D+1 medians and computes per-view rates from the same posts', () => {
    const ref = funnelReference(refPosts, baseline, 'd1');
    expect(ref.medians.ctr).toBe(0.1);
    expect(ref.medians.saveRate).toBe(0.04);
    expect(ref.medians.followRate).toBe(0.02);
  });
  it('compares D+2 with the baseline posts\' D+2 values', () => {
    const ref = funnelReference(refPosts, baseline, 'd2');
    expect(ref.medians.followRate).toBe(0.01); // 2 followers over 200 D+2 views
    expect(ref.counts.followRate).toBe(3);
  });
});

describe('postFunnel', () => {
  it('needs a reference and some values', () => {
    expect(postFunnel(mk('x'), refPosts, null).status).toBe('baseline');
    expect(run(mk('x', {})).status).toBe('metrics');
  });

  it('shows but does not judge posts with ads before the cut or not valid', () => {
    const ad = run(mk('x', { ...usual, ctr: 0.01 }, { ads: [{ stage: 'D', spend: 30 }] }));
    expect(ad.status).toBe('mixed');
    expect(ad.checks).toEqual([]);
    expect(run(mk('y', usual, { validity: '광고혼입' })).status).toBe('mixed');
  });

  it('finds the first two weak steps from the top and marks lower steps as reference', () => {
    const f = run(mk('x', { ...usual, ctr: 0.05, avgWatch: 10, newFollowers: 0 }));
    expect(f.status).toBe('checks');
    expect(f.checks.map((c) => c.step)).toEqual(['click', 'depth']);
    const step = (k) => f.steps.find((s) => s.key === k);
    expect(step('traffic').reference).toBe(false);
    expect(step('opening').reference).toBe(true);
    expect(step('depth')).toMatchObject({ bottleneck: true, reference: false });
    expect(step('follow').state).toBe('weak');
    expect(step('follow').bottleneck).toBe(false); // a third weak step is not a task
  });

  it('points at follow when only the follow rate is weak', () => {
    const f = run(mk('x', { ...usual, newFollowers: 1 }));
    expect(f.checks).toMatchObject([{ step: 'follow', actions: ['follow'] }]);
  });

  it('judges a real 0 but leaves blanks out', () => {
    const zero = run(mk('x', { ...usual, retain5s: 0 }));
    expect(zero.checks[0].step).toBe('opening');
    const blank = run(mk('y', { ...usual, exposure: null, ctr: null }));
    expect(blank.steps.find((s) => s.key === 'traffic').state).toBe('missing');
    expect(blank.missing).toEqual(['traffic', 'click']);
    expect(blank.status).toBe('partial');
  });

  it('uses the intro record for opening checks and adds an opening segment', () => {
    const f = run(mk('x', { ...usual, exit2s: 0.5 }, { experiments: { intro: '있음' } }));
    expect(f.checks[0].actions).toEqual(['introPresent', 'opening']);
    const seg = run(mk('y', usual, { d1Meta: { segments: [{ from: '00:00', to: '00:08', loss: 0.6 }] } }));
    expect(seg.checks).toMatchObject([{ step: 'opening', evidence: 'segment', to: '00:08' }]);
  });

  it('says how much came from search', () => {
    expect(run(mk('x', usual, { d1Meta: { sources: { search: 0.32, home: 0.5 } } })).searchShare).toBe(0.32);
  });
});

describe('funnel card text', () => {
  it.each(['ko', 'en', 'zh'])('renders every step without raw keys in %s', (lang) => {
    applyLang(lang);
    const html = funnelHtml(mk('x', { ...usual, ctr: 0.05, newFollowers: 0 }, { d1Meta: { sources: { search: 0.2 } } }), [...refPosts], baseline, 'd1');
    expect(html).not.toMatch(/\b(fn|fb)\.[a-z]/);
    expect(html).toContain('data-funnel="d2"');
  });
  it('labels missing values as not collected, never 0', () => {
    applyLang('ko');
    const html = funnelHtml(mk('x', { ...usual, shares: null }), refPosts, baseline, 'd1');
    expect(html).toContain('공유율(分享÷观看)</span> <b class="tabular-nums">미수집');
  });
});
