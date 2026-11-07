import { describe, expect, it } from 'vitest';
import { metricLines, noteExtras } from '../src/xhs/ocr-note.js';
import { extractMetrics } from '../src/xhs/ocr-parse.js';

// A line of words laid out left to right at height y.
const L = (y, ...words) => ({ words: words.map(([text, x0, x1], i) => ({ text, confidence: 92, bbox: { x0: x0 ?? i * 120, y0: y, x1: x1 ?? i * 120 + 100, y1: y + 30 } })) });

describe('note analysis screens', () => {
  it('a traffic channel block and a comment screen are not read as the note metrics', () => {
    const channel = [L(300, ['首页推荐', 100, 300], ['65.8%', 400, 520]), L(1130, ['此渠道详细数据', 130, 440]), L(1800, ['曝光数', 160, 270], ['1294', 420, 500], ['观看数', 620, 740], ['127', 890, 950])];
    expect(Object.keys(extractMetrics(metricLines(channel)).values)).toEqual([]);
    const comments = [L(800, ['评论', 40, 160], ['2', 160, 180], ['赞和收藏', 230, 390], ['23', 400, 450]), L(2340, ['留下你的想法吧', 100, 390])];
    expect(metricLines(comments)).toEqual([]);
  });
  it('title, publish time ("昨天 19:21" against the data date), peer rank, sources, audience', () => {
    const header = [L(180, ['笔记分析详情', 440, 740]), L(300, ['韩国', 75, 160], ['vlog', 170, 230], ['|', 240, 250], ['全州韩屋村一日游', 260, 880])];
    const popup = [L(712, ['开头吸引力', 50, 230]), L(998, ['5秒完播率', 130, 312], ['同类中位数', 499, 680], ['超过同类笔记', 846, 1000]), L(1072, ['42.9%', 173, 270], ['43.6%', 540, 638], ['48%', 913, 1002])];
    const sources = [L(530, ['首页推荐', 196, 333], ['65.8%', 415, 529]), L(784, ['搜索', 188, 258], ['2.6%', 433, 521])];
    const audience = [L(811, ['观众画像', 100, 294], ['数据更新至', 675, 871], ['11-07', 874, 965], ['07:00', 981, 1078]), L(444, ['性别分布', 99, 269]), L(600, ['男性', 138, 208], ['16%', 223, 294], ['女性', 914, 984], ['84%', 999, 1077]), L(700, ['年龄分布', 100, 271]), L(983, ['25-34', 140, 247], ['人', 274, 936], ['43%', 1000, 1077])];
    const comment = [L(800, ['评论', 40, 160], ['2', 160, 180]), L(1607, ['#韩国旅游', 190, 380]), L(1837, ['昨天', 192, 257], ['19:21', 278, 354], ['海南', 375, 440]), L(2127, ['昨天', 196, 265], ['19:38', 283, 379]), L(2340, ['留下你的想法吧', 100, 390])];
    const x = noteExtras([header, popup, sources, audience, comment], { year: 2026 });
    expect(x).toMatchObject({ title: '韩国vlog | 全州韩屋村一日游', publishedAt: '2026-11-06T19:21', snapshotAt: '2026-11-07T00:00', snapshotDerived: true });
    expect(x.peer.retain5s).toEqual({ value: 0.429, median: 0.436, beat: 0.48 });
    expect(x.sources).toMatchObject({ home: 0.658, search: 0.026 });
    expect(x.audience.gender).toEqual({ male: 0.16, female: 0.84 });
    expect(x.audience.age['25-34']).toBe(0.43);
  });
});
