import { describe, expect, it } from 'vitest';
import { orderAds, placeOrder, rememberTitle, sameOrder } from '../src/xhs/ad-orders.js';
import { adComments, adOrders, adSummary, periodRows, stageBucket, stageRows } from '../src/xhs/ad-report.js';
import { parseAdOrder } from '../src/xhs/ocr-ad-parse.js';
import { adTotals } from '../src/xhs/stats.js';
import { normalizeAd, normalizePost } from '../src/xhs/store.js';
import { matchPost, suggestPosts } from '../src/views/xhs/ocr-ad.js';

// Synthetic data only (made-up titles and numbers).
const L = (text, conf = 92) => ({ words: text.split(' ').map((w, i) => ({ text: w, confidence: conf, bbox: { x0: i * 40, y0: 0, x1: i * 40 + 30, y1: 20 } })) });

describe('order screenshots: new layouts', () => {
  it('reads order info, money, estimate formats and confirms values that agree', () => {
    const r = parseAdOrder([
      [L('推广 完成'), L('已 完成 全 部 预算 消耗 ， 推 广 结束'), L('本 订单 共 推 广 1 篇 笔记 。'), L('测试vlog | 一个 示例 标题', 40), L('发 布 时 间 : 2026-03-01 19:00:04', 30), L('推广 目标 点 赞 收藏 量'), L('预 估 转 化 10~40 个 点 赞 收藏 量'), L('预计 推广 时 长 1 天'), L('下 单 时间 2026-03-02 09:10'), L('订单 编号 abcdef12-3456-7890-ab12-… 复 制')],
      [L('订单 金额 40 元'), L('实 付 金 额 40 元', 70), L('点 赞 收藏 量 47 效果 极 好 / 预 估 转 化 10 ~ 40', 30), L('超额 获 赠 7', 0), L('当前 已 消耗 金额 40140 元', 60)],
    ]);
    const f = r.fields;
    expect(f.noteCount.value).toBe(1);
    expect(f.orderNo.value).toBe('abcdef12-3456-7890-ab12');
    expect(f.startedAt.value).toBe('2026-03-02T09:10');
    expect(f.duration.value).toBe(24);
    expect(f.estimate.value).toEqual([10, 40]);
    expect(f.orderAmount.value).toBe(40);
    expect(f.paid).toMatchObject({ status: 'ok', value: 40 }); // equals 订单金额
    expect(f.spend).toMatchObject({ status: 'ok', value: 40 }); // "40140" + 订单金额 40
    expect(f.result).toMatchObject({ status: 'ok', value: 47 }); // 47 − 40 = bonus 7
    expect(f.bonus).toMatchObject({ status: 'ok', value: 7 });
  });

  it('multi-note orders: note count, "目标区间", cost check, spent-all budget', () => {
    const r = parseAdOrder([[L('推广 完成'), L('已 完成 全 部 预算 消耗 ， 推 广 结束'), L('本 订单 共 推 广 3 篇 笔记 。'), L('测试vlog丨海边 测试vlog丨爬山', 10), L('展开 详情'), L('当前 已 消耗 金额 30/130 元', 20), L('BEE 40 / 目标 区 间 10~50', 40), L('你 的 投放 成 本 在 0.75 元 ， 投放 效果 高 于 50% 同 质 订 单 !')]]);
    const f = r.fields;
    expect(f.noteCount.value).toBe(3);
    expect(f.title).toBeUndefined(); // titles of several notes are not one title
    expect(r.noteText).toContain('海边');
    expect(f.spend).toMatchObject({ status: 'ok', value: 30 }); // 0.75 × 40 = 30
    expect(f.budget).toMatchObject({ status: 'ok', value: 30 }); // "/1" was the slash, budget all used
    expect(f.result).toMatchObject({ status: 'ok', value: 40 });
    expect(f.beatPct.value).toBe(0.5);
  });

  it('percentages that lost their dot are offered, and confirmed when the pair adds up', () => {
    const r = parseAdOrder([[L('性 别 分 布'), L('男性 31% 女性 96.9%'), L('年 龄 分 布'), L('18X 下 2.8%'), L('s1~20 (ED 247%')]]);
    expect(r.audience.gender.male).toMatchObject({ status: 'ok', value: 0.031 });
    expect(r.audience.age['18以下']).toMatchObject({ status: 'ok', value: 0.028 });
    expect(r.audience.age['31~40']).toMatchObject({ status: 'check', candidate: 0.247 });
  });
});

describe('saving orders', () => {
  const posts = () => [normalizePost({ id: 'a', title: '测试vlog丨海边', date: '2026-03-01' }), normalizePost({ id: 'b', title: '测试vlog丨爬山', date: '2026-03-02' }), normalizePost({ id: 'c', title: '另一个', date: '2026-02-01' })];

  it('splits a multi-note order evenly, D+n per post, and counts it once', () => {
    const ps = posts();
    const entries = orderAds({ values: { spend: 30, startedAt: '2026-03-03T10:00', orderNo: 'o1', reads: 60 }, postIds: ['a', 'b'], posts: ps });
    expect(entries.map((x) => [x.postId, x.ad.stage, x.ad.spend, x.ad.allocation])).toEqual([
      ['a', 'D+2', 15, 'equal'],
      ['b', 'D+1', 15, 'equal'],
    ]);
    placeOrder(ps, entries);
    expect(adTotals(ps)).toMatchObject({ count: 1, spend: 30 });
    const orders = adOrders(ps);
    expect(orders).toHaveLength(1);
    expect(adSummary(orders).perRead).toBe(0.5); // the whole order: 30 / 60
  });

  it('the same order uploaded again replaces the old record, also when moved to another post', () => {
    const ps = posts();
    placeOrder(ps, orderAds({ values: { spend: 20, orderNo: 'o2' }, postIds: ['a'], posts: ps }));
    placeOrder(ps, orderAds({ values: { spend: 20, orderNo: 'o2', reads: 10 }, postIds: ['c'], posts: ps }));
    expect(ps.find((p) => p.id === 'a').ads).toHaveLength(0);
    expect(ps.find((p) => p.id === 'c').ads.map((a) => a.order.reads)).toEqual([10]);
    expect(sameOrder(normalizeAd({ start: '2026-01-01T10:00', spend: 5, order: { exposure: 9 } }), normalizeAd({ start: '2026-01-01T10:00', spend: 5, order: { exposure: 9 } }))).toBe(true);
  });

  it('remembers the screenshot title so the next order matches by title alone', () => {
    const ps = posts();
    expect(matchPost(ps, null, '完全不同的名字')).toBeNull();
    expect(rememberTitle(ps[2], '完全不同的名字')).toBe(true);
    expect(rememberTitle(ps[2], '完全不同的名字')).toBe(false);
    expect(matchPost(ps, null, '完全不同的名字').post.id).toBe('c');
    expect(suggestPosts(ps, '测试vlog丨海边 测试viog1爬山', '2026-03-05T00:00').map((x) => x.post.id).sort()).toEqual(['a', 'b']);
  });
});

describe('ad report', () => {
  const mk = (id, date, ads) => normalizePost({ id, title: `T${id}`, date, d1: { views: id === 'p1' || id === 'p2' ? 500 : 50 }, ads });
  const ad = (start, spend, reads, extra = {}) => ({ start, spend, goal: '点赞收藏量', order: { reads, likes: 5, favorites: 1, follows: 0 }, ...extra });
  const posts = [
    mk('p1', '2026-01-01', [ad('2026-01-02T10:00', 50, 200)]),
    mk('p2', '2026-01-10', [ad('2026-01-10T20:00', 50, 250)]),
    mk('p3', '2026-02-01', [ad('2026-02-05T10:00', 50, 100)]),
    mk('p4', '2026-02-10', [ad('2026-02-14T10:00', 50, 50), ad('', 20, null)]),
  ];

  it('totals per month and year, placing orders without a start time by the post date', () => {
    const orders = adOrders(posts);
    const months = periodRows(orders, 'month', [{ date: '2026-02-20', cashKRW: 100000, inKindKRW: 0 }], 190);
    expect(months.map((r) => [r.period, r.count, r.spend])).toEqual([
      ['2026-02', 3, 120],
      ['2026-01', 2, 100],
    ]);
    expect(months[0]).toMatchObject({ estimatedDates: 1, cash: 100000, spendKRW: 120 * 190, net: 100000 - 120 * 190 });
    expect(periodRows(orders, 'year')[0]).toMatchObject({ period: '2026', count: 5, spend: 220 });
    expect(periodRows(orders, 'month')[0].spendKRW).toBeNull(); // no rate typed → no conversion
  });

  it('groups by D+n and comments only where there is enough data', () => {
    expect(stageBucket('D+5')).toBe('D+3~7');
    expect(stageBucket('')).toBe('?');
    const orders = adOrders(posts);
    expect(stageRows(orders).map((r) => r.bucket)).toEqual(['D', 'D+1', 'D+3~7', '?']);
    const c = adComments(orders, { baseline: { medians: { views: 300 } } });
    const keys = c.map((x) => x.key);
    expect(keys).toContain('overall');
    expect(keys).toContain('best');
    expect(keys).toContain('earlyCheaper'); // D/D+1: 100元 / 450 reads vs later: 100元 / 150 reads
    expect(keys).toContain('followsFromLikeFav');
    expect(keys).toContain('boostStrong');
    expect(keys).toContain('noReport');
    expect(adComments(adOrders(posts.slice(0, 1))).map((x) => x.key)).toContain('needMore');
  });
});
