// Verifies the production build works under the GitHub Pages sub-path.
// Usage: npm run build && npm run check:dist
import { existsSync, readFileSync } from 'node:fs';

const base = process.env.BASE_PATH ?? '/vlog-studio/';
const errors = [];
const check = (ok, msg) => ok || errors.push(msg);
const read = (f) => readFileSync(`dist/${f}`, 'utf8');

check(existsSync('dist/index.html'), 'dist/index.html missing');
const html = read('index.html');
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = m[1];
  if (/^(https?:|data:|#)/.test(url)) continue;
  check(url.startsWith(base), `index.html references ${url} outside ${base}`);
  const file = url.slice(base.length);
  check(existsSync(`dist/${file}`), `index.html references missing file ${url}`);
}
check(html.includes(`${base}manifest.webmanifest`), 'manifest link missing');
check(html.includes('apple-touch-icon'), 'apple-touch-icon link missing');

const manifest = JSON.parse(read('manifest.webmanifest'));
check(manifest.display === 'standalone', 'manifest display is not standalone');
check(manifest.start_url === base && manifest.scope === base, 'manifest start_url/scope do not match base');
for (const size of ['192x192', '512x512']) {
  const icon = manifest.icons.find((i) => i.sizes === size);
  check(icon && existsSync(`dist/${icon.src}`), `manifest icon ${size} missing`);
}
check(manifest.icons.some((i) => i.purpose === 'maskable'), 'maskable icon missing');

check(existsSync('dist/sw.js'), 'service worker missing');
const sw = read('sw.js');
check(sw.includes(`"${base}index.html"`), 'SW navigation fallback is not under base');
check(sw.includes('"index.html"') && /assets\/index-[\w-]+\.js/.test(sw), 'SW does not precache the app shell');

if (errors.length) {
  console.error(`✗ dist check failed:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ dist is valid for base ${base} (assets, manifest, icons, service worker)`);
