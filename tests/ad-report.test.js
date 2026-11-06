import { describe, expect, it } from 'vitest';
import { memoAds, orderAds, placeOrder, rememberTitle, sameOrder, splitMoney } from '../src/xhs/ad-orders.js';
import { adComments, adOrders, adSummary, goalType, periodRows, stageBucket, stageRows } from '../src/xhs/ad-report.js';
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

  it('replaces the record imported from the workbook memo instead of adding the amount twice', () => {
    const ps = [normalizePost({ id: 'm', title: 'M1', date: '2026-03-01', ads: [{ stage: 'D+1', spend: 60, sourceText: '진행(60元)', needsReview: true }] })];
    const memoId = ps[0].ads[0].id;
    placeOrder(ps, orderAds({ values: { spend: 60, startedAt: '2026-03-02T09:00', orderNo: 'x1', reads: 100 }, postIds: ['m'], posts: ps }));
    expect(ps[0].ads).toHaveLength(1);
    expect(ps[0].ads[0]).toMatchObject({ id: memoId, orderNo: 'x1', needsReview: false, sourceText: '진행(60元)' });
    expect(adTotals(ps).spend).toBe(60);
    // A different amount is a different ad: kept.
    placeOrder(ps, orderAds({ values: { spend: 30, startedAt: '2026-03-02T20:00', orderNo: 'x2' }, postIds: ['m'], posts: ps }));
    expect(ps[0].ads).toHaveLength(2);
  });

  it('keeps real money and platform credit apart, and uses the screenshot publish date for D+n', () => {
    expect(splitMoney({ spend: 85, paid: 60, orderAmount: 60 })).toEqual({ money: 60, credit: 25 });
    expect(splitMoney({ spend: 60, paid: 60 })).toEqual({ money: 60, credit: null });
    expect(splitMoney({ spend: 50 })).toEqual({ money: 50, credit: null });
    // Workbook says 03-02, the screenshot says the note went out 03-01 19:20; ad 03-02 09:20 → D+1.
    const ps = [normalizePost({ id: 'k', title: 'K', date: '2026-03-02', ads: [{ stage: 'D+1', spend: 60, sourceText: '진행(60元)' }] })];
    const entries = orderAds({ values: { spend: 85, paid: 60, orderAmount: 60, startedAt: '2026-03-02T09:20', publishedAt: '2026-03-01T19:20', orderNo: 'k1' }, postIds: ['k'], posts: ps });
    expect(entries[0].ad).toMatchObject({ stage: 'D+1', spend: 60, credit: 25 });
    placeOrder(ps, entries);
    expect(ps[0].ads).toHaveLength(1); // the memo record was replaced
    expect(adTotals(ps)).toMatchObject({ spend: 60, credit: 25 });
    expect(adSummary(adOrders(ps))).toMatchObject({ spend: 60, credit: 25 });
  });

  it('the review screen choice wins: replace a given memo, or keep both', () => {
    const mk = () => [normalizePost({ id: 'q', title: 'Q', date: '2026-03-01', ads: [{ stage: 'D+2', spend: 100, sourceText: '진행(100元)' }] })];
    const a = mk();
    placeOrder(a, orderAds({ values: { spend: 60, startedAt: '2026-03-02T10:00', orderNo: 'q1' }, postIds: ['q'], posts: a })); // D+1, 60: no likely memo
    expect(a[0].ads).toHaveLength(2);
    const b = mk();
    expect(memoAds(b[0])).toHaveLength(1);
    placeOrder(b, orderAds({ values: { spend: 60, startedAt: '2026-03-02T10:00', orderNo: 'q1' }, postIds: ['q'], posts: b, replace: b[0].ads[0].id }));
    expect(b[0].ads).toHaveLength(1);
    const c = mk();
    placeOrder(c, orderAds({ values: { spend: 100, startedAt: '2026-03-03T10:00', orderNo: 'q2' }, postIds: ['q'], posts: c, replace: '' })); // same D+2 but "keep both"
    expect(c[0].ads).toHaveLength(2);
  });

  it('cost per follower / like+save only from orders bought for that goal', () => {
    const ps = [
      normalizePost({ id: 'x', date: '2026-04-01', ads: [{ start: '2026-04-02T10:00', spend: 60, goal: '点赞收藏量', order: { reads: 200, likes: 50, favorites: 10, follows: 1 } }] }),
      normalizePost({ id: 'y', date: '2026-04-05', ads: [{ start: '2026-04-06T10:00', spend: 40, goal: '关注', order: { reads: 100, likes: 5, favorites: 1, follows: 10 } }] }),
    ];
    const s = adSummary(adOrders(ps));
    expect(s.perFollow).toBe(4); // 40 / 10, not (60 + 40) / 11
    expect(s.perLikeFav).toBe(1); // 60 / 60
    expect(s.perRead).toBeCloseTo(100 / 300);
    expect(goalType('关注')).toBe('follow');
    expect(adSummary(adOrders(ps.slice(0, 1))).perFollow).toBeNull();
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

describe('amounts that agree confirm each other', () => {
  it('consumed 60/60 (slash misread), 订单金额 60 and 实付金额 60 all read unsure → all confirmed', () => {
    const r = parseAdOrder([[L('订单 金额 60 元', 40), L('实 付 金 额 60 元', 40), L('当前 已 消耗 金额 60160 元', 60)]]);
    for (const k of ['spend', 'budget', 'orderAmount', 'paid']) expect(r.fields[k]).toMatchObject({ status: 'ok', value: 60 });
  });
  it('a different paid amount is not confirmed by the consumed amount', () => {
    const r = parseAdOrder([[L('订单 金额 60 元', 40), L('实 付 金 额 50 元', 40), L('当前 已 消耗 金额 60160 元', 60)]]);
    expect(r.fields.paid.status).toBe('check');
  });
});

describe('order → post without a readable publish time', () => {
  const posts = [
    normalizePost({ id: 'p1', title: 'T1', date: '2026-03-01', adTitles: ['测试vlog|海边咖啡'] }),
    normalizePost({ id: 'p2', title: 'T2', date: '2026-03-10' }),
    normalizePost({ id: 'p3', title: 'T3', date: '2026-03-20' }),
  ];
  it('picks the post published last before the ad started, even if another title looks closer', () => {
    const m = matchPost(posts, null, '测试vlog|海边逛街', '2026-03-11T17:12');
    expect(m.post.id).toBe('p2');
    expect(m.byStart).toBe(true);
    expect(matchPost(posts, null, '', '2026-03-25T10:00').post.id).toBe('p3');
  });
  it('reads a publish time whose label is garbled (the only date-time with seconds)', () => {
    const r = parseAdOrder([[L('笔记 作者 : 某某'), L('友 和 时 问 : 2026-03-10 19:20:09'), L('下 单 时间 2026-03-11 17:12')]]);
    expect(r.fields.publishedAt.value ?? r.fields.publishedAt.candidate).toBe('2026-03-10T19:20');
    expect(r.fields.startedAt.value).toBe('2026-03-11T17:12');
    expect(r.fields.startedAt.at).toMatchObject({ img: 0 }); // where it was read (shown on the review screen)
  });
});

describe('goal result misread with an extra digit', () => {
  it('"59 效果极好" read as "598" is corrected by estimate top + bonus (56 + 3)', () => {
    const r = parseAdOrder([[L('点 赞 收藏 量 598 / 预 估 转 化 17 ~ 56', 40), L('超额 获 赠 3', 40)]]);
    expect(r.fields.result).toMatchObject({ status: 'ok', value: 59 });
    expect(r.fields.bonus).toMatchObject({ status: 'ok', value: 3 });
  });
  it('a reading that does not fit is left for checking', () => {
    const r = parseAdOrder([[L('点 赞 收藏 量 71 / 预 估 转 化 17 ~ 56', 40), L('超额 获 赠 3', 40)]]);
    expect(r.fields.result.status).toBe('check');
  });
});

describe('audience charts', () => {
  const A = (label, value, conf = 90) => ({ words: [{ text: label, confidence: conf, bbox: { x0: 70, y0: 0, x1: 160, y1: 20 } }, { text: '国国', confidence: 0, bbox: { x0: 190, y0: 0, x1: 400, y1: 20 } }, { text: value, confidence: conf, bbox: { x0: 780, y0: 0, x1: 850, y1: 20 } }] });
  it('maps garbled names to known ones and ignores the bar between name and number', () => {
    const r = parseAdOrder([[L('城市 分 布'), A('头州', '55.5%'), A('川', '3.9%'), A('其他', '40.6%'), L('观众 兴趣 分 布'), A('炽乐', '94.5%'), A('生活记录人', '99.4%')]]);
    expect(Object.keys(r.audience.city)).toEqual(['贵州', '四川', '其他']);
    expect(r.audience.city['贵州']).toMatchObject({ status: 'ok', value: 0.555 });
    expect(Object.keys(r.audience.interest)).toEqual(['娱乐', '生活记录']);
  });
  it('shares that add up to 100% confirm each other; one missing dot is filled from the rest', () => {
    const r = parseAdOrder([[L('年 龄 分 布'), A('18以下', '1.4%'), A('18~23', '11%', 50), A('24~30', '36.6%'), A('31~40', '31.9%'), A('41~50', '13.0%'), A('50以上', '6.0%')]]);
    expect(r.audience.age['18~23']).toMatchObject({ status: 'ok', value: 0.111 });
  });
});

describe('audience: two readings without a dot', () => {
  const A = (label, value, conf = 50) => ({ words: [{ text: label, confidence: 90, bbox: { x0: 70, y0: 0, x1: 160, y1: 20 } }, { text: '国', confidence: 0, bbox: { x0: 190, y0: 0, x1: 400, y1: 20 } }, { text: value, confidence: conf, bbox: { x0: 780, y0: 0, x1: 850, y1: 20 } }] });
  it('"11%" and "319%" are resolved so the six ages add up to 100%', () => {
    const r = parseAdOrder([[L('年 龄 分 布'), A('18以下', '1.4%', 90), A('18~23', '11%'), A('24~30', '36.6%'), A('31~40', '319%'), A('41~50', '13.0%', 90), A('50以上', '6.0%')]]);
    expect(Object.values(r.audience.age).map((x) => [x.status, x.value])).toEqual([['ok', 0.014], ['ok', 0.111], ['ok', 0.366], ['ok', 0.319], ['ok', 0.13], ['ok', 0.06]]);
  });
});
