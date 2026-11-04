import { esc } from './dom.js';
import { icon } from './icons.js';

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
    <nav class="bottom-nav" aria-label="주요 메뉴">
      <div class="bottom-nav-inner" style="grid-template-columns: repeat(${items.length}, minmax(0, 1fr))">
        ${items
          .map(
            (it) => `
          <a href="${it.href}" class="nav-item ${it.id === activeId ? 'is-active' : ''}" ${it.id === activeId ? 'aria-current="page"' : ''} data-nav="${esc(it.id)}">
            ${icon(it.icon, 'size-[22px]')}
            <span class="nav-label">${esc(it.label)}</span>
            ${it.zh ? `<span class="nav-zh">${esc(it.zh)}</span>` : ''}
          </a>`,
          )
          .join('')}
      </div>
    </nav>`;
}

export const HOME_NAV = [
  { id: 'home', label: '프로젝트', icon: 'home', href: '#/' },
  { id: 'new', label: '새 프로젝트', icon: 'plus', href: '#/new' },
  { id: 'settings', label: '백업·설정', icon: 'archive', href: '#/settings' },
];

/** Inline label with the Chinese production term in smaller type. */
export const term = (ko, zh) => `${esc(ko)}${zh ? ` <span class="zh">${esc(zh)}</span>` : ''}`;

export function offlineBadge() {
  return navigator.onLine === false
    ? `<span class="pill pill-muted" title="오프라인에서도 이 기기에 저장돼요">${icon('offline', 'size-3.5')}오프라인</span>`
    : '';
}
