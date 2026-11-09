import { afterEach, describe, expect, it } from 'vitest';
import { applyLang } from '../src/i18n/index.js';
import { editingPlan, postFeedback } from '../src/xhs/feedback.js';
import { feedbackHtml } from '../src/views/xhs/feedback.js';
import { insightList } from '../src/views/xhs/insight-text.js';
import { adTimeline, adviceAt, adviceRecord } from '../src/xhs/ad-advice.js';
import { adConclusion, expConclusion } from '../src/xhs/conclusions.js';
import { channelFindings } from '../src/xhs/channels.js';
import { normalizePost } from '../src/xhs/store.js';

const base = { medians: { views: 400, ctr: .16, exit2s: .2, retain5s: .7, avgWatchRatio: .4, completion: .15, interactionRate: .1 } };
const post = (extra = {}) => normalizePost({ id: 'sample', date: '2026-04-12', validity: '유효', d1: { views: 400, ctr: .16, exit2s: .2, retain5s: .7, duration: 100, avgWatch: 40, completion: .15, interactionRate: .1 }, ...extra });
afterEach(() => applyLang('ko'));

describe('evidence to action', () => {
  it('distinguishes missing input, missing baseline, partial data and steady metrics', () => {
    expect(postFeedback(post(), null).status).toBe('baseline');
    expect(postFeedback(post({ d1: {} }), base).status).toBe('metrics');
    expect(postFeedback(post({ d1: { ctr: .16 } }), base).status).toBe('partial');
    expect(postFeedback(post(), base).status).toBe('steady');
  });
  it.each(['광고혼입', '미확인'])('does not direct edits from %s records', (validity) => {
    expect(postFeedback(post({ validity, d1: { ctr: .01 } }), base)).toMatchObject({ status: 'validity', cards: [] });
  });
  it('prioritises cover and opening, deduplicates 2s/5s and limits tasks to two', () => {
    const result = postFeedback(post({ d1: { ctr: .07, exit2s: .4, retain5s: .2, duration: 100, avgWatch: 10, completion: .01 } }), base);
    expect(result.cards.map((x) => x.metric)).toEqual(['ctr', 'exit2s']);
  });
  it.each([['있음', 'introPresent'], ['없음', 'introAbsent'], [undefined, 'introUnknown'], ['custom', 'introUnknown']])('checks intro type %s without assuming footage', (intro, action) => {
    expect(editingPlan('retain5s', post({ experiments: { intro } })).actions).toEqual([action, 'opening']);
  });
  it('treats zero retention as observed data and zero baseline as not comparable', () => {
    expect(postFeedback(post({ d1: { retain5s: 0 } }), base).cards[0].metric).toBe('retain5s');
    expect(postFeedback(post({ d1: { retain5s: 0 } }), { medians: { retain5s: 0 } }).cards).toEqual([]);
  });
  it('uses an opening segment regardless of array order and never repeats platform prose', () => {
    applyLang('ko');
    const p = post({ d1Meta: { segments: [{ from: '00:30', to: '00:40', loss: .1 }, { from: '00:00', to: '00:12', loss: .6, title: 'UNVERIFIED' }] } });
    expect(postFeedback(p, base).cards[0]).toMatchObject({ evidence: 'segment', to: '00:12' });
    expect(feedbackHtml(p, base)).not.toContain('UNVERIFIED');
  });
  it.each(['ko', 'en', 'zh'])('renders labelled actionable feedback and peer context in %s', (lang) => {
    applyLang(lang);
    const p = post({ d1: { ctr: .08 }, d1Meta: { peer: { ctr: { value: .08, median: .06 } } } });
    const html = feedbackHtml(p, base);
    expect(html).toContain('8.0%');
    expect(html).toContain('6.0%');
    expect(html).not.toMatch(/\{\w+\}|fb\.(do|check|status)\./);
    const ops = insightList('ops', [{ key: 'weak.retain5s', metric: 'retain5s', vars: { n: 4, below: 3, now: .3, base: .6, best: 'Sample', bestV: .8 } }]);
    expect(ops).not.toMatch(/\{\w+\}|fb\.(do|check)\./);
  });
});

describe('observational comparisons and missing outcomes', () => {
  const past = [1, 2, 3, 4].map((i) => post({ id: `past${i}`, date: `2026-04-0${i}`, d1: { views: 100, ctr: .16 } }));
  it('withholds ad scores from mixed data', () => {
    expect(adviceAt(post({ validity: '광고혼입' }), past, base).verdict).toBe('unknown');
  });
  it('withholds editing feedback when an ad is recorded despite a valid flag', () => {
    expect(postFeedback(post({ ads: [{ stage: 'D', spend: 25 }] }), base).status).toBe('validity');
  });
  it('does not count posts with missing metric values as three comparisons', () => {
    const blank = past.map((p) => ({ ...p, d1: {} }));
    expect(adviceAt(post(), blank, base).verdict).toBe('unknown');
  });
  it('does not turn all-zero past follower results into a zero-cost estimate', () => {
    const records = past.map((p) => ({ ...p, ads: [{ id: p.id, stage: 'D+2', spend: 25, goal: '关注', start: `${p.date}T10:00`, order: { follows: 0 } }] }));
    expect(adviceAt(post(), records, base).expect).toBeNull();
  });
  it('distinguishes recorded zero followers from missing results', () => {
    const ad = { stage: 'D+1', spend: 25, goal: '关注', start: '2026-04-13T10:00', order: { follows: 0 } };
    expect(adTimeline(post({ ads: [ad] }), past, base).final.outcome).toBe('zero');
    expect(adTimeline(post({ ads: [{ ...ad, order: {} }] }), past, base).final.outcome).toBe('unknown');
  });
  it('does not count unassessable executions as failed advice', () => {
    const rec = { followed: { n: 1, measured: 0, good: 0, cost: null }, against: { n: 8, measured: 0, good: 0, cost: null }, pending: [] };
    expect(adConclusion(rec).map((x) => x.key)).not.toContain('againstCostly');
  });
  it('preserves conflicting experiment metrics', () => {
    const res = ['a', 'b'].map((best, i) => ({ id: 'intro', name: 'Intro', metric: ['exit2s', 'retain5s'][i], groups: [], verdict: { best, worst: best === 'a' ? 'b' : 'a', rel: .2, clear: true, ref: false, mixed: false } }));
    expect(expConclusion(res)[0]).toMatchObject({ kind: 'mixed', vars: { why: 'conflict' } });
  });
  it('does not invent zero reactions for missing channel data', () => {
    const p = post({ d1Meta: { channels: { home: { avgWatch: 24 }, videoRec: { avgWatch: 3 } } } });
    expect(channelFindings(p)[0].vars.reacts).toBe('–');
  });
  it('records missing ad evaluation data separately', () => {
    const p = post({ ads: [{ id: 'ad', stage: 'D+1', spend: 25, goal: '关注' }] });
    expect(adviceRecord([...past, p], base)).toMatchObject({ unmeasured: 1 });
  });
});
