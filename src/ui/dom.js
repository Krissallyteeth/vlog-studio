import { icon } from './icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}
export const autoGrowAll = (root) => $$('textarea', root).forEach(autoGrow);

// ── Toast ─────────────────────────────────────────────
let toastTimer;
export function toast(message, { tone = 'default' } = {}) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
}

// ── Bottom sheet / dialog primitives ─────────────────
/**
 * Opens a modal sheet. `render(close)` returns the inner HTML; `onMount(el, close)` wires it.
 * Resolves with whatever `close(value)` is called with (null on dismiss).
 */
export function openSheet({ title = '', body, onMount, variant = 'sheet' }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = `overlay overlay--${variant}`;
    overlay.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ''}>
        ${variant === 'sheet' ? '<div class="sheet-grip" aria-hidden="true"></div>' : ''}
        ${title ? `<h2 class="sheet-title">${esc(title)}</h2>` : ''}
        <div class="sheet-body">${body}</div>
      </div>`;
    // iOS Safari keeps position:fixed sized to the whole screen when the keyboard opens, so a
    // bottom sheet ends up under the keyboard. Pin the overlay to the visible area instead.
    const vv = window.visualViewport;
    const fitViewport = () => {
      overlay.style.top = `${vv.offsetTop}px`;
      overlay.style.height = `${vv.height}px`;
      overlay.style.bottom = 'auto';
      overlay.classList.toggle('has-keyboard', window.innerHeight - vv.height > 80);
    };
    vv?.addEventListener('resize', fitViewport);
    vv?.addEventListener('scroll', fitViewport);
    let done = false;
    const close = (value = null) => {
      if (done) return;
      done = true;
      vv?.removeEventListener('resize', fitViewport);
      vv?.removeEventListener('scroll', fitViewport);
      overlay.classList.remove('is-open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 220);
      previousFocus?.focus?.({ preventScroll: true });
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    if (vv) fitViewport();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    onMount?.(overlay.querySelector('.sheet'), close);
    const focusable = overlay.querySelector('[autofocus], button, input, textarea, select');
    focusable?.focus({ preventScroll: true });
  });
}

export function confirmDialog({ title, message = '', confirmText = '확인', cancelText = '취소', danger = false }) {
  return openSheet({
    variant: 'dialog',
    title,
    body: `
      ${message ? `<p class="text-[15px] leading-relaxed text-muted whitespace-pre-line">${esc(message)}</p>` : ''}
      <div class="mt-5 grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-secondary" data-v="0">${esc(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-v="1">${esc(confirmText)}</button>
      </div>`,
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v === '1');
      });
    },
  }).then(Boolean);
}

/** actions: [{ id, label, icon?, danger?, hint? }] → resolves the chosen id or null. */
export function actionSheet({ title = '', actions }) {
  return openSheet({
    title,
    body: `
      <div class="flex flex-col gap-1">
        ${actions
          .map(
            (a) => `
          <button type="button" class="sheet-action ${a.danger ? 'is-danger' : ''} ${a.active ? 'is-active' : ''}" data-id="${esc(a.id)}">
            ${a.icon ? icon(a.icon) : ''}
            <span class="flex-1 text-left">${esc(a.label)}${a.hint ? `<span class="block text-[13px] text-muted font-normal">${esc(a.hint)}</span>` : ''}</span>
            ${a.active ? icon('check', 'size-5 text-ink') : ''}
          </button>`,
          )
          .join('')}
      </div>
      <button type="button" class="btn btn-secondary w-full mt-3" data-id="">취소</button>`,
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-id]');
        if (b) close(b.dataset.id || null);
      });
    },
  });
}

// ── Files & clipboard ─────────────────────────────────
export function downloadFile(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export const safeFileName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || 'vlog';
