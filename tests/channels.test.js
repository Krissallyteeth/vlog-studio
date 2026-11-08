import { describe, expect, it } from 'vitest';
import { channelBlocks, noteExtras } from '../src/xhs/ocr-note.js';
import { channelBrief, channelFindings } from '../src/xhs/channels.js';
import { adConclusion, expConclusion, opsConclusion } from '../src/xhs/conclusions.js';
import { adInWindow } from '../src/xhs/ad-report.js';
import { normalizePost } from '../src/xhs/store.js';

// OCR words: [text, x0] on one line (y is the line's order).
const line = (y, ...ws) => ({ words: ws.map(([text, x0]) => ({ text, confidence: 95, bbox: { x0, y0: y, x1: x0 + 40, y1: y + 30 } })) });
const block = (share, { exp, views, watch, likes, comments, favs, conv, inter }) => [
  line(100, ['首页推荐', 190], [`${share.home}%`, 415]),
  line(110, ['视频推荐', 190], [`${share.vr}%`, 415]),
  line(1100, ['此渠道详细数据', 134]),
  ...(conv != null ? [line(1200, [`转化率${conv}%`, 345])] : []),
  line(1300, [`互动率${inter}%`, 345]),
  line(1400, ['曝光数', 162], [String(exp), 425], ['观看数', 626], [String(views), 891]),
  line(1500, ['占总曝光', 165], ['50%', 425], ['占总观看', 631], [`${share.cur}%`, 891]),
  line(1600, ['平均观看时长', 161], ['点赞', 627]),
  line(1700, [String(watch), 161], [String(likes), 627]),
  line(1800, ['评论', 161], ['收藏', 628]),
  line(1900, [String(comments), 161], ['smear103', 416], ...(favs != null ? [[String(favs), 628]] : [])),
];

describe('channel detail OCR', () => {
  it('reads a block and leaves out a value not under its label', () => {
    const [b] = channelBlocks([block({ home: 60, vr: 30, cur: 60 }, { exp: 1000, views: 100, watch: 30.2, likes: 8, comments: 1, conv: 10, inter: 9.4 })]);
    expect(b).toMatchObject({ conv: 0.1, interactionRate: 0.094, exposure: 1000, views: 100, shareViews: 0.6, avgWatch: 30.2, likes: 8, comments: 1 });
    expect(b.favs).toBeUndefined();
  });
  it('places each block on its channel by the share of views', () => {
    const x = noteExtras(
      [block({ home: 60, vr: 30, cur: 60 }, { exp: 1000, views: 100, watch: 30, likes: 8, comments: 1, conv: 10, inter: 9 }), block({ home: 60, vr: 30, cur: 30 }, { exp: 50, views: 50, watch: 5.5, likes: 0, comments: 0, favs: 0, inter: 0 })],
      { year: 2026 },
    );
    expect(x.channels.home.avgWatch).toBe(30);
    expect(x.channels.videoRec).toMatchObject({ avgWatch: 5.5, views: 50, favs: 0 });
    expect(x.channels.videoRec.conv).toBeUndefined(); // plays without a cover: no click rate
  });
});

const post = (id, date, views, extra = {}) => normalizePost({ id, title: id, date, validity: '유효', d1: { views }, ...extra });
const meta = (vrWatch, homeWatch, conv, search = 0.05) => ({ sources: { home: 0.6, videoRec: 0.3, search }, channels: { home: { avgWatch: homeWatch, conv }, videoRec: { avgWatch: vrWatch, likes: 0 } } });

describe('channel detail OCR repairs', () => {
  it('reads "531%" back as 53.1% when that is a listed share', () => {
    const x = noteExtras([block({ home: 53.1, vr: 40.4, cur: '531' }, { exp: 1912, views: 189, watch: 29.2, likes: 12, comments: 1, conv: 9.9, inter: 9 })], { year: 2026 });
    expect(x.channels.home).toMatchObject({ shareViews: 0.531, views: 189, avgWatch: 29.2 });
  });
  it('fills a missing count from the interaction rate (互动数 = 点赞+评论+收藏)', () => {
    const [b] = channelBlocks([block({ home: 53.1, vr: 40.4, cur: 53.1 }, { exp: 1912, views: 189, watch: 29.2, likes: 12, comments: 1, conv: 9.9, inter: 9 })]);
    expect(b).toMatchObject({ favs: 4, derived: ['favs'] });
  });
  it('corrects one doubtful count that breaks the sum', () => {
    const lines = block({ home: 53.1, vr: 40.4, cur: 40.4 }, { exp: 144, views: 144, watch: 7.6, likes: 1, comments: 0, favs: 3, inter: 1.4 });
    lines.at(-1).words.find((w) => w.text === '3').confidence = 63;
    const [b] = channelBlocks([lines]);
    expect(b).toMatchObject({ likes: 1, comments: 0, favs: 1, derived: ['favs'] });
  });
  it('does not collect the search channel', () => {
    const x = noteExtras([block({ home: 53.1, vr: 40.4, cur: 4.2 }, { exp: 100, views: 30, watch: 20, likes: 1, comments: 0, conv: 30, inter: 3 }), [line(120, ['搜索', 190], ['4.2%', 415])]], { year: 2026 });
    expect(x.channels?.search).toBeUndefined();
  });
});

describe('channel findings', () => {
  it('flags an opening that loses 视频推荐 against the same post’s home feed', () => {
    const p = post('a', '2026-11-06', 283, { d1Meta: meta(5.5, 30, 0.1) });
    expect(channelFindings(p, [p]).map((x) => x.key)).toEqual(['vrShort']);
  });
  it('compares with my own past posts once there are two', () => {
    const past = [post('p1', '2026-10-01', 300, { d1Meta: meta(12, 25, 0.12, 0.1) }), post('p2', '2026-10-05', 300, { d1Meta: meta(14, 26, 0.14, 0.1) })];
    const p = post('a', '2026-11-06', 283, { d1Meta: meta(6, 10, 0.09, 0.02) });
    const keys = channelFindings(p, [...past, p]).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['vrBelowMine', 'homeConvLow', 'searchLow']));
  });
  it('relates the 视频推荐 share to views over posts', () => {
    const m = (vr) => ({ sources: { videoRec: vr } });
    const posts = [post('a', '2026-10-01', 600, { d1Meta: m(0.5) }), post('b', '2026-10-02', 500, { d1Meta: m(0.45) }), post('c', '2026-10-03', 200, { d1Meta: m(0.1) }), post('d', '2026-10-04', 250, { d1Meta: m(0.15) })];
    expect(channelBrief(posts).map((x) => x.key)).toEqual(['mixVr']);
  });
});

describe('ads in a stage window', () => {
  it('counts only ads started before the stage’s cut, and the natural rest of the views', () => {
    const p = normalizePost({ id: 'a', date: '2026-10-01', d1: { views: 300 }, d2: { views: 700, newFollowers: 20 }, ads: [{ stage: 'D+1', start: '2026-10-02T10:00', spend: 60, executed: true, order: { reads: 200, follows: 12 } }] });
    expect(adInWindow(p, 'd1').any).toBe(false);
    expect(adInWindow(p, 'd2')).toMatchObject({ any: true, reads: 200, naturalViews: 500, naturalFollowers: 8 });
  });
});

describe('conclusions', () => {
  const rec = (followed, against, pending = []) => ({ followed, against, notRun: 0, pending });
  it('says to skip ads against the advice when those mostly cost more', () => {
    const keys = adConclusion(rec({ n: 1, cost: 3.7, good: 0 }, { n: 7, cost: 4.1, good: 1 })).map((x) => x.key);
    expect(keys).toEqual(['againstCostly', 'fewFollowed']);
  });
  it('compares followed and against once both have two', () => {
    expect(adConclusion(rec({ n: 2, cost: 2, good: 2 }, { n: 3, cost: 4, good: 0 }))[0].key).toBe('followWins');
  });
  it('adds what to do with a waiting post', () => {
    const pending = [{ post: { title: 'x' }, tl: { d1: { verdict: 'skip' }, d2: null } }];
    expect(adConclusion(rec({ n: 0, good: 0 }, { n: 0, good: 0 }, pending)).at(-1)).toEqual({ key: 'nowSkip', vars: { title: 'x' } });
  });
  it('keeps the strongest statement per experiment item', () => {
    const r = (metric, verdict, groups = []) => ({ id: 'intro', name: '인트로', metric, groups, verdict });
    const out = expConclusion([r('exit2s', { best: '없음', rel: 0.02, clear: false }), r('retain5s', { best: '없음', worst: '있음', rel: 0.12, clear: true, mixed: true })], [{ id: 'intro' }]);
    expect(out).toEqual([{ kind: 'mixed', metric: 'retain5s', vars: { name: '인트로', best: '없음', pct: 12, why: 'mixed' } }]);
  });
  it('turns the brief into the first things to do', () => {
    const out = opsConclusion([{ key: 'recentDown' }, { key: 'weak.ctr', metric: 'ctr' }, { key: 'adOnlyStrong', vars: { cut: 313 } }, { key: 'adGoal', vars: {} }]);
    expect(out).toEqual([{ key: 'fix', metric: 'ctr' }, { key: 'adBoth', vars: { cut: 313 } }]);
  });
});
