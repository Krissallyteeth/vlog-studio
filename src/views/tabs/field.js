import { formatShortDate, formatTimestamp, isWithinRange, todayString } from '../../lib/dates.js';
import { logPlaceName } from '../../lib/markdown.js';
import { logHasContent } from '../../lib/progress.js';
import { normalizeLog, normalizePlace } from '../../lib/schema.js';
import { $, confirmDialog, esc, toast } from '../../ui/dom.js';
import { keywordChips, textArea } from '../../ui/fields.js';
import { icon } from '../../ui/icons.js';
import { t } from '../../i18n/index.js';

// Step text lives in the dictionaries: log.<step>, log.<step>.short, log.<step>.when, log.f.<field>, log.f.<field>.ph
const field = (k, extra = {}) => ({
  k,
  ...extra,
  get label() {
    return t(`log.f.${k}`);
  },
  get ph() {
    return t(`log.f.${k}.ph`);
  },
});
const step = (id, fields) => ({
  id,
  fields,
  get title() {
    return t(`log.${id}`);
  },
  get short() {
    return t(`log.${id}.short`);
  },
  get when() {
    return t(`log.${id}.when`);
  },
});

export const STEPS = [
  step('expect', [field('expectWhy'), field('expectWhat')]),
  step('experience', [field('experience'), field('happened')]),
  step('feeling', [field('feeling', { chips: 'log.feelings' }), field('good'), field('bad')]),
  step('surprise', [field('surprise')]),
  step('memo', [field('memo')]),
];

const activeStep = new Map(); // logId -> step id
const stepFilled = (log, step) => step.fields.some((f) => log[f.k].trim());

function snippet(log) {
  for (const step of STEPS) {
    for (const f of step.fields) if (log[f.k].trim()) return `${step.title} · ${log[f.k].trim().split('\n')[0]}`;
  }
  return t('log.noContent');
}

function startLog(ctx, fields) {
  const now = Date.now();
  const log = normalizeLog({ ...fields, createdAt: now, updatedAt: now });
  ctx.project.logs.push(log);
  ctx.commit();
  ctx.go('field', log.id);
}

function renderList(ctx, pane) {
  const { project } = ctx;
  const today = todayString();
  const logs = [...project.logs].sort((a, b) => b.createdAt - a.createdAt);

  pane.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">${esc(t('field.title'))}</h2>
      <p class="section-sub">${esc(t('field.sub'))}</p>
    </div>

    <section class="card card-accent">
      <h3 class="text-[15px] font-semibold">${esc(t('field.where'))}</h3>
      ${
        project.places.length
          ? `<div class="mt-3 flex flex-col gap-2">
          ${project.places
            .map(
              (p, i) => `
            <button type="button" class="quick-place" data-start-place="${p.id}">
              <span class="num-badge">${i + 1}</span>
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate font-medium">${esc(p.name || t('place.unnamed'))}</span>
                ${p.date ? `<span class="text-[12px] text-muted">${esc(formatShortDate(p.date))}${p.time ? ` ${esc(p.time)}` : ''}</span>` : ''}
              </span>
              ${p.date === today ? `<span class="pill">${esc(t('field.today'))}</span>` : ''}
              ${icon('plus', 'size-5 text-muted')}
            </button>`,
            )
            .join('')}
        </div>`
          : `<p class="mt-1 text-[14px] text-muted">${esc(t('field.noPlaces'))}</p>`
      }
      <form id="unplanned" class="add-row mt-3">
        <input class="input flex-1" name="name" placeholder="${esc(t('field.newPh'))}" enterkeyhint="go" aria-label="${esc(t('field.newPh'))}" />
        <button class="btn btn-primary px-4 whitespace-nowrap">${esc(t('field.record'))}</button>
      </form>
      <p class="mt-2 text-[12px] text-muted">${esc(t('field.unplannedHint'))}</p>
    </section>

    <h3 class="mt-6 mb-2 text-[14px] font-semibold text-muted">${esc(t('field.count', { n: logs.length }))}</h3>
    <ul class="flex flex-col gap-2.5">
      ${
        logs
          .map(
            (l) => `
        <li>
          <a href="#/p/${encodeURIComponent(project.id)}/field/${encodeURIComponent(l.id)}" class="card log-card">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate font-semibold">${esc(logPlaceName(project, l))}</span>
              ${l.unplanned ? `<span class="pill pill-warm">${esc(t('log.unplanned'))}</span>` : ''}
            </div>
            <p class="mt-1 line-clamp-2 text-[14px] ${logHasContent(l) ? '' : 'text-muted'}">${esc(snippet(l))}</p>
            <div class="mt-2 flex items-center justify-between text-[12px] text-muted">
              <span class="step-dots">${STEPS.map((s) => `<i class="${stepFilled(l, s) ? 'on' : ''}" title="${esc(s.title)}"></i>`).join('')}</span>
              <span class="tabular-nums">${esc(formatTimestamp(l.updatedAt))}</span>
            </div>
          </a>
        </li>`,
          )
          .join('') || `<li class="py-8 text-center text-[14px] text-muted">${esc(t('field.empty'))}</li>`
      }
    </ul>`;

  pane.addEventListener('click', (e) => {
    const b = e.target.closest('[data-start-place]');
    if (!b) return;
    const place = project.places.find((p) => p.id === b.dataset.startPlace);
    startLog(ctx, { placeId: place.id, placeName: place.name });
  });
  pane.addEventListener('submit', (e) => {
    if (e.target.id !== 'unplanned') return;
    e.preventDefault();
    startLog(ctx, { placeName: e.target.name.value.trim(), unplanned: true });
  });
}

function renderComposer(ctx, pane, log) {
  const { project } = ctx;
  const step = STEPS.find((s) => s.id === activeStep.get(log.id)) ?? STEPS[0];
  const stepIndex = STEPS.indexOf(step);
  const linked = project.places.find((p) => p.id === log.placeId);
  const base = `logs#${log.id}`;

  pane.innerHTML = `
    <div class="flex items-center justify-between gap-2 mb-3">
      <a href="#/p/${encodeURIComponent(project.id)}/field" class="btn btn-ghost -ml-3 px-3">${icon('chevronLeft', 'size-4')}${esc(t('field.backToList'))}</a>
      <button type="button" class="icon-btn" data-del-log aria-label="${esc(t('field.deleteAria'))}">${icon('trash', 'size-5')}</button>
    </div>

    <section class="card">
      <div class="field">
        <label class="field-label" for="log-place">${esc(t('field.place'))}</label>
        <select id="log-place" class="input" data-bind="${base}.placeId">
          <option value="">${esc(t('field.noPlace'))}</option>
          ${project.places.map((p, i) => `<option value="${p.id}" ${p.id === log.placeId ? 'selected' : ''}>${i + 1}. ${esc(p.name || t('place.unnamed'))}</option>`).join('')}
        </select>
      </div>
      ${
        linked
          ? ''
          : `<div class="mt-3 flex gap-2">
              <input class="input flex-1" data-bind="${base}.placeName" value="${esc(log.placeName)}" placeholder="${esc(t('field.placeNamePh'))}" aria-label="${esc(t('field.placeName'))}" />
              ${log.placeName.trim() ? `<button type="button" class="btn btn-secondary px-3 text-[14px] whitespace-nowrap" data-add-route>${esc(t('field.addToRoute'))}</button>` : ''}
            </div>`
      }
      <label class="mt-3 flex items-center gap-2.5 text-[14px]">
        <span class="check check-sm"><input type="checkbox" data-bind="${base}.unplanned" ${log.unplanned ? 'checked' : ''} /><span class="check-box">${icon('check', 'size-3.5')}</span></span>
        ${esc(t('field.unplanned'))}
      </label>
      <p class="mt-3 text-[12px] text-muted tabular-nums" id="log-times">${esc(t('field.times', { c: formatTimestamp(log.createdAt), u: formatTimestamp(log.updatedAt) }))}</p>
    </section>

    <div class="segmented mt-4" role="tablist" aria-label="${esc(t('field.steps'))}">
      ${STEPS.map(
        (s) => `<button type="button" role="tab" class="seg ${s === step ? 'is-active' : ''}" aria-selected="${s === step}" data-step="${s.id}">
          <span class="seg-dot ${stepFilled(log, s) ? 'on' : ''}" data-dot="${s.id}"></span>${esc(s.short)}
        </button>`,
      ).join('')}
    </div>

    <section class="card mt-3 pane-enter" aria-live="polite">
      <p class="text-[13px] text-muted">${stepIndex + 1}/${STEPS.length} · ${esc(step.when)}</p>
      <h3 class="mt-0.5 text-[18px] font-semibold">${esc(step.title)}</h3>
      <div class="mt-4 flex flex-col gap-4">
        ${step.fields
          .map((f) => textArea({ bind: `${base}.${f.k}`, value: log[f.k], label: esc(f.label), placeholder: f.ph, rows: 2 }) + (f.chips ? keywordChips(`${base}.${f.k}`, t(f.chips)) : ''))
          .join('')}
      </div>
    </section>

    <div class="mt-4 grid grid-cols-2 gap-2">
      ${stepIndex > 0 ? `<button type="button" class="btn btn-secondary" data-step="${STEPS[stepIndex - 1].id}">${icon('chevronLeft', 'size-4')}${esc(STEPS[stepIndex - 1].short)}</button>` : '<span></span>'}
      ${
        stepIndex < STEPS.length - 1
          ? `<button type="button" class="btn btn-primary" data-step="${STEPS[stepIndex + 1].id}">${esc(STEPS[stepIndex + 1].short)}${icon('chevronRight', 'size-4')}</button>`
          : `<a href="#/p/${encodeURIComponent(project.id)}/field" class="btn btn-primary">${icon('check', 'size-4')}${esc(t('field.finish'))}</a>`
      }
    </div>`;

  pane.addEventListener('bound', (e) => {
    const field = e.detail.path.slice(base.length + 1);
    $('#log-times', pane).textContent = t('field.times', { c: formatTimestamp(log.createdAt), u: formatTimestamp(log.updatedAt) });
    if (field === 'placeId') {
      const p = project.places.find((x) => x.id === log.placeId);
      if (p) log.placeName = p.name;
      ctx.commit();
      ctx.rerender();
      return;
    }
    STEPS.forEach((s) => pane.querySelector(`[data-dot="${s.id}"]`)?.classList.toggle('on', stepFilled(log, s)));
  });

  pane.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-step]');
    if (st) {
      activeStep.set(log.id, st.dataset.step);
      ctx.commit();
      ctx.rerender();
      const first = document.querySelector('.pane textarea');
      if (st.classList.contains('seg') === false) first?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('[data-add-route]')) {
      const today = todayString();
      const date = isWithinRange(today, project.startDate, project.endDate) ? today : project.startDate;
      const place = normalizePlace({ name: log.placeName.trim(), date });
      project.places.push(place);
      log.placeId = place.id;
      log.updatedAt = Date.now();
      ctx.commit();
      ctx.rerender();
      toast(t('field.addedToRoute'));
      return;
    }
    if (e.target.closest('[data-del-log]')) {
      const ok = await confirmDialog({ title: t('field.deleteTitle'), message: t('field.deleteBody'), confirmText: t('common.delete'), danger: true });
      if (!ok) return;
      project.logs = project.logs.filter((l) => l.id !== log.id);
      project.scenes.forEach((s) => {
        if (s.link === `log:${log.id}`) s.link = '';
      });
      await ctx.commit();
      toast(t('field.deleted'));
      ctx.go('field', undefined, { replace: true });
    }
  });
}

export function render(ctx, pane, sub) {
  const log = sub && ctx.project.logs.find((l) => l.id === sub);
  if (log) renderComposer(ctx, pane, log);
  else renderList(ctx, pane);
}
