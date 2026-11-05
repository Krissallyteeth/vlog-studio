import { esc } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n/index.js';

/** Replaces the screen with a fresh root element, so listeners never leak between views. */
export function mount(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.getElementById('app').replaceChildren(root);
  return root;
}

/** Fixed bottom navigation. items: [{ id, label, zh?, icon, href }] */
export function bottomNav(items, activeId) {
  return `
    <nav class="bottom-nav" aria-label="${esc(t('nav.main'))}">
      <div class="bottom-nav-inner" style="grid-template-columns: repeat(${items.length}, minmax(0, 1fr))">
        ${items
          .map(
            (it) => `
          <a href="${it.href}" class="nav-item ${it.id === activeId ? 'is-active' : ''}" ${it.id === activeId ? 'aria-current="page"' : ''} data-nav="${esc(it.id)}">
            ${icon(it.icon, 'size-[22px]')}
            <span class="nav-label">${esc(it.label)}</span>
          </a>`,
          )
          .join('')}
      </div>
    </nav>`;
}

/** App-level menu: planning, content list, 小红书 dashboard, Excel-style data, more (OCR, ads, backup). */
export const HOME_NAV = [
  { id: 'home', get label() { return t('nav.plan'); }, icon: 'idea', href: '#/' },
  { id: 'contents', get label() { return t('nav.contents'); }, icon: 'list', href: '#/contents' },
  { id: 'xhs', get label() { return t('nav.dashboard'); }, icon: 'chart', href: '#/xhs' },
  { id: 'data', get label() { return t('nav.data'); }, icon: 'table', href: '#/data' },
  { id: 'more', get label() { return t('nav.more'); }, icon: 'more', href: '#/more' },
];


export function offlineBadge() {
  return navigator.onLine === false
    ? `<span class="pill pill-muted" title="${esc(t('offline.title'))}">${icon('offline', 'size-3.5')}${esc(t('offline.badge'))}</span>`
    : '';
}
