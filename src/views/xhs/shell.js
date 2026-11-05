import { getSyncState } from '../../data/sync.js';
import { t } from '../../i18n/index.js';
import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { HOME_NAV, bottomNav, mount } from '../../ui/layout.js';

/** Page frame for the 小红书 screens: header, optional back link, body, bottom menu. */
export function xhsPage({ nav, title, sub = '', back = '', actions = '', body, wide = false }) {
  return mount(`
    <div class="view ${wide ? 'view-wide' : ''}">
      <header class="page-header flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1 basis-[260px]">
          ${back ? `<a href="${back}" class="link-btn inline-flex items-center gap-1 text-[13px]">${icon('chevronLeft', 'size-4')}${esc(t('common.back'))}</a>` : `<p class="eyebrow">小红书 · ${esc(getSyncState().email ? t('xhs.synced') : t('xhs.deviceOnly'))}</p>`}
          <h1 class="page-title mt-1">${esc(title)}</h1>
          ${sub ? `<p class="mt-1 text-[14px] text-muted">${esc(sub)}</p>` : ''}
        </div>
        <div class="flex shrink-0 items-center gap-1.5">${actions}</div>
      </header>
      <main class="page-main">${body}</main>
      ${bottomNav(HOME_NAV, nav)}
    </div>`);
}

/** Small "personal comparison, not a platform benchmark" note used next to every colour scale. */
export const relativeNote = () => `<p class="text-[12px] text-muted">${esc(t('xhs.relativeNote'))}</p>`;
