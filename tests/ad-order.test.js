import { describe, expect, it } from 'vitest';
import { adEffect, orderEfficiency } from '../src/xhs/analysis.js';
import { parseAdOrder, splitSpent } from '../src/xhs/ocr-ad-parse.js';
import { normalizeAd, normalizeStage } from '../src/xhs/store.js';
import { matchPost } from '../src/views/xhs/ocr-ad.js';

// Synthetic OCR lines (made-up numbers), shaped like a 薯条 order detail screen.
// Audience rows as on screen: name at the far left, bar in the middle, share at the far right.
const A = (label, value, conf = 92) => ({ words: [{ text: label, confidence: conf, bbox: { x0: 70, y0: 0, x1: 160, y1: 20 } }, { text: '▇', confidence: 0, bbox: { x0: 190, y0: 0, x1: 400, y1: 20 } }, { text: value, confidence: conf, bbox: { x0: 780, y0: 0, x1: 850, y1: 20 } }] });
const L = (text, conf = 92) => ({ words: text.split(' ').map((w, i) => ({ text: w, confidence: conf, bbox: { x0: i * 40, y0: 0, x1: i * 40 + 30, y1: 20 } })) });

describe('薯条 order parsing', () => {
  it('drops an extra digit in front of the goal result when estimate top + bonus says so ("951" → 51)', () => {
    const f = parseAdOrder([
      [L('点 赞 收藏 量 951 效果 极 好 / 预 估 转 化 10 ~ 42', 65), L('超额 获 赠 9', 70), L('曝光 量 阅读 量 点 赞 量 收藏 量'), L('500 60 42 9'), L('推广 目标 点 赞 收藏 量')],
    ]).fields;
    expect(f.result).toMatchObject({ status: 'ok', value: 51 });
    expect(f.bonus).toMatchObject({ status: 'ok', value: 9 });
  });

  it('leaves a flag emoji read as Latin letters out of the title', () => {
    const W = (text, x0, conf = 90) => ({ text, confidence: conf, bbox: { x0, y0: 700, x1: x0 + 40, y1: 750 } });
    const f = parseAdOrder([[L('订单 详情'), { words: [W('测试', 360), W('vlog', 450), W('|', 543), W('tio', 575, 72), W('城市', 637), W('一日游', 780)] }]]).fields;
    expect(f.title.candidate).toBe('测试vlog | 城市一日游');
  });

  it('splits a slash read as "1"', () => {
    expect(splitSpent('50/80')).toEqual({ spend: 50, budget: 80, sure: true });
    expect(splitSpent('1001100')).toMatchObject({ spend: 100, budget: 100, sure: false });
  });

  it('reads the metric grid, spend, goal result and audience; uncertain values stay unfilled', () => {
    const r = parseAdOrder([
      [L('推广 完成'), L('发 布 时 间 : 2026-01-05 19:20:05'), L('点 赞 收藏 量 10 / 预 估 转 化 5 ~ 20', 60), L('满 50.0 元 赠 20.0 元')],
      [L('当前 已 消耗 金额 300/300 元'), L('曝光 量 阅读 量 点 赞 量 收藏 量'), L('500 60 8 2'), L('评论 量 新 增 关注 主页 浏览 私信 开口'), L('1 3 7 0')],
      [L('性 别 分 布'), L('男性 40.0% 女性 60.0%'), L('年 龄 分 布'), A('18以下', '2.0%'), A('18~23', '268%')],
    ]);
    const f = r.fields;
    expect(f.status.value).toBe('done');
    expect(f.publishedAt.value).toBe('2026-01-05T19:20');
    expect([f.exposure.value, f.reads.value, f.likes.value, f.favorites.value]).toEqual([500, 60, 8, 2]);
    expect([f.comments.value, f.follows.value, f.profileViews.value, f.dmOpens.value]).toEqual([1, 3, 7, 0]);
    expect(f.spend).toMatchObject({ status: 'ok', value: 300 });
    expect(f.goal.value).toBe('点赞收藏量');
    expect(f.result).toMatchObject({ status: 'ok', value: 10 }); // unsure reading, but = likes 8 + saves 2 of the report
    expect(r.audience.gender.male).toMatchObject({ status: 'ok', value: 0.4 }); // 40 + 60 = 100 confirms
    expect(r.audience.age['18~23']).toMatchObject({ status: 'check' }); // "268%" is not a share
  });
});

describe('ad statistics', () => {
  const post = (ads) => ({ d1: { views: 100, newFollowers: 1 }, d2: { views: 300, newFollowers: 3 }, ads: ads.map(normalizeAd) });

  it('accepts any D+n and links only D+1 spend to the D+1→D+2 change', () => {
    expect(normalizeStage('d+5')).toBe('D+5');
    expect(normalizeStage('D+3+')).toBe('D+3');
    expect(normalizeStage('D')).toBe('D');
    const e = adEffect(post([{ stage: 'D+1', spend: 60 }, { stage: 'D+4', spend: 100 }, { stage: '', spend: 20 }]));
    expect(e.spend).toBe(180);
    expect(e.betweenSpend).toBe(60);
    expect(e.perView).toBeCloseTo(60 / 200);
    expect(e.unknownStage).toBe(1);
    expect(adEffect(post([{ stage: 'D+4', spend: 100 }])).perView).toBeNull();
  });

  it('computes per-order cost from the order report', () => {
    const order = { reads: 50, likes: 15, favorites: 5, follows: 2 };
    // Cost per like+save / follower only for orders bought for that goal; per read for every order.
    expect(orderEfficiency(normalizeAd({ spend: 100, goal: '点赞收藏量', order }))).toMatchObject({ perRead: 2, perLikeFav: 5, perFollow: null, likeFav: 20 });
    expect(orderEfficiency(normalizeAd({ spend: 100, goal: '关注', order }))).toMatchObject({ perRead: 2, perLikeFav: null, perFollow: 50 });
  });

  it('matches an order to the post published that day', () => {
    const posts = [{ id: 'a', date: '2026-01-04', title: '서울 산책' }, { id: 'b', date: '2026-01-05', title: '首尔vlog 一天' }];
    expect(matchPost(posts, '2026-01-05T19:20', '首尔vlog|一天').post.id).toBe('b');
    expect(matchPost(posts, '2026-01-06T10:00', '').post.id).toBe('b'); // one day apart
  });
});

describe('D+n from dates', () => {
  it('counts calendar days between publishing and the ad start', async () => {
    const { stageFromDates, normalizePost } = await import('../src/xhs/store.js');
    expect(stageFromDates('2026-11-02', '2026-11-02T21:00')).toBe('D');
    expect(stageFromDates('2026-11-02', '2026-11-03T09:00')).toBe('D+1');
    expect(stageFromDates('2026-11-02', '2026-11-07T00:10')).toBe('D+5');
    expect(stageFromDates('2026-11-02', '2026-11-01T10:00')).toBe(''); // before publishing: not guessed
    expect(stageFromDates('', '2026-11-03T09:00')).toBe('');
    const p = normalizePost({ date: '2026-11-02', ads: [{ start: '2026-11-04T10:30', spend: 60 }, { stage: 'D+1', start: '2026-11-04T10:30' }] });
    expect(p.ads.map((a) => a.stage)).toEqual(['D+2', 'D+1']); // typed value wins
  });
});

describe('slots left after the title matches', () => {
  it('lists posts published up to the ad start, latest first, without those already chosen', async () => {
    const { recentBefore } = await import('../src/views/xhs/ocr-ad.js');
    const posts = [{ id: 'a', date: '2026-03-01' }, { id: 'b', date: '2026-03-08' }, { id: 'c', date: '2026-03-10' }, { id: 'd', date: '2026-03-20' }];
    expect(recentBefore(posts, '2026-03-10T21:00', ['b']).map((p) => p.id)).toEqual(['c', 'a']);
    expect(recentBefore(posts, '', [])).toEqual([]);
  });
});

describe('a multi-note order with a note whose post is not in the app', () => {
  it('splits over all notes; the outside share stays in the total only', async () => {
    const { orderAds, LATER } = await import('../src/xhs/ad-orders.js');
    const { adTotals } = await import('../src/xhs/stats.js');
    const { historyEntries } = await import('../src/xhs/ad-report.js');
    const { normalizePost } = await import('../src/xhs/store.js');
    const ps = ['a', 'b', 'c', 'd'].map((id, i) => normalizePost({ id, title: id, date: `2026-03-0${i + 1}` }));
    const entries = orderAds({ values: { spend: 140, orderAmount: 140, paid: 100, startedAt: '2026-03-10T06:39', orderNo: 'o9', follows: 27 }, postIds: ['a', 'b', LATER, 'c', 'd'], posts: ps });
    expect(entries.map((x) => [x.postId, x.ad.spend, x.ad.credit, x.ad.noteCount, x.ad.outsideNotes])).toEqual([
      ['a', 20, 8, 5, 1], ['b', 20, 8, 5, 1], ['c', 20, 8, 5, 1], ['d', 20, 8, 5, 1],
    ]);
    const saved = ps.map((p) => ({ ...p, ads: entries.filter((x) => x.postId === p.id).map((x) => x.ad) }));
    expect(adTotals(saved)).toMatchObject({ spend: 100, credit: 40, count: 1 });
    expect(historyEntries(saved)[0]).toMatchObject({ multi: true, spend: 100, credit: 40, outside: 1 });
  });
});

describe('a memo written before the screenshots', () => {
  it('a multi-note order replaces a memo of its whole real money a day off; a single note keeps exact D+n', async () => {
    const { memoToReplace, memoDuplicateOf } = await import('../src/xhs/ad-orders.js');
    const { normalizeAd } = await import('../src/xhs/store.js');
    const memo = normalizeAd({ id: 'm', stage: 'D+2', spend: 100, sourceText: '진행(100元)' });
    const share = normalizeAd({ id: 's', stage: 'D+3', spend: 20, credit: 8, orderSpend: 100, paid: 100, orderAmount: 140, noteCount: 5, groupKey: 'g', orderNo: 'o', order: { reads: 851 } });
    const post = { ads: [memo, share] };
    expect(memoToReplace({ ads: [memo] }, share)).toBe(memo);
    expect(memoDuplicateOf(post, memo)).toBe(share);
    const single = normalizeAd({ stage: 'D+2', spend: 60, orderNo: 'p', order: { reads: 300 } });
    const memo60 = normalizeAd({ id: 'm1', stage: 'D+1', spend: 60 });
    expect(memoToReplace({ ads: [memo60] }, single)).toBeNull();
    expect(memoDuplicateOf({ ads: [memo60, single] }, memo60)).toBeNull();
    const memoSame = normalizeAd({ id: 'm2', stage: 'D+2', spend: 60 });
    expect(memoDuplicateOf({ ads: [memoSame, single] }, memoSame)).toBe(single);
  });
});
