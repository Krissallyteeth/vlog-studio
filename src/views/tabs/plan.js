import { VALUES } from '../../lib/constants.js';
import { uid } from '../../lib/ids.js';
import { $, esc } from '../../ui/dom.js';
import { textArea } from '../../ui/fields.js';
import { icon } from '../../ui/icons.js';
import { t } from '../../i18n/index.js';

// Text for each question lives in the dictionaries: plan.<key>, plan.<key>.q, plan.<key>.ph, plan.<key>.guide
const QUESTIONS = [
  { key: 'theme' },
  { key: 'direction', guide: true },
  { key: 'highlights' },
  { key: 'curiosity', optional: true },
  { key: 'persona' },
  { key: 'resonance' },
  { key: 'values' },
].map((q) => ({
  ...q,
  get title() {
    return t(`plan.${q.key}`);
  },
  get q() {
    return t(`plan.${q.key}.q`);
  },
  get ph() {
    return t(`plan.${q.key}.ph`);
  },
}));

const openState = new Map(); // projectId -> Set of open question keys

function preview(plan, key) {
  if (key === 'highlights') return plan.highlights.filter((h) => h.text.trim()).map((h) => h.text.trim()).join(' · ');
  if (key === 'values') return VALUES.filter((v) => plan.values.includes(v.id)).map((v) => v.name).join(' · ');
  return plan[key].trim().split('\n')[0];
}

function highlightsBody(plan) {
  return `
    <ul class="flex flex-col gap-2" id="hl-list">
      ${plan.highlights
        .map(
          (h, i) => `
        <li class="flex items-center gap-2">
          <span class="num-badge">${i + 1}</span>
          <input class="input flex-1" data-bind="plan.highlights#${h.id}.text" value="${esc(h.text)}" aria-label="${esc(t('plan.highlights.item', { n: i + 1 }))}" />
          <button type="button" class="icon-btn icon-btn-sm" data-del-hl="${h.id}" aria-label="${esc(t('common.delete'))}">${icon('trash', 'size-[18px]')}</button>
        </li>`,
        )
        .join('')}
    </ul>
    <form class="mt-2 flex gap-2" id="hl-add">
      <input class="input flex-1" name="text" placeholder="${esc(t('plan.highlights.ph'))}" enterkeyhint="done" aria-label="${esc(t('plan.highlights.add'))}" />
      <button class="btn btn-primary px-4" aria-label="${esc(t('common.add'))}">${icon('plus')}</button>
    </form>`;
}

function valuesBody(plan) {
  return `
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="${esc(t('plan.values.pick'))}">
      ${VALUES.map(
        (v) => `
        <button type="button" class="value-chip" data-value="${v.id}" aria-pressed="${plan.values.includes(v.id)}">
          <span class="font-semibold">${esc(v.name)}</span>
          <span class="text-[12px] text-muted">${esc(v.desc)}</span>
        </button>`,
      ).join('')}
    </div>
    <div class="mt-3">${textArea({ bind: 'plan.valueNote', value: plan.valueNote, placeholder: t('plan.values.note') })}</div>`;
}

export function render(ctx, pane) {
  const { plan } = ctx.project;
  if (!openState.has(ctx.project.id)) openState.set(ctx.project.id, new Set(['theme']));
  const open = openState.get(ctx.project.id);

  pane.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">${esc(t('plan.title'))}</h2>
      <p class="section-sub">${esc(t('plan.sub'))}</p>
    </div>
    <div class="flex flex-col gap-2.5">
      ${QUESTIONS.map((q, i) => {
        const pv = preview(plan, q.key);
        const body =
          q.key === 'highlights'
            ? highlightsBody(plan)
            : q.key === 'values'
              ? valuesBody(plan)
              : `${q.guide ? `<p class="guide">${icon('info', 'size-4 mt-0.5')}<span>${esc(t(`plan.${q.key}.guide`))}</span></p>` : ''}
                 ${textArea({ bind: `plan.${q.key}`, value: plan[q.key], placeholder: q.ph, rows: 3 })}`;
        return `
          <details class="card fold" data-key="${q.key}" ${open.has(q.key) ? 'open' : ''}>
            <summary class="fold-summary">
              <span class="step-dot ${pv ? 'is-filled' : ''}">${pv ? icon('check', 'size-3.5') : i + 1}</span>
              <span class="min-w-0 flex-1">
                <span class="block text-[16px] font-semibold">${esc(q.title)}${q.optional ? ` <span class="opt">${esc(t('common.optional'))}</span>` : ''}</span>
                <span class="fold-preview" data-preview="${q.key}">${esc(pv || q.q)}</span>
              </span>
              ${icon('chevronDown', 'size-5 text-muted fold-chevron')}
            </summary>
            <div class="fold-body">
              <p class="question">${esc(q.q)}</p>
              ${body}
            </div>
          </details>`;
      }).join('')}
    </div>`;

  pane.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('details[data-key]');
    if (!d) return;
    if (d.open) open.add(d.dataset.key);
    else open.delete(d.dataset.key);
  }, true);

  pane.addEventListener('bound', (e) => {
    const key = e.detail.path.split('.')[1]?.split('#')[0];
    const q = QUESTIONS.find((x) => x.key === key);
    const el = pane.querySelector(`[data-preview="${key}"]`);
    if (q && el) el.textContent = preview(plan, key) || q.q;
  });

  pane.addEventListener('submit', (e) => {
    if (e.target.id !== 'hl-add') return;
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    plan.highlights.push({ id: uid(), text });
    ctx.commit();
    ctx.rerender();
    $('#hl-add input')?.focus();
  });

  pane.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-hl]');
    if (del) {
      plan.highlights = plan.highlights.filter((h) => h.id !== del.dataset.delHl);
      ctx.commit();
      ctx.rerender();
      return;
    }
    const chip = e.target.closest('[data-value]');
    if (chip) {
      const v = chip.dataset.value;
      plan.values = plan.values.includes(v) ? plan.values.filter((x) => x !== v) : [...plan.values, v];
      chip.setAttribute('aria-pressed', String(plan.values.includes(v)));
      pane.querySelector('[data-preview="values"]').textContent = preview(plan, 'values') || QUESTIONS.at(-1).q;
      ctx.commit();
      return;
    }
  });
}
