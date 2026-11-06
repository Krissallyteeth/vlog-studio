import { describe, expect, it } from 'vitest';
import { glyphs, shapeCheck } from '../src/xhs/digit-shape.js';

// Synthetic 7x9 glyphs ('#' = ink), joined with a blank column between digits.
const G = {
  0: ['.#####.', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####.'],
  6: ['.#####.', '##.....', '##.....', '######.', '##...##', '##...##', '##...##', '##...##', '.#####.'],
  8: ['.#####.', '##...##', '##...##', '.#####.', '##...##', '##...##', '##...##', '##...##', '.#####.'],
  9: ['.#####.', '##...##', '##...##', '##...##', '.######', '.....##', '.....##', '.....##', '.#####.'],
  1: ['...##..', '..###..', '...##..', '...##..', '...##..', '...##..', '...##..', '...##..', '..####.'],
};

function draw(str) {
  const rows = Array.from({ length: 11 }, () => '');
  for (const ch of str) {
    const g = G[ch];
    for (let y = 0; y < 11; y++) rows[y] += `.${y === 0 || y === 10 ? '.......' : g[y - 1]}`;
  }
  for (let y = 0; y < 11; y++) rows[y] += '.';
  const w = rows[0].length;
  const ink = new Uint8Array(w * 11);
  rows.forEach((r, y) => [...r].forEach((c, x) => (ink[y * w + x] = c === '#' ? 1 : 0)));
  return { ink, w, h: 11 };
}

describe('digit shapes', () => {
  it('finds one blob per digit with its holes', () => {
    const { ink, w, h } = draw('8061');
    const gs = glyphs(ink, w, h);
    expect(gs.map((g) => g.holes.length)).toEqual([2, 1, 1, 0]);
  });

  it('corrects 0 read for a 6 (the 86 → 80 case)', () => {
    const { ink, w, h } = draw('86');
    expect(shapeCheck('80', ink, w, h)).toBe(86);
  });

  it('confirms a correct read and tells 9 from 6', () => {
    const a = draw('906');
    expect(shapeCheck('906', a.ink, a.w, a.h)).toBe(906);
    expect(shapeCheck('600', a.ink, a.w, a.h)).toBe(906);
  });

  it('gives no answer when the blob count does not match the digits', () => {
    const { ink, w, h } = draw('86');
    expect(shapeCheck('806', ink, w, h)).toBeNull();
  });

  it('leaves digits outside the 0/6/8/9 family alone', () => {
    const { ink, w, h } = draw('16');
    expect(shapeCheck('10', ink, w, h)).toBe(16);
    expect(shapeCheck('76', ink, w, h)).toBe(76);
  });
});
