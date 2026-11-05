import { describe, expect, it } from 'vitest';
import { extractMetrics, mergeResults, parseNumber } from '../src/xhs/ocr-parse.js';

// Synthetic OCR output (word boxes), modelled on the card layout: value above label, and a
// label-then-value line. No real screenshot data.
const w = (text, x0, y0, conf = 95, wd = 14 * text.length, h = 20) => ({ text, confidence: conf, bbox: { x0, y0, x1: x0 + wd, y1: y0 + h } });
const chars = (s, x, y, conf) => [...s].map((c, i) => w(c, x + i * 16, y, conf, 15));

describe('number parsing', () => {
  it('handles percents, separators, 万 and durations', () => {
    expect(parseNumber('17.5%')).toEqual({ value: 0.175, unit: 'pct' });
    expect(parseNumber('1,669')).toEqual({ value: 1669, unit: 'plain' });
    expect(parseNumber('1.2万')).toMatchObject({ value: 12000, approx: true });
    expect(parseNumber('01:05')).toEqual({ value: 65, unit: 'sec' });
    expect(parseNumber('1分5秒')).toEqual({ value: 65, unit: 'sec' });
    expect(parseNumber('61.3秒')).toEqual({ value: 61.3, unit: 'sec' });
    expect(parseNumber('１７.５％')).toEqual({ value: 0.175, unit: 'pct' });
    expect(parseNumber('abc')).toBeNull();
  });
});

describe('label → value matching', () => {
  const lines = [
    { words: [w('1,669', 20, 100), w('537', 220, 100)] },
    { words: [...chars('曝光量', 20, 130), ...chars('观看数', 220, 130)] },
    { words: [...chars('封面点击率', 20, 200), w('17.5', 200, 200), w('%', 258, 200, 95, 12)] },
    { words: [...chars('5秒完播率', 20, 240), w('61.8%', 200, 240, 55)] }, // low confidence
    { words: [...chars('2秒退出率', 20, 280), w('17.6', 200, 280)] }, // percent sign missing
    { words: [...chars('全片完播率', 20, 320), w('5.4%', 200, 320)] },
    { words: [...chars('平均观看时长', 20, 360), w('61.3秒', 220, 360)] },
  ];
  const r = extractMetrics(lines);

  it('reads card values above labels and same-line values', () => {
    expect(r.values.exposure).toMatchObject({ status: 'ok', value: 1669 });
    expect(r.values.views).toMatchObject({ status: 'ok', value: 537 });
    expect(r.values.ctr).toMatchObject({ status: 'ok', value: 0.175 }); // "17.5" + "%" joined
    expect(r.values.completion).toMatchObject({ status: 'ok', value: 0.054 }); // not taken by 5秒完播率
    expect(r.values.avgWatch).toMatchObject({ status: 'ok', value: 61.3 });
  });

  it('never fills uncertain values: low confidence or wrong format → check', () => {
    expect(r.values.retain5s).toMatchObject({ status: 'check', candidate: 0.618, reason: 'confidence' });
    expect(r.values.retain5s.value).toBeUndefined();
    expect(r.values.exit2s).toMatchObject({ status: 'check', reason: 'format' });
    expect(r.values.likes).toBeUndefined();
  });

  it('flags different values for the same metric across screenshots', () => {
    const a = { values: { views: { status: 'ok', value: 537 }, ctr: { status: 'ok', value: 0.175 } } };
    const b = { values: { views: { status: 'ok', value: 573 }, ctr: { status: 'ok', value: 0.175 } } };
    const m = mergeResults([a, b]);
    expect(m.views.status).toBe('conflict');
    expect(m.views.options.map((o) => o.value)).toEqual([537, 573]);
    expect(m.ctr).toMatchObject({ status: 'ok', value: 0.175 });
  });
});
