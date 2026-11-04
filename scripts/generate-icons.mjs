// Renders the app icons as PNGs with no image dependencies (zlib only).
// Usage: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG_TOP = [38, 38, 44];
const BG_BOTTOM = [16, 16, 19];
const FG = [246, 246, 244];
const REC = [255, 92, 77];

function crc32(buf) {
  let c;
  const table = (crc32.t ??= Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Viewfinder corner brackets around a record dot. `inset` shrinks artwork into the maskable safe zone. */
function artwork({ rounded, inset }) {
  const k = 1 - inset * 2;
  const T = (v) => inset + v * k;
  return (u, v) => {
    if (rounded && !inRoundRect(u, v, 0, 0, 1, 1, 0.225)) return [0, 0, 0, 0];
    const bg = [...mix(BG_TOP, BG_BOTTOM, v), 1];
    const ring = inRoundRect(u, v, T(0.2), T(0.2), T(0.8), T(0.8), 0.1 * k) &&
      !inRoundRect(u, v, T(0.25), T(0.25), T(0.75), T(0.75), 0.055 * k);
    const nearCorner = Math.abs(u - 0.5) > 0.15 * k && Math.abs(v - 0.5) > 0.15 * k;
    if (ring && nearCorner) return [...FG, 1];
    if (inCircle(u, v, 0.5, 0.5, 0.13 * k)) return [...REC, 1];
    return bg;
  };
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, artwork({ rounded: true, inset: 0 })));
writeFileSync('public/icons/icon-512.png', png(512, artwork({ rounded: true, inset: 0 })));
writeFileSync('public/icons/maskable-512.png', png(512, artwork({ rounded: false, inset: 0.1 })));
// iOS applies its own corner mask, so the touch icon is full-bleed.
writeFileSync('public/apple-touch-icon.png', png(180, artwork({ rounded: false, inset: 0.02 })));
console.log('icons written to public/');
