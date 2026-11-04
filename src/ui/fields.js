import { esc, autoGrow } from './dom.js';
import { setAt } from '../lib/path.js';

const fieldId = (bind) => `f-${bind.replace(/[^a-zA-Z0-9]+/g, '-')}`;

export function textArea({ bind, value = '', label = '', hint = '', placeholder = '', rows = 2 }) {
  const id = fieldId(bind);
  return `
    <div class="field">
      ${label ? `<label class="field-label" for="${id}">${label}</label>` : ''}
      ${hint ? `<p class="field-hint">${hint}</p>` : ''}
      <textarea id="${id}" class="textarea" rows="${rows}" data-bind="${esc(bind)}" placeholder="${esc(placeholder)}" enterkeyhint="enter">${esc(value)}</textarea>
    </div>`;
}

export function textInput({ bind, value = '', label = '', placeholder = '', type = 'text', attrs = '' }) {
  const id = fieldId(bind);
  return `
    <div class="field">
      ${label ? `<label class="field-label" for="${id}">${label}</label>` : ''}
      <input id="${id}" type="${type}" class="input" data-bind="${esc(bind)}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs} />
    </div>`;
}

/** Tapping a keyword appends it to the textarea named by `target` (fast input on the go). */
export function keywordChips(target, words) {
  return `<div class="chip-row chip-row-wrap mt-2" aria-label="빠른 입력 키워드">
    ${words.map((w) => `<button type="button" class="chip chip-sm" data-append="${esc(target)}" data-word="${esc(w)}">+ ${esc(w)}</button>`).join('')}
  </div>`;
}

/**
 * Two-way binding for `[data-bind]` controls inside a pane.
 * Text edits are debounced through ctx.changed(); checkboxes and blur commit immediately.
 */
export function bindInputs(pane, ctx) {
  const apply = (el) => {
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.type === 'number') {
      const n = Math.round(Number(value));
      value = Number.isFinite(n) && n >= 0 ? Math.min(n, 36000) : 0;
    }
    setAt(ctx.project, el.dataset.bind, value);
    ctx.touch?.(el.dataset.bind);
    pane.dispatchEvent(new CustomEvent('bound', { detail: { el, path: el.dataset.bind, value } }));
  };
  pane.addEventListener('input', (e) => {
    const el = e.target.closest('[data-bind]');
    if (!el || el.type === 'checkbox') return;
    apply(el);
    if (el.tagName === 'TEXTAREA') autoGrow(el);
    ctx.changed();
  });
  pane.addEventListener('change', (e) => {
    const el = e.target.closest('[data-bind]');
    if (!el) return;
    if (el.type === 'checkbox') apply(el);
    ctx.commit();
  });
  pane.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-append]');
    if (!chip) return;
    const ta = pane.querySelector(`[data-bind="${CSS.escape(chip.dataset.append)}"]`);
    if (!ta) return;
    const word = chip.dataset.word;
    ta.value = ta.value.trim() ? `${ta.value.replace(/\s+$/, '')}, ${word}` : word;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
