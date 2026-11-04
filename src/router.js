import { flushAll } from './data/autosave.js';

// Hash routing (#/p/<id>/plan) keeps GitHub Pages from returning 404 on deep links.

const routes = [];
let current = null;
let token = 0;

export function route(pattern, handler) {
  routes.push({ pattern, handler });
}

export const currentPath = () => decodeURI(location.hash.replace(/^#/, '')) || '/';

export function navigate(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (replace) {
    history.replaceState(null, '', hash);
    resolve();
  } else if (location.hash === hash) {
    resolve();
  } else {
    location.hash = hash;
  }
}

async function resolve() {
  const mine = ++token;
  // Never lose typing: pending autosaves are written before the next screen loads.
  await flushAll().catch(() => {});
  if (mine !== token) return;
  // Runs before the next view renders (and scrolls), e.g. to remember the list position.
  current?.leave?.();
  const path = currentPath();
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (!m) continue;
    const ctx = { isCurrent: () => mine === token, previous: current };
    const view = await r.handler(m.slice(1).map((s) => (s === undefined ? undefined : decodeURIComponent(s))), ctx);
    if (mine !== token) {
      if (view !== current) view?.destroy?.();
      return;
    }
    if (current && current !== view) current.destroy?.();
    current = view ?? null;
    return;
  }
  navigate('/', { replace: true });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
