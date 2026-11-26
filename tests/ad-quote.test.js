import { afterEach, describe, expect, it } from 'vitest';
import { applyLang } from '../src/i18n/index.js';
import { estimateAccuracy, quoteOutcome } from '../src/xhs/ad-sim.js';
import { parseAdQuote, rangeOf } from '../src/xhs/ocr-ad-quote.js';
import { normalizeAdQuote, normalizePost } from '../src/xhs/store.js';
import { nowCst, quotesHtml } from '../src/views/xhs/ad-quote.js';
import { adSimHtml } from '../src/views/xhs/ad-sim.js';

// Fictional numbers only, shaped like OCR of the 薯条 payment screen (spaces between characters).
afterEach(() => applyLang('ko'));

const w = (text, x0, x1 = x0 + 60) => ({ text, confidence: 90, bbox: { x0, x1, y0: 0, y1: 10 } });
const line = (...words) => ({ text: words.map((x) => x.text).join(' '), words });
const settings = {
  lines: [
    line(w('推广', 70), w('设置', 140)),
    line(w('预计', 110), w('提升', 170), w('粉丝', 236), w('关注', 288), w('量', 341), w('预计', 484), w('提升', 546), w('粉丝', 609), w('关注', 662), w('量', 715)),
    line(w('7~31', 111, 242), w('20', 484, 530), w('~', 553, 569), w('90', 591, 626), w('7', 858, 882)),
    line(w('(', 128), w('含', 168), w('赠', 184), w('0~3)', 204, 259)),
    line(w('¥80', 109, 172), w('Y90', 183, 239), w('¥200', 483, 564), w('¥260', 575, 647), w('¥é', 856, 893)),
    line(w('推广', 70), w('多', 130), w('久', 150), w('®', 200), w('12', 613), w('小', 650), w('时', 680), w('(推荐', 700), w(')', 760)),
    line(w('预计', 40), w('提升', 100), w('转化', 160), w('数', 220), w('7-31，', 288), w('未', 400)),
    line(w('实', 40), w('付', 60), w('现金', 80), w('(元', 140), w(')', 170), w('E—', 200)),
    line(w('80', 40), w('已', 140), w('赠', 160), w('8', 180), w('元', 200), w('流量', 220)),
  ],
};
const payment = { lines: [line(w('推广', 70), w('总', 120), w('金额', 140), w('80', 772), w('元', 820)), line(w('总', 70), w('计', 90), w('80元', 775))] };

describe('parseAdQuote', () => {
  it('reads the estimate, the cards, payment, bonus traffic and duration', () => {
    const q = parseAdQuote([settings, payment]);
    expect(q).toMatchObject({ goal: '关注', estimate: [7, 31], bonusEstimate: [0, 3], pay: 80, total: 80, credit: 8, hours: 12 });
    expect(q.options).toEqual([
      { estimate: [7, 31], price: 80, listPrice: 90, bonus: [0, 3] },
      { estimate: [20, 90], price: 200, listPrice: 260, bonus: null },
    ]);
    expect(q.checks).toEqual({ payMatchesTotal: true, payMatchesCard: true });
  });
  it('leaves what is not on the screen empty', () => {
    const q = parseAdQuote([{ lines: [line(w('预计提升转化数', 40), w('3-9', 300))] }]);
    expect(q).toMatchObject({ estimate: [3, 9], pay: null, credit: null, hours: null, goal: '', options: [] });
    expect(parseAdQuote([{ lines: [line(w('nothing', 0))] }]).estimate).toBeNull();
  });
  it('reads ranges with either dash and rejects reversed ones', () => {
    expect(rangeOf('5 ～ 25')).toEqual([5, 25]);
    expect(rangeOf('5—25')).toEqual([5, 25]);
    expect(rangeOf('25-5')).toBeNull();
  });
});

describe('stored quotes', () => {
  it('normalises and drops readings without an estimate', () => {
    expect(normalizeAdQuote({ estimate: [9, 3] })).toBeNull();
    const q = normalizeAdQuote({ stage: 'D+1', estimate: [7, 31], pay: 80, decision: 'maybe', options: [{ estimate: [1, 2], price: 'x' }] });
    expect(q).toMatchObject({ stage: 'D+1', estimate: [7, 31], pay: 80, credit: null, decision: '', options: [{ estimate: [1, 2], price: null }] });
    expect(normalizePost({ adQuotes: [{ estimate: [1, 2] }, null] }).adQuotes).toHaveLength(1);
  });
  it('writes China Standard Time', () => {
    expect(nowCst(Date.UTC(2026, 0, 1, 20, 30))).toBe('2026-01-02T04:30:00+08:00');
  });
});

let n = 0;
const order = (date, spend, follows, extra = {}) => ({ id: `a${++n}`, orderNo: `T${n}`, stage: 'D+1', start: `${date}T20:00`, goal: '关注', spend, order: { follows }, ...extra });
const post = (ads, extra = {}) => normalizePost({ id: `p${++n}`, date: '2026-01-01', validity: '유효', ads, ...extra });

describe('estimateAccuracy', () => {
  it('checks the platform estimate and the simulator from earlier orders only', () => {
    const posts = [post([order('2026-01-01', 40, 20, { estimate: [5, 25], goalResult: 22 })]), post([order('2026-01-05', 40, 4, { estimate: [10, 30], goalResult: 4 })]), post([order('2026-01-09', 40, 30, { estimate: [5, 20], goalResult: 30 })])];
    const acc = estimateAccuracy(posts);
    expect(acc.platform).toMatchObject({ n: 3, in: 1, below: 1, above: 1 });
    // First order has nothing before it; the second is judged by the first only (rate 0.5 → 20).
    expect(acc.rows[0].sim).toBeNull();
    expect(acc.rows[1].sim).toMatchObject({ range: [20, 20], actual: 4, where: 'below', basedOn: 1 });
    expect(acc.sim.n).toBe(2);
  });
});

describe('quoteOutcome', () => {
  it('links a bought quote to the same-stage 关注 order of the post', () => {
    const p = post([order('2026-01-05', 80, 12, { goalResult: 35 })], { adQuotes: [{ stage: 'D+1', capturedAt: '2026-01-05T18:00:00+08:00', estimate: [7, 31], pay: 80, credit: 8, decision: 'bought' }] });
    const earlier = post([order('2026-01-01', 40, 20)]);
    const o = quoteOutcome(p, p.adQuotes[0], [p, earlier]);
    expect(o).toMatchObject({ bought: true, actual: 35, where: 'above' });
    expect(o.sim).toMatchObject({ range: [44, 44], basedOn: 1 }); // (80 + 8) × 0.5
  });
  it('keeps a skipped quote as a record only', () => {
    const p = post([], { adQuotes: [{ stage: 'D+2', capturedAt: '2026-01-05T18:00:00+08:00', estimate: [7, 31], pay: 80, decision: 'skipped' }] });
    expect(quoteOutcome(p, p.adQuotes[0], [p])).toMatchObject({ bought: false, actual: null, where: null, sim: null });
  });
});

describe('text', () => {
  it.each(['ko', 'en', 'zh'])('renders quotes and accuracy without raw keys in %s', (lang) => {
    applyLang(lang);
    const p = post([order('2026-01-05', 80, 12, { goalResult: 35, estimate: [7, 31] })], { adQuotes: [{ stage: 'D+1', capturedAt: '2026-01-05T18:00:00+08:00', estimate: [7, 31], pay: 80, decision: 'bought' }] });
    const posts = [p, post([order('2026-01-01', 40, 20, { estimate: [5, 25], goalResult: 20 })])];
    expect(quotesHtml(p, posts)).not.toMatch(/\baq\.[a-z]/);
    expect(adSimHtml(posts)).not.toMatch(/\bsim\.[a-z]/);
    expect(adSimHtml(posts)).toContain('<tbody><tr><td>');
  });
});
