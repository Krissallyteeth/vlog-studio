import { formatTimestamp } from '../../lib/dates.js';
import { logPlaceName } from '../../lib/markdown.js';
import { formatDuration, formatDurationText, logHasContent, totalSeconds } from '../../lib/progress.js';
import { normalizeScene } from '../../lib/schema.js';
import { $, confirmDialog, esc, openSheet } from '../../ui/dom.js';
import { keywordChips, textArea, textInput } from '../../ui/fields.js';
import { icon } from '../../ui/icons.js';
import { STEPS as LOG_STEPS } from './field.js';
import { t } from '../../i18n/index.js';

// Text lives in the dictionaries: story.<key>, story.<key>.desc, story.<key>.ph
const fold = (key, extra = {}) => ({
  key,
  ...extra,
  get title() {
    return t(`story.${key}`);
  },
  get desc() {
    return t(`story.${key}.desc`);
  },
  get ph() {
    return t(`story.${key}.ph`);
  },
});
const STORY = ['expectation', 'discovery', 'experience', 'twist', 'feeling'].map((k) => fold(k));
const EXTRAS = [fold('emotion', { chips: 'story.emotions' }), fold('hook'), fold('ending'), fold('editNote')];
const PRESETS = [
  { key: 'preset.short', min: 30, max: 60 },
  { key: 'preset.mid', min: 120, max: 180 },
  { key: 'preset.long', min: 180, max: 300 },
];

const mode = new Map(); // projectId -> 'story' | 'scenes'
const openScene = new Map(); // projectId -> scene id
const openFold = new Map(); // projectId -> Set

// ── Story / 故事感 ─────────────────────────────────────
function storyFold(story, f, open, body) {
  const done = f.key === 'twist' ? story.twist.trim() || story.noTwist : story[f.key].trim();
  return `
    <details class="card fold" data-key="${f.key}" ${open.has(f.key) ? 'open' : ''}>
      <summary class="fold-summary">
        <span class="step-dot ${done ? 'is-filled' : ''}" data-dot="${f.key}">${done ? icon('check', 'size-3.5') : ''}</span>
        <span class="min-w-0 flex-1">
          <span class="block text-[16px] font-semibold">${esc(f.title)} <span class="text-[14px] font-normal text-muted">${esc(f.desc)}</span></span>
        </span>
        ${icon('chevronDown', 'size-5 text-muted fold-chevron')}
      </summary>
      <div class="fold-body">${body}</div>
    </details>`;
}

function renderStory(ctx, pane, host) {
  const { project } = ctx;
  const { story, plan } = project;
  if (!openFold.has(project.id)) openFold.set(project.id, new Set(['expectation']));
  const open = openFold.get(project.id);
  const logCount = project.logs.filter(logHasContent).length;

  host.innerHTML = `
    <section class="card">
      <h3 class="text-[15px] font-semibold">${esc(t('story.compare'))}</h3>
      <div class="compare mt-3">
        <div>
          <p class="compare-label">${esc(t('story.before'))}</p>
          <p class="compare-text ${plan.direction.trim() ? '' : 'text-muted'}">${esc(plan.direction.trim() || t('story.noDirection'))}</p>
        </div>
        <div class="compare-arrow" aria-hidden="true">${icon('down', 'size-4')}</div>
        <div>
          <label class="compare-label" for="f-story-finalLine">${esc(t('story.after'))}</label>
          <textarea id="f-story-finalLine" class="textarea mt-1" rows="2" data-bind="story.finalLine" placeholder="${esc(t('story.finalPh'))}">${esc(story.finalLine)}</textarea>
        </div>
      </div>
      <button type="button" class="btn btn-secondary w-full mt-3" data-logs ${logCount ? '' : 'disabled'}>${icon('note', 'size-4')}${esc(t('story.viewLogs', { n: logCount }))}</button>
    </section>

    <div class="mt-5 mb-2 flex items-baseline justify-between">
      <h3 class="text-[15px] font-semibold">${esc(t('story.flow'))}</h3>
      <span class="text-[12px] text-muted">${esc(t('story.flowHint'))}</span>
    </div>
    <div class="flex flex-col gap-2.5">
      ${STORY.map((f) => {
        const body =
          f.key === 'twist'
            ? `<p class="guide">${icon('info', 'size-4 mt-0.5')}<span>${esc(t('story.twistGuide'))}</span></p>
               <label class="mt-3 flex items-center gap-2.5 text-[14px]">
                 <span class="check check-sm"><input type="checkbox" data-bind="story.noTwist" ${story.noTwist ? 'checked' : ''} /><span class="check-box">${icon('check', 'size-3.5')}</span></span>
                 ${esc(t('story.noTwist'))}
               </label>
               <div class="mt-3 ${story.noTwist ? 'hidden' : ''}" data-twist-field>${textArea({ bind: 'story.twist', value: story.twist, placeholder: f.ph })}</div>`
            : textArea({ bind: `story.${f.key}`, value: story[f.key], placeholder: f.ph, rows: 3 });
        return storyFold(story, f, open, body);
      }).join('')}
    </div>

    <h3 class="mt-5 mb-2 text-[15px] font-semibold">${esc(t('story.ideas'))}</h3>
    <div class="flex flex-col gap-2.5">
      ${EXTRAS.map((f) =>
        storyFold(story, f, open, textArea({ bind: `story.${f.key}`, value: story[f.key], placeholder: f.ph }) + (f.chips ? keywordChips(`story.${f.key}`, t(f.chips)) : '')),
      ).join('')}
    </div>`;

  pane.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('details[data-key]');
    if (!d) return;
    if (d.open) open.add(d.dataset.key);
    else open.delete(d.dataset.key);
  }, true);

  pane.addEventListener('bound', (e) => {
    const key = e.detail.path.split('.')[1];
    if (key === 'noTwist') pane.querySelector('[data-twist-field]').classList.toggle('hidden', story.noTwist);
    const dotKey = key === 'noTwist' ? 'twist' : key;
    const dot = pane.querySelector(`[data-dot="${dotKey}"]`);
    if (!dot) return;
    const done = dotKey === 'twist' ? story.twist.trim() || story.noTwist : story[dotKey]?.trim();
    dot.classList.toggle('is-filled', Boolean(done));
    dot.innerHTML = done ? icon('check', 'size-3.5') : '';
  });

  pane.addEventListener('click', (e) => {
    if (!e.target.closest('[data-logs]')) return;
    const logs = [...project.logs].filter(logHasContent).sort((a, b) => a.createdAt - b.createdAt);
    openSheet({
      title: t('story.logsTitle'),
      body: `<div class="flex flex-col gap-3 max-h-[60vh] overflow-y-auto -mx-1 px-1">
        ${logs
          .map(
            (l) => `<article class="card card-flat">
            <p class="font-semibold">${esc(logPlaceName(project, l))}${l.unplanned ? ` <span class="pill pill-warm">${esc(t('log.unplanned'))}</span>` : ''}</p>
            <p class="text-[12px] text-muted">${esc(formatTimestamp(l.createdAt))}</p>
            <dl class="mt-2 flex flex-col gap-1.5 text-[14px]">
              ${LOG_STEPS.flatMap((s) => s.fields.filter((f) => l[f.k].trim()).map((f) => `<div><dt class="text-[12px] text-muted">${esc(s.title)} · ${esc(f.label)}</dt><dd class="whitespace-pre-line">${esc(l[f.k])}</dd></div>`)).join('')}
            </dl>
          </article>`,
          )
          .join('')}
      </div>
      <button type="button" class="btn btn-secondary w-full mt-3" data-close>${esc(t('common.close'))}</button>`,
      onMount: (el, close) => el.querySelector('[data-close]').addEventListener('click', () => close()),
    });
  });
}

// ── Scenes / 剪辑 ──────────────────────────────────────
function linkOptions(project, selected) {
  const places = project.places.map((p, i) => `<option value="place:${p.id}" ${selected === `place:${p.id}` ? 'selected' : ''}>${i + 1}. ${esc(p.name || t('place.unnamed'))}</option>`);
  const logs = [...project.logs]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((l) => `<option value="log:${l.id}" ${selected === `log:${l.id}` ? 'selected' : ''}>${esc(logPlaceName(project, l))} · ${esc(formatTimestamp(l.createdAt))}</option>`);
  return `<option value="">${esc(t('scene.noLink'))}</option>
    ${places.length ? `<optgroup label="${esc(t('scene.routePlaces'))}">${places.join('')}</optgroup>` : ''}
    ${logs.length ? `<optgroup label="${esc(t('field.title'))}">${logs.join('')}</optgroup>` : ''}`;
}

function totalView(project) {
  const total = totalSeconds(project.scenes);
  const { min, max } = project.target;
  const state = total === 0 ? 'empty' : total < min ? 'under' : total > max ? 'over' : 'ok';
  const msg = {
    empty: t('scene.totalEmpty'),
    under: t('scene.under', { v: formatDurationText(min - total) }),
    over: t('scene.over', { v: formatDurationText(total - max) }),
    ok: t('scene.ok'),
  }[state];
  const pct = max ? Math.min(100, Math.round((total / max) * 100)) : 0;
  return { total, state, msg, pct };
}

function sceneCard(project, s, i, isOpen) {
  const base = `scenes#${s.id}`;
  return `
    <article class="card scene-card ${isOpen ? 'is-open' : ''}" data-scene="${s.id}">
      <div class="flex items-center gap-3">
        <span class="num-badge ${s.highlight ? 'is-highlight' : ''}">${s.highlight ? icon('star', 'size-3.5') : i + 1}</span>
        <button type="button" class="min-w-0 flex-1 text-left py-1" data-toggle="${s.id}" aria-expanded="${isOpen}">
          <span class="block truncate text-[16px] font-semibold" data-title="${s.id}">${esc(s.title || t('scene.unnamed'))}</span>
          <span class="meta-row"><span data-sec="${s.id}" class="tabular-nums">${esc(t('dur.s', { s: s.seconds }))}</span>${s.highlight ? `<span aria-hidden="true">·</span><span>${esc(t('scene.highlight'))}</span>` : ''}</span>
        </button>
        <div class="flex flex-col -my-1">
          <button type="button" class="icon-btn icon-btn-sm" data-move="-1" data-id="${s.id}" aria-label="${esc(t('common.moveUp'))}" ${i === 0 ? 'disabled' : ''}>${icon('up', 'size-[18px]')}</button>
          <button type="button" class="icon-btn icon-btn-sm" data-move="1" data-id="${s.id}" aria-label="${esc(t('common.moveDown'))}" ${i === project.scenes.length - 1 ? 'disabled' : ''}>${icon('down', 'size-[18px]')}</button>
        </div>
      </div>
      ${
        isOpen
          ? `
      <div class="mt-4 flex flex-col gap-4 border-t border-line pt-4">
        ${textInput({ bind: `${base}.title`, value: s.title, label: t('scene.title'), placeholder: t('scene.titlePh') })}
        <div class="field">
          <label class="field-label" for="sl-${s.id}">${esc(t('scene.link'))}</label>
          <select id="sl-${s.id}" class="input" data-bind="${base}.link">${linkOptions(project, s.link)}</select>
        </div>
        <div class="field">
          <label class="field-label" for="ss-${s.id}">${esc(t('scene.seconds'))}</label>
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-secondary px-4" data-sec-step="-5" data-id="${s.id}" aria-label="${esc(t('scene.minus5'))}">−5</button>
            <input id="ss-${s.id}" class="input text-center tabular-nums" type="number" inputmode="numeric" min="0" max="36000" data-type="number" data-bind="${base}.seconds" value="${s.seconds}" />
            <button type="button" class="btn btn-secondary px-4" data-sec-step="5" data-id="${s.id}" aria-label="${esc(t('scene.plus5'))}">+5</button>
          </div>
        </div>
        ${textArea({ bind: `${base}.content`, value: s.content, label: t('scene.content'), placeholder: t('scene.contentPh') })}
        ${textArea({ bind: `${base}.subtitle`, value: s.subtitle, label: t('scene.subtitle'), placeholder: t('scene.subtitlePh') })}
        ${textArea({ bind: `${base}.voiceover`, value: s.voiceover, label: t('scene.voiceover'), placeholder: t('scene.voiceoverPh') })}
        ${textArea({ bind: `${base}.memo`, value: s.memo, label: t('scene.memo'), placeholder: t('scene.memoPh') })}
        <label class="flex items-center gap-2.5 text-[14px]">
          <span class="check check-sm"><input type="checkbox" data-bind="${base}.highlight" ${s.highlight ? 'checked' : ''} /><span class="check-box">${icon('check', 'size-3.5')}</span></span>
          ${esc(t('scene.highlightLabel'))}
        </label>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-secondary" data-to-top="${s.id}" ${i === 0 ? 'disabled' : ''}>${icon('up', 'size-4')}${esc(t('scene.toTop'))}</button>
          <button type="button" class="btn btn-ghost text-danger" data-del="${s.id}">${icon('trash', 'size-4')}${esc(t('common.delete'))}</button>
        </div>
      </div>`
          : ''
      }
    </article>`;
}

function renderScenes(ctx, pane, host) {
  const { project } = ctx;
  const openId = openScene.get(project.id);
  const tv = totalView(project);

  host.innerHTML = `
    <section class="card">
      <div class="flex items-end justify-between gap-3">
        <div>
          <p class="text-[13px] text-muted">${esc(t('scene.total'))}</p>
          <p class="text-[30px] font-bold tabular-nums leading-tight" id="total">${formatDuration(tv.total)}</p>
        </div>
        <p class="text-right text-[13px] text-muted">${esc(t('scene.target'))}<br><b class="text-ink tabular-nums" id="target-label">${formatDuration(project.target.min)} ~ ${formatDuration(project.target.max)}</b></p>
      </div>
      <div class="progress progress-lg mt-3" data-state="${tv.state}" id="total-bar"><span style="width:${tv.pct}%"></span></div>
      <p class="mt-2 text-[13px]" id="total-msg" data-state="${tv.state}">${esc(tv.msg)}</p>
      <details class="mt-3">
        <summary class="link-btn cursor-pointer">${esc(t('scene.changeTarget'))}</summary>
        <div class="mt-3 chip-row">
          ${PRESETS.map((p) => `<button type="button" class="chip chip-sm" data-preset="${p.min}-${p.max}" aria-pressed="${p.min === project.target.min && p.max === project.target.max}">${esc(t(p.key))}</button>`).join('')}
        </div>
        <div class="mt-3 grid grid-cols-2 gap-3">
          ${textInput({ bind: 'target.min', value: project.target.min, label: t('scene.min'), type: 'number', attrs: 'data-type="number" inputmode="numeric" min="0"' })}
          ${textInput({ bind: 'target.max', value: project.target.max, label: t('scene.max'), type: 'number', attrs: 'data-type="number" inputmode="numeric" min="0"' })}
        </div>
      </details>
    </section>

    <p class="mt-5 mb-2 text-[13px] text-muted">${esc(t('scene.orderHint'))}</p>
    ${
      project.scenes.length
        ? `<div class="flex flex-col gap-2.5">${project.scenes.map((s, i) => sceneCard(project, s, i, s.id === openId)).join('')}</div>`
        : `<div class="empty card">
            <div class="empty-icon">${icon('film', 'size-6')}</div>
            <p class="font-semibold">${esc(t('scene.empty'))}</p>
            ${project.places.length ? `<button type="button" class="btn btn-secondary mt-4" data-from-route>${icon('route', 'size-4')}${esc(t('scene.fromRoute'))}</button>` : ''}
          </div>`
    }
    <button type="button" class="btn btn-primary w-full mt-3" data-add-scene>${icon('plus')}${esc(t('scene.add'))}</button>`;

  function refreshTotal() {
    const v = totalView(project);
    $('#total', pane).textContent = formatDuration(v.total);
    $('#total-bar', pane).dataset.state = v.state;
    $('#total-bar span', pane).style.width = `${v.pct}%`;
    $('#total-msg', pane).textContent = v.msg;
    $('#total-msg', pane).dataset.state = v.state;
    $('#target-label', pane).textContent = `${formatDuration(project.target.min)} ~ ${formatDuration(project.target.max)}`;
  }

  pane.addEventListener('bound', (e) => {
    const m = /^scenes#([^.]+)\.(\w+)$/.exec(e.detail.path);
    if (e.detail.path.startsWith('target.')) return refreshTotal();
    if (!m) return;
    const s = project.scenes.find((x) => x.id === m[1]);
    if (m[2] === 'seconds') {
      pane.querySelector(`[data-sec="${s.id}"]`).textContent = t('dur.s', { s: s.seconds });
      refreshTotal();
    }
    if (m[2] === 'title') pane.querySelector(`[data-title="${s.id}"]`).textContent = s.title || t('scene.unnamed');
    if (m[2] === 'highlight') ctx.rerender();
  });

  pane.addEventListener('change', (e) => {
    if (!e.target.dataset.bind?.startsWith('target.')) return;
    const { target } = project;
    if (target.min > target.max) [target.min, target.max] = [target.max, target.min];
    ctx.commit();
    ctx.rerender();
  });

  pane.addEventListener('click', async (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.dataset.toggle;
      openScene.set(project.id, openScene.get(project.id) === id ? null : id);
      return ctx.rerender();
    }
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      const [min, max] = preset.dataset.preset.split('-').map(Number);
      project.target = { min, max };
      ctx.commit();
      return ctx.rerender();
    }
    const step = e.target.closest('[data-sec-step]');
    if (step) {
      const input = pane.querySelector(`#ss-${step.dataset.id}`);
      input.value = Math.max(0, (Number(input.value) || 0) + Number(step.dataset.secStep));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const move = e.target.closest('[data-move]');
    if (move) {
      const i = project.scenes.findIndex((s) => s.id === move.dataset.id);
      const j = i + Number(move.dataset.move);
      if (j < 0 || j >= project.scenes.length) return;
      [project.scenes[i], project.scenes[j]] = [project.scenes[j], project.scenes[i]];
      ctx.commit();
      return ctx.rerender();
    }
    const top = e.target.closest('[data-to-top]');
    if (top) {
      const s = project.scenes.find((x) => x.id === top.dataset.toTop);
      project.scenes = [s, ...project.scenes.filter((x) => x !== s)];
      ctx.commit();
      ctx.rerender();
      return window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (e.target.closest('[data-add-scene]')) {
      const s = normalizeScene({ title: '', seconds: 10 });
      project.scenes.push(s);
      openScene.set(project.id, s.id);
      ctx.commit();
      ctx.rerender();
      document.querySelector(`[data-scene="${s.id}"] input`)?.focus();
      return;
    }
    if (e.target.closest('[data-from-route]')) {
      project.scenes = project.places.map((p) => normalizeScene({ title: p.name, link: `place:${p.id}`, seconds: 15 }));
      ctx.commit();
      return ctx.rerender();
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const s = project.scenes.find((x) => x.id === del.dataset.del);
      const ok = await confirmDialog({ title: t('scene.deleteTitle'), message: t('scene.deleteBody', { name: s.title || t('scene.unnamed') }), confirmText: t('common.delete'), danger: true });
      if (!ok) return;
      project.scenes = project.scenes.filter((x) => x !== s);
      ctx.commit();
      ctx.rerender();
    }
  });
}

export function render(ctx, pane, sub) {
  const { project } = ctx;
  if (sub === 'story' || sub === 'scenes') mode.set(project.id, sub);
  const current = mode.get(project.id) ?? 'story';

  pane.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">${esc(t('edit.title'))}</h2>
      <p class="section-sub">${esc(t('edit.sub'))}</p>
    </div>
    <div class="segmented segmented-2 mb-4" role="tablist">
      <button type="button" role="tab" class="seg ${current === 'story' ? 'is-active' : ''}" aria-selected="${current === 'story'}" data-mode="story">${esc(t('edit.story'))}</button>
      <button type="button" role="tab" class="seg ${current === 'scenes' ? 'is-active' : ''}" aria-selected="${current === 'scenes'}" data-mode="scenes">${esc(t('edit.scenes'))}</button>
    </div>
    <div id="edit-host"></div>`;

  pane.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) ctx.go('edit', b.dataset.mode, { replace: true });
  });

  const host = $('#edit-host', pane);
  if (current === 'story') renderStory(ctx, pane, host);
  else renderScenes(ctx, pane, host);
}
