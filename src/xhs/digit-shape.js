/*
 * Checks a number OCR read against the shapes of its digits. Tesseract sometimes reads a clear
 * "86" as "80" with high confidence (thin app font). The holes of a digit tell them apart without
 * any guessing: 0 has one tall hole, 6 one hole in the lower half, 9 one in the upper half, 8 two,
 * and 1 2 3 5 7 none. Only the 0/6/8/9 family is corrected, and only when every digit is a
 * separate blob, so the result is either a confident correction or nothing.
 */

/** ink: Uint8Array(w*h), 1 = dark. Returns blobs left to right: { x0, x1, y0, y1, holes: [{cy, h}] }. */
export function glyphs(ink, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  const blobs = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!ink[i] || lab[i] >= 0) continue;
    const b = { x0: w, x1: -1, y0: h, y1: -1, n: 0, holes: [] };
    const id = blobs.length;
    blobs.push(b);
    lab[i] = id;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      b.n++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (ink[q] && lab[q] < 0) {
            lab[q] = id;
            stack.push(q);
          }
        }
    }
  }
  // Background regions not touching the border are holes; each belongs to the blob around it.
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (ink[i] || seen[i]) continue;
    let border = false;
    let y0 = h;
    let y1 = -1;
    let n = 0;
    let owner = -1;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      n++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (ink[q]) owner = lab[q];
        else if (!seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (!border && owner >= 0 && n >= 4) blobs[owner].holes.push({ y0, y1, n });
  }
  const big = Math.max(0, ...blobs.map((b) => b.y1 - b.y0 + 1));
  // Drop specks and commas (much shorter than a digit).
  return blobs
    .filter((b) => b.y1 - b.y0 + 1 >= big * 0.6)
    .sort((a, b) => a.x0 - b.x0)
    .map((b) => {
      const gh = b.y1 - b.y0 + 1;
      const holes = b.holes
        .filter((o) => o.n >= gh * gh * 0.004)
        .map((o) => ({ cy: ((o.y0 + o.y1) / 2 - b.y0) / gh, h: (o.y1 - o.y0 + 1) / gh }));
      return { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, holes };
    });
}

/** What the holes say a digit from the 0/6/8/9 family is, or null when they say nothing. */
export function holeDigit(g) {
  const hs = g.holes;
  if (hs.length === 2) return '8';
  if (hs.length !== 1) return null;
  const [o] = hs;
  if (o.h >= 0.55) return '0';
  if (o.cy >= 0.55) return '6';
  if (o.cy <= 0.45) return '9';
  return null;
}

/**
 * Returns the number the digit shapes support, or null when they cannot judge (blob count differs
 * from the digit count, or a digit of the 0/6/8/9 family has an unclear shape).
 */
export function shapeCheck(text, ink, w, h) {
  const digits = String(text).replace(/[^\d]/g, '');
  if (!digits) return null;
  const gs = glyphs(ink, w, h);
  if (gs.length !== digits.length) return null;
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const d = digits[i];
    if (!'0689'.includes(d)) {
      out += d;
      continue;
    }
    const s = holeDigit(gs[i]);
    if (!s) return null;
    out += s;
  }
  return Number(out);
}
