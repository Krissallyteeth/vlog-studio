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
