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
    mk('p2', '2026-01-10', [ad('2026-01-11T09:00', 50, 250)]),
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
    expect(stageRows(orders).map((r) => r.bucket)).toEqual(['D+1', 'D+3~7', '?']);
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
    // "炽乐": 乐 fits 娱乐 and 音乐 equally — kept as a guess, to be read again from the image
    expect(Object.keys(r.audience.interest)).toEqual(['#1', '生活记录']);
    expect(r.audience.interest['#1']).toMatchObject({ status: 'check', guessName: '娱乐' });
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

describe('comment texts', () => {
  it('every placeholder in a comment text is filled by the comment data (all languages)', async () => {
    const dicts = await Promise.all(['ko', 'en', 'zh'].map((l) => import(`../src/i18n/${l}.js`).then((m) => m.default)));
    const mk = (id, date, goal, extra = {}) => normalizePost({ id, title: `T${id}`, date, d1: { views: id < 'c' ? 500 : 50 }, ads: [{ start: `${date}T20:00`, spend: 60, credit: 10, goal, order: { reads: 100, likes: 5, favorites: 1, follows: 1 }, goalResult: 6, estimate: [1, 5], ...extra }] });
    const posts = [mk('a', '2026-01-01', '点赞收藏量'), mk('b', '2026-01-10', '关注'), mk('c', '2026-02-01', '点赞收藏量'), mk('d', '2026-02-10', '点赞收藏量')];
    const comments = adComments(adOrders(posts), { baseline: { medians: { views: 300 } }, income: [{ date: '2026-02-01', cashKRW: 1 }] });
    expect(comments.length).toBeGreaterThan(5);
    for (const dict of dicts) {
      for (const c of comments) {
        const text = dict[`adr.c.${c.key}`];
        expect(text, c.key).toBeTruthy();
        for (const [, name] of text.matchAll(/\{(\w+)\}/g)) expect(c.vars, `${c.key}: {${name}}`).toHaveProperty(name);
      }
    }
  });
});

describe('city chart: unnamed last row', () => {
  const A = (label, value) => ({ words: [{ text: label, confidence: 90, bbox: { x0: 70, y0: 0, x1: 160, y1: 20 } }, { text: '国', confidence: 0, bbox: { x0: 190, y0: 0, x1: 400, y1: 20 } }, { text: value, confidence: 90, bbox: { x0: 780, y0: 0, x1: 850, y1: 20 } }] });
  it('the last row of 城市分布 without a readable name is 其他', () => {
    const r = parseAdOrder([[L('城市 分 布'), A('广东', '13.6%'), A('浙江', '6.5%'), A('四川', '6.0%'), A('具', '73.9%')]]);
    expect(Object.keys(r.audience.city)).toEqual(['广东', '浙江', '四川', '其他']);
    expect(r.audience.city['其他']).toMatchObject({ status: 'ok', value: 0.739 }); // the four add up to 100%
  });
});

describe('audience names from a second reading', () => {
  it('a character in the same place breaks a tie ("影饮" → 影视, not 摄影)', async () => {
    const { nameGuess } = await import('../src/xhs/ocr-ad-parse.js');
    expect(nameGuess('影 饮', 'interest')).toEqual({ name: '影视', sure: true });
    expect(nameGuess('具他', 'city').name).toBe(''); // 他 alone is too common to decide
  });
});

describe('audience: page noise and merged lines', () => {
  const W = (text, x0, conf = 90) => ({ text, confidence: conf, bbox: { x0, y0: 0, x1: x0 + 60, y1: 20 } });
  it('a first row merged with its heading still gives the name; the banner below is not a row', () => {
    const r = parseAdOrder([[
      { words: [W('观众兴趣分布', 70), W('娱乐', 140), W('国', 300, 0), W('92.4%', 780)] },
      { words: [W('生活记录', 70), W('国', 300, 0), W('91.8%', 780)] },
      { words: [W('快来关注薯条小助手', 190), W('去关注', 700)] },
      { words: [W('涨流量', 70), W('0.2', 780)] },
    ]]);
    expect(Object.keys(r.audience.interest)).toEqual(['娱乐', '生活记录']);
  });
});

describe('audience: a row split into two OCR lines', () => {
  const W = (text, x0, y0, conf = 90) => ({ text, confidence: conf, bbox: { x0, y0, x1: x0 + 60, y1: y0 + 20 } });
  it('"娱乐" on one line and "92.4%" on the next (same height) are one row', () => {
    const r = parseAdOrder([[
      { words: [W('观众兴趣分布', 70, 0)] },
      { words: [W('娱乐', 70, 40)] },
      { words: [W('国', 300, 41, 0), W('92.4%', 780, 41)] },
      { words: [W('生活记录', 70, 80), W('国', 300, 80, 0), W('91.8%', 780, 80)] },
    ]]);
    expect(r.audience.interest['娱乐']).toMatchObject({ status: 'ok', value: 0.924 });
    expect(Object.keys(r.audience.interest)).toEqual(['娱乐', '生活记录']);
  });
});

describe('audience: first interest row output before its heading', () => {
  const W = (text, x0, y0, conf = 90) => ({ text, confidence: conf, bbox: { x0, y0, x1: x0 + 60, y1: y0 + 20 } });
  const row = (n, v, y) => ({ words: [W(n, 70, y), W('国', 300, y, 0), W(v, 780, y)] });
  it('is moved from the regions (already 100%) to the top of the interests', () => {
    const r = parseAdOrder([[
      { words: [W('城市分布', 70, 0)] }, row('贵州', '60.0%', 40), row('广东', '30.0%', 80), row('其他', '10.0%', 120),
      { words: [W('x', 70, 200, 10), W('国', 300, 200, 0), W('92.4%', 780, 200)] }, // 娱乐 row, name unreadable, before the heading
      { words: [W('观众兴趣分布', 70, 160)] }, row('美食', '87.0%', 240),
    ]]);
    expect(Object.keys(r.audience.city)).toEqual(['贵州', '广东', '其他']);
    expect(Object.keys(r.audience.interest)).toEqual(['#1', '美食']);
    expect(r.audience.interest['#1']).toMatchObject({ status: 'check', candidate: 0.924 });
  });
});

describe('audience: number glued to the bar', () => {
  const W = (text, x0, x1, y, conf = 90) => ({ text, confidence: conf, bbox: { x0, y0: y, x1, y1: y + 40 } });
  it('a word from the bar start to the right edge still gives the row (to be re-read); "418%6" is 41.8', () => {
    const r = parseAdOrder([[
      { words: [W('观众', 88, 186, 0), W('兴趣', 185, 252, 0), W('分', 269, 293, 0), W('布', 311, 335, 0)] },
      { words: [W('炽', 88, 155, 100, 27), W('乐', 149, 224, 100, 0), W('(2.4"', 264, 1089, 100, 32)] },
      { words: [W('生活', 89, 171, 200), W('记录', 174, 228, 200), W('(人', 264, 908, 200, 28), W('91.8%', 997, 1090, 200)] },
      { words: [W('wr', 88, 157, 300, 0), W('(人', 264, 817, 300, 8), W('78.8%', 990, 1089, 300, 75)] },
      { words: [W('关', 88, 157, 400), W('站。', 138, 246, 400, 0), W('(3', 264, 557, 400, 0), W('418%6', 994, 1089, 400, 58)] },
    ]]);
    const keys = Object.keys(r.audience.interest);
    expect(keys).toHaveLength(4); // every row kept, none lost
    expect(r.audience.interest[keys[0]]).toMatchObject({ status: 'check', guessName: '娱乐' }); // glued word, guessed name → read again
    expect(keys).not.toContain('人'); // bar junk is not a name
    expect(Object.values(r.audience.interest).at(-1).candidate).toBe(0.418);
  });
});

describe('goal result confirmed by the report', () => {
  it('点赞收藏量 19 (unsure) = likes 15 + saves 4 → confirmed', () => {
    const r = parseAdOrder([[L('推广 目标 点 赞 收藏 量'), L('曝光 量 阅读 量 点 赞 量 收藏 量'), L('519 80 15 4'), L('点 赞 收藏 量 19 / 预 估 转 化 15 ~ 51', 40)]]);
    expect(r.fields.result).toMatchObject({ status: 'ok', value: 19 });
  });
  it('a reading that does not add up stays to check', () => {
    const r = parseAdOrder([[L('推广 目标 点 赞 收藏 量'), L('曝光 量 阅读 量 点 赞 量 收藏 量'), L('519 80 15 4'), L('点 赞 收藏 量 18 / 预 估 转 化 15 ~ 51', 40)]]);
    expect(r.fields.result.status).toBe('check');
  });
});

describe('audience: guessed names and carried charts', () => {
  const W = (text, x0, x1, y, conf = 90) => ({ text, confidence: conf, bbox: { x0, y0: y, x1, y1: y + 30 } });
  const row = (label, v, y) => ({ words: [W(label, 89, 156, y), W('国', 189, 400, y, 0), W(v, 990, 1089, y)] });
  it('a tie ("汽南" → 海南/河南/湖南) is not confirmed even when the shares add up', () => {
    const r = parseAdOrder([[{ words: [W('城市分布', 88, 252, 0)] }, row('汽南', '25.6%', 100), row('北京', '30.0%', 200), row('其他', '44.4%', 300)]]);
    const [k, v] = Object.entries(r.audience.city)[0];
    expect(k).toBe('#1');
    expect(v.guessName).toBeTruthy();
  });
  it('a chart continues on the next screenshot below its title bar; the status bar and repeated rows are ignored', () => {
    const shot1 = [{ words: [W('观众兴趣分布', 88, 335, 0)] }, row('美食', '80.0%', 100), row('旅游', '70.0%', 200)];
    const shot2 = [{ words: [W('10:17', 128, 248, 0), W('53', 1000, 1060, 0)] }, { words: [W('订单详情', 491, 686, 50)] }, row('旅游', '70.0%', 100), row('=¢', '60.0%', 200), row('体育运动', '50.0%', 300)];
    const r = parseAdOrder([shot1, shot2]);
    expect(Object.keys(r.audience.interest)).toEqual(['美食', '旅游', '#3', '体育运动']);
  });
});

describe('logic review fixes', () => {
  it('a memo with a different D+n is never replaced automatically (memo D+1 60 vs order D+10 60)', async () => {
    const { memoToReplace } = await import('../src/xhs/ad-orders.js');
    const post = normalizePost({ id: 'z', date: '2026-08-05', ads: [{ stage: 'D+1', spend: 60, sourceText: '진행(60元)' }] });
    expect(memoToReplace(post, normalizeAd({ stage: 'D+10', spend: 60 }))).toBeNull();
    expect(memoToReplace(post, normalizeAd({ stage: 'D+1', spend: 85 }))?.stage).toBe('D+1');
    const noStage = normalizePost({ id: 'y', date: '2026-08-05', ads: [{ spend: 60, sourceText: '60元' }] });
    expect(memoToReplace(noStage, normalizeAd({ stage: 'D+3', spend: 60 }))).not.toBeNull();
  });
  it('D+n on load uses the screenshot publish time like saving does', () => {
    const p = normalizePost({ date: '2026-07-27', ads: [{ start: '2026-07-27T09:20', notePublishedAt: '2026-07-26T19:20', spend: 60 }] });
    expect(p.ads[0].stage).toBe('D+1');
  });
  it('warns when a post with an ad on day D still has a valid D+1', () => {
    const posts = [normalizePost({ id: 'v', title: 'V', date: '2026-01-01', validity: '유효', ads: [{ start: '2026-01-01T20:00', spend: 50 }] })];
    expect(adComments(adOrders(posts)).map((c) => c.key)).toContain('validityD');
  });
  it('per post: ad results from the order reports, for any D+n; memo-only ads are counted as missing reports', async () => {
    const { postRows } = await import('../src/xhs/ad-report.js');
    const p = normalizePost({ id: 'r', date: '2026-02-01', ads: [{ stage: 'D+2', spend: 60, order: { reads: 120, likes: 10, favorites: 2, follows: 1 } }, { stage: 'D+1', spend: 60, sourceText: '진행(60元)' }] });
    const [row] = postRows([p]);
    expect(row).toMatchObject({ reports: 1, missingReports: 1, reads: 120, likeFav: 12, follows: 1, perRead: 0.5 });
  });
});

describe('orders without expanded details (no start time, no 实付)', () => {
  it('replace the only memo, keep its D+n, and split consumed into memo money + credit', () => {
    const ps = [normalizePost({ id: 'w', title: 'W', date: '2026-08-30', ads: [{ stage: 'D+2', spend: 60, sourceText: '진행(60元)' }] })];
    const entries = orderAds({ values: { spend: 95, goal: '关注', follows: 20, result: 26 }, postIds: ['w'], posts: ps });
    expect(entries[0].ad.stage).toBe('');
    placeOrder(ps, entries);
    expect(ps[0].ads).toHaveLength(1);
    expect(ps[0].ads[0]).toMatchObject({ stage: 'D+2', spend: 60, credit: 35, sourceText: '진행(60元)' });
    expect(adTotals(ps)).toMatchObject({ spend: 60, credit: 35 });
  });
  it('reads "粉丝关注量 26 效果良好 / 预估转化 7~43" as a 关注 order', () => {
    const r = parseAdOrder([[L('粉丝 关注 量 26 效果 良好 / 预 估 转 化 7 ~ 43')]]);
    expect(r.fields.goal.value).toBe('关注');
    expect(r.fields.result.value).toBe(26);
    expect(r.fields.estimate.value).toEqual([7, 43]);
  });
  it('the status bar above the title bar is not the note title', () => {
    const r = parseAdOrder([[L('10:38 六 HH 95 |'), L('订单 详情'), L('韩国人 在 海南 | 万宁 看海vlog')]]);
    expect(r.fields.title.candidate).toContain('万宁');
  });
});

describe('result and report counts must agree', () => {
  it('关注 order: result 26 but 新增关注 read as 20 → neither is trusted', () => {
    const r = parseAdOrder([[L('推广 目标 粉丝 关注 量'), L('评论 量 新 增 关注 主页 浏览 私信 开口'), L('2 20 99 0'), L('粉丝 关注 量 26 效果 良好 / 预 估 转 化 7 ~ 43')]]);
    expect(r.fields.follows).toMatchObject({ status: 'check', candidate: 20, reason: 'mismatch' });
    expect(r.fields.result).toMatchObject({ status: 'check', candidate: 26, reason: 'mismatch' });
    expect(r.fields.follows.at.word).toBeTruthy(); // the word box, for a second reading
  });
  it('agreeing counts stay confirmed', () => {
    const r = parseAdOrder([[L('推广 目标 粉丝 关注 量'), L('评论 量 新 增 关注 主页 浏览 私信 开口'), L('2 26 99 0'), L('粉丝 关注 量 26 / 预 估 转 化 7 ~ 43')]]);
    expect(r.fields.follows).toMatchObject({ status: 'ok', value: 26 });
    expect(r.fields.result).toMatchObject({ status: 'ok', value: 26 });
  });
});

describe('one order captured twice (collapsed + expanded details)', () => {
  it('groups with the same publish time and no conflicting values are merged; different orders are not', async () => {
    const { mergeOrderGroups } = await import('../src/xhs/ad-orders.js');
    const collapsed = [[L('本 订单 共 推 广 1 篇 笔记 。'), L('发 布 时 间 : 2026-08-30 19:20:05'), L('曝光 量 阅读 量 点 赞 量 收藏 量'), L('1729 256 18 7')]];
    const expanded = [[L('本 订单 共 推 广 1 篇 笔记 。'), L('发 布 时 间 : 2026-08-30 19:20:05'), L('下 单 时间 2026-09-01 09:03'), L('订单 金额 95 元'), L('实 付 金 额 60 元'), L('优惠 金额 35 元')]];
    const other = [[L('本 订单 共 推 广 1 篇 笔记 。'), L('发 布 时 间 : 2026-08-30 19:20:05'), L('曝光 量 阅读 量 点 赞 量 收藏 量'), L('900 100 9 1')]];
    const fieldsOf = (g) => parseAdOrder(g).fields;
    expect(mergeOrderGroups([collapsed, expanded], fieldsOf)).toHaveLength(1);
    expect(mergeOrderGroups([collapsed, other], fieldsOf)).toHaveLength(2); // different report numbers: another order
  });
  it('real money = 订单金额 − 优惠金额 when 实付 is missing', () => {
    expect(splitMoney({ spend: 95, orderAmount: 95, discount: 35 })).toEqual({ money: 60, credit: 35 });
  });
});

describe('more wording of order screens', () => {
  it('粉丝关注量 goal, a long badge before "/", and "的同类订单"', () => {
    const r = parseAdOrder([[L('推广 目标 粉丝 关注 量'), L('效果 极 好 ， 涨 粉 率 超过 60% 的 同类 订单'), L('粉丝 关注 量 36 [效果 极 好 ] | / 预 估 转 化 6 ~ 29'), L('超额 获 赠 7')]]);
    expect(r.fields.goal.value).toBe('关注');
    expect(r.fields.result.value ?? r.fields.result.candidate).toBe(36);
    expect(r.fields.estimate.value).toEqual([6, 29]);
    expect(r.fields.beatPct.value).toBe(0.6);
    expect(r.fields.result).toMatchObject({ status: 'ok', value: 36 }); // 36 − 29 = bonus 7
  });
  it('"成本领先 N% 的同类订单"', () => {
    const r = parseAdOrder([[L('效果 极 好 ， 成本 领先 70% 的 同类 订单')]]);
    expect(r.fields.beatPct.value).toBe(0.7);
  });
});

describe('a multi-note order captured in several screenshots (no publish time)', () => {
  it('groups with the same 下单时间 and no conflicting values are one order', async () => {
    const { mergeOrderGroups } = await import('../src/xhs/ad-orders.js');
    const head = [[L('本 订单 共 推 广 3 篇 笔记 。'), L('下 单 时间 2026-05-02 21:10'), L('推广 目标 粉丝 关注 量')]];
    const money = [[L('下 单 时间 2026-05-02 21:10'), L('订单 金额 30 元'), L('实 付 金 额 30 元')]];
    const report = [[L('曝光 量 阅读 量 点 赞 量 收藏 量'), L('700 120 11 3')]];
    const other = [[L('本 订单 共 推 广 3 篇 笔记 。'), L('下 单 时间 2026-05-09 08:00')]];
    const fieldsOf = (g) => parseAdOrder(g).fields;
    expect(mergeOrderGroups([head, money], fieldsOf)).toHaveLength(1);
    expect(mergeOrderGroups([head, other], fieldsOf)).toHaveLength(2);
    expect(mergeOrderGroups([head, money, report], fieldsOf).length).toBeLessThanOrEqual(2);
  });
});

describe('result line without its "/"', () => {
  it('"粉丝关注量 36 效果极好 | 预估转化 6~29" is read', () => {
    const r = parseAdOrder([[L('粉丝 关注 量 36 效果 极 好 | 预 估 转 化 6 ~ 29')]]);
    expect(r.fields.result.value ?? r.fields.result.candidate).toBe(36);
  });
  it('no result line at all: 29 + 超额获赠 7 = 36, confirmed by 新增关注 36', () => {
    const r = parseAdOrder([[L('推广 目标 粉丝 关注 量'), L('预 估 转 化 6~29 个 粉丝 关注 量'), L('超额 获 赠 7', 40), L('评论 量 新 增 关注 主页 浏览 私信 开口'), L('1 36 80 0')]]);
    expect(r.fields.result).toMatchObject({ status: 'ok', value: 36 });
    expect(r.fields.bonus).toMatchObject({ status: 'ok', value: 7 });
  });
});

describe('fixed layouts fill in labels that were not read', () => {
  const A = (label, value, conf = 90) => ({ words: [{ text: label, confidence: 90, bbox: { x0: 70, y0: 0, x1: 160, y1: 20 } }, { text: '国', confidence: 0, bbox: { x0: 190, y0: 0, x1: 400, y1: 20 } }, { text: value, confidence: conf, bbox: { x0: 780, y0: 0, x1: 850, y1: 20 } }] });
  it('a report row with one unreadable label ("REBE" for 点赞量) still has four values in place', () => {
    const r = parseAdOrder([[L('曝光 量 阅读 量 REBE 收藏 量'), L('1,571 313 31 5')]]);
    expect(['exposure', 'reads', 'likes', 'favorites'].map((k) => r.fields[k].value)).toEqual([1571, 313, 31, 5]);
  });
  it('an unreadable age label ("sot") is the row after the one above it', () => {
    const r = parseAdOrder([[L('年 龄 分 布'), A('18以下', '2.6%'), A('18~23', '5.6%'), A('24~30', '22.6%'), A('31~40', '48.5%'), A('41~50', '18.4%'), A('sot', '2.3%')]]);
    expect(Object.keys(r.audience.age)).toEqual(['18以下', '18~23', '24~30', '31~40', '41~50', '50以上']);
    expect(r.audience.age['50以上']).toMatchObject({ status: 'ok', value: 0.023 });
  });
  it('an interest share without its dot ("371%") is confirmed when it fits the descending order', () => {
    const r = parseAdOrder([[L('观众 兴趣 分 布'), A('时尚', '45.4%'), A('情感', '44.1%'), A('资讯', '371%', 70)]]);
    expect(r.audience.interest['资讯']).toMatchObject({ status: 'ok', value: 0.371 });
  });
});

describe('ad history: one entry per order', () => {
  it('a multi-note order is one entry with its notes; entries are newest first', async () => {
    const { historyEntries } = await import('../src/xhs/ad-report.js');
    const g = (id, spend) => normalizeAd({ id, groupKey: 'G1', noteCount: 2, orderSpend: 40, spend, allocation: 'equal', start: '2026-05-02T21:10', order: { reads: 300, follows: 20 } });
    const posts = [
      { id: 'p1', title: 'A', date: '2026-04-01', ads: [g('a1', 20), normalizeAd({ id: 'a2', start: '2026-04-02T10:00', spend: 30 })] },
      { id: 'p2', title: 'B', date: '2026-04-20', ads: [g('b1', 20)] },
    ];
    const h = historyEntries(posts);
    expect(h.map((e) => [e.multi, e.items.length, e.spend])).toEqual([[true, 2, 40], [false, 1, 30]]);
    expect(h[0].items.map((x) => x.p.id)).toEqual(['p2', 'p1']);
  });
});

describe('interest chart read on two screenshots', () => {
  // Rows 100px apart on a 1090px-wide capture, like the real order screen.
  const Y = (label, value, y, conf = 90) => ({ words: [{ text: label, confidence: 90, bbox: { x0: 89, y0: y, x1: 160, y1: y + 33 } }, { text: '国', confidence: 0, bbox: { x0: 264, y0: y - 10, x1: 600, y1: y + 40 } }, { text: value, confidence: conf, bbox: { x0: 990, y0: y, x1: 1090, y1: y + 28 } }] });
  const H = (text, y) => ({ words: text.split(' ').map((w, i) => ({ text: w, confidence: 95, bbox: { x0: 89 + i * 80, y0: y, x1: 160 + i * 80, y1: y + 37 } })) });
  it('rows of a heading shown again are the same rows, not new ones; regions above it stay regions', async () => {
    const { parseAdOrder } = await import('../src/xhs/ocr-ad-parse.js');
    const shot1 = [H('城市 分 布', 1170), Y('海南', '70.4%', 1276), Y('浙江', '1.8%', 1376), Y('其他', '27.8%', 1476), H('观众 兴趣 分 布', 1941), Y('生活记录', '99.2%', 2048), Y('娱乐', '96.0%', 2148)];
    const shot2 = [Y('浙江', '1.8%', 369), Y('其他', '27.8%', 470), H('观众 兴趣 分 布', 633), Y('二次元', '99.2%', 739), Y('娱乐', '96.0%', 839), Y('影视', '88.5%', 939), { words: [{ text: '关廊', confidence: 30, bbox: { x0: 88, y0: 1039, x1: 156, y1: 1072 } }, { text: 'zc', confidence: 16, bbox: { x0: 995, y0: 1041, x1: 1089, y1: 1069 } }] }];
    const r = parseAdOrder([shot1, shot2]);
    expect(Object.keys(r.audience.city)).toEqual(['海南', '浙江', '其他']);
    expect(Object.keys(r.audience.interest)).toEqual(['生活记录', '娱乐', '影视', '#4']);
    expect(r.audience.interest['#4']).toMatchObject({ status: 'check', candidate: null }); // read again from the image
  });
  it('a second reading that breaks the descending order is not confirmed', async () => {
    const { checkOrder } = await import('../src/xhs/ocr-ad-parse.js');
    const out = checkOrder({ 影视: { status: 'ok', value: 0.885, conf: 90 }, 二次元: { status: 'ok', value: 0.992, conf: 90, confirmedBy: 'reread' }, 宠物: { status: 'ok', value: 0.498, conf: 90 } });
    expect(out['二次元']).toMatchObject({ status: 'check', candidate: 0.992 });
    expect(out['影视'].status).toBe('ok');
  });
});

describe('single-note order screen: title, ages, names', () => {
  const A = (label, value, conf = 90) => ({ words: [{ text: label, confidence: 90, bbox: { x0: 70, y0: 0, x1: 160, y1: 20 } }, { text: '国', confidence: 0, bbox: { x0: 190, y0: 0, x1: 400, y1: 20 } }, { text: value, confidence: conf, bbox: { x0: 780, y0: 0, x1: 850, y1: 20 } }] });
  const W = (text, x0, x1) => ({ text, confidence: 90, bbox: { x0, y0: 0, x1, y1: 30 } });
  it('a title without "vlog" is read right of the thumbnail, not from an age row "18以下 | 10%"', async () => {
    const { parseAdOrder } = await import('../src/xhs/ocr-ad-parse.js');
    const r = parseAdOrder([[L('订单 详情'), L('本 订单 共 推 广 1 篇 笔记 。'), { words: [W('—', 135, 173), W('韩国人在海南', 266, 495), W('布置新家、10h上', 562, 826)] }, { words: [W('上', 87, 175), W('海旅行', 278, 373)] }, { words: [W('笔记', 276, 329), W('作者', 330, 384)] }, L('发 布 时 间 : 2026-09-27 19:20:06'), L('订单 信息'), L('年 龄 分 布'), A('18以下|', '10%')]]);
    expect(r.fields.title.candidate).toBe('韩国人在海南布置新家、10h上海旅行');
  });
  it('one age lost its first digit ("1.3%" for 11.3%) and the six add up to 99.9%', async () => {
    const { parseAdOrder } = await import('../src/xhs/ocr-ad-parse.js');
    const r = parseAdOrder([[L('年 龄 分 布'), A('18以下', '10%', 75), A('18~23', '41%', 72), A('24~30', '25.8%', 64), A('31~40', '53.6%'), A('41~50', '1.3%', 54), A('50以上', '41%6', 66)]]);
    expect(Object.values(r.audience.age).map((x) => [x.status, x.value])).toEqual([['ok', 0.01], ['ok', 0.041], ['ok', 0.258], ['ok', 0.536], ['ok', 0.113], ['ok', 0.041]]);
  });
  it('a longer interest name with one character misread wins over the short one inside it', async () => {
    const { nameGuess } = await import('../src/xhs/ocr-ad-parse.js');
    expect(nameGuess('家居家关', 'interest')).toEqual({ name: '家居家装', sure: true });
    expect(nameGuess('家居', 'interest')).toEqual({ name: '家居', sure: true });
  });
});

describe('overlapping screenshots and a used-up budget', () => {
  const A = (label, value, carriedImg) => ({ words: [{ text: label, confidence: 90, bbox: { x0: 70, y0: 0, x1: 160, y1: 20 } }, { text: '国', confidence: 0, bbox: { x0: 190, y0: 0, x1: 400, y1: 20 } }, { text: value, confidence: 80, bbox: { x0: 780, y0: 0, x1: 850, y1: 20 } }] });
  it('an unnamed last region and the same row carried onto the next screenshot are one row (其他)', async () => {
    const { parseAdOrder } = await import('../src/xhs/ocr-ad-parse.js');
    const shot1 = [L('订单 详情'), L('城市 分 布'), A('广东', '13.0%'), A('上海', '12.4%'), A('浙江', '9.9%'), A('江苏', '6.8%'), A('北京', '6.8%'), A('其', '51196')];
    const shot2 = [L('订单 详情'), A('北京', '6.8%'), A('其他', '511%'), L('观众 兴趣 分 布'), A('美食', '79.5%')];
    const r = parseAdOrder([shot1, shot2]);
    expect(Object.entries(r.audience.city).map(([k, v]) => [k, v.status, v.value])).toEqual([['广东', 'ok', 0.13], ['上海', 'ok', 0.124], ['浙江', 'ok', 0.099], ['江苏', 'ok', 0.068], ['北京', 'ok', 0.068], ['其他', 'ok', 0.511]]);
  });
  it('"已完成全部预算消耗" + 订单金额 95: a noisy consumed line "985195" is 95', async () => {
    const { parseAdOrder } = await import('../src/xhs/ocr-ad-parse.js');
    const r = parseAdOrder([[L('已 完成 全 部 预算 消耗 ， 推 广 结束'), L('订单 金额 95 元'), L('实 付 金 额 60 元'), L('当前 已 消耗 金额 @ 985195 元')]]);
    expect(r.fields.spend).toMatchObject({ status: 'ok', value: 95 });
  });
});
