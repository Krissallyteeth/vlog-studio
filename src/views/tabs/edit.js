import { formatTimestamp } from '../../lib/dates.js';
import { logPlaceName } from '../../lib/markdown.js';
import { formatDuration, formatDurationKo, logHasContent, totalSeconds } from '../../lib/progress.js';
import { normalizeScene } from '../../lib/schema.js';
import { $, confirmDialog, esc, openSheet } from '../../ui/dom.js';
import { keywordChips, textArea, textInput } from '../../ui/fields.js';
import { icon } from '../../ui/icons.js';
import { term } from '../../ui/layout.js';
import { STEPS as LOG_STEPS } from './field.js';

const STORY = [
  { key: 'expectation', zh: '期待', ko: '처음의 기대나 궁금증', ph: '떠나기 전 무엇이 궁금했나요?' },
  { key: 'discovery', zh: '发现', ko: '새롭게 발견한 것', ph: '가서 알게 된 것은?' },
  { key: 'experience', zh: '体验', ko: '실제로 경험한 과정', ph: '어떤 순서로 무엇을 했나요?' },
  { key: 'twist', zh: '转折', ko: '예상과 달랐던 점 · 작은 변화', ph: '예상과 달랐던 순간이 있었다면' },
  { key: 'feeling', zh: '感受', ko: '최종적으로 남은 감정과 생각', ph: '돌아와서 남은 감정은?' },
];
const EXTRAS = [
  { key: 'emotion', zh: '核心情绪', ko: '주요 감정', ph: '예: 느긋함, 작은 설렘', chips: ['여유', '설렘', '위로', '뿌듯함', '그리움', '편안함', '즐거움'] },
  { key: 'hook', zh: '开头 Hook', ko: '오프닝 아이디어', ph: '첫 3초에 무엇을 보여줄까요?' },
  { key: 'ending', zh: '结尾', ko: '마무리 아이디어', ph: '마지막 장면과 한마디' },
  { key: 'editNote', zh: '剪辑备注', ko: '편집 메모', ph: 'BGM, 색감, 컷 속도 등' },
];
const PRESETS = [
  { label: '1분 이하', min: 30, max: 60 },
  { label: '2~3분', min: 120, max: 180 },
  { label: '3~5분', min: 180, max: 300 },
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
          <span class="block text-[16px] font-semibold">${esc(f.zh)} <span class="text-[14px] font-normal text-muted">${esc(f.ko)}</span></span>
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
      <h3 class="text-[15px] font-semibold">${term('중심 이야기', '主线')} 비교</h3>
      <div class="compare mt-3">
        <div>
          <p class="compare-label">촬영 전 · 主线方向</p>
          <p class="compare-text ${plan.direction.trim() ? '' : 'text-muted'}">${esc(plan.direction.trim() || '기획 단계에서 작성하지 않았어요.')}</p>
        </div>
        <div class="compare-arrow" aria-hidden="true">${icon('down', 'size-4')}</div>
        <div>
          <label class="compare-label" for="f-story-finalLine">촬영 후 · 最终主线</label>
          <textarea id="f-story-finalLine" class="textarea mt-1" rows="2" data-bind="story.finalLine" placeholder="실제로 경험한 것을 바탕으로 이 영상의 중심 이야기를 한 문장으로">${esc(story.finalLine)}</textarea>
        </div>
      </div>
      <button type="button" class="btn btn-secondary w-full mt-3" data-logs ${logCount ? '' : 'disabled'}>${icon('note', 'size-4')}현장 기록 참고하기 (${logCount})</button>
    </section>

    <div class="mt-5 mb-2 flex items-baseline justify-between">
      <h3 class="text-[15px] font-semibold">감정 흐름</h3>
      <span class="text-[12px] text-muted">참고용 템플릿 · 필요한 것만</span>
    </div>
    <div class="flex flex-col gap-2.5">
      ${STORY.map((f) => {
        const body =
          f.key === 'twist'
            ? `<p class="guide">${icon('info', 'size-4 mt-0.5')}<span>실제로 반전이 없었다면 억지로 만들지 마세요. 잔잔한 흐름도 충분히 좋은 이야기예요.</span></p>
               <label class="mt-3 flex items-center gap-2.5 text-[14px]">
                 <span class="check check-sm"><input type="checkbox" data-bind="story.noTwist" ${story.noTwist ? 'checked' : ''} /><span class="check-box">${icon('check', 'size-3.5')}</span></span>
                 이번엔 뚜렷한 반전이 없었어요
               </label>
               <div class="mt-3 ${story.noTwist ? 'hidden' : ''}" data-twist-field>${textArea({ bind: 'story.twist', value: story.twist, placeholder: f.ph })}</div>`
            : textArea({ bind: `story.${f.key}`, value: story[f.key], placeholder: f.ph, rows: 3 });
        return storyFold(story, f, open, body);
      }).join('')}
    </div>

    <h3 class="mt-5 mb-2 text-[15px] font-semibold">편집 아이디어</h3>
    <div class="flex flex-col gap-2.5">
      ${EXTRAS.map((f) =>
        storyFold(story, f, open, textArea({ bind: `story.${f.key}`, value: story[f.key], placeholder: f.ph }) + (f.chips ? keywordChips(`story.${f.key}`, f.chips) : '')),
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
      title: '현장 기록 참고',
      body: `<div class="flex flex-col gap-3 max-h-[60vh] overflow-y-auto -mx-1 px-1">
        ${logs
          .map(
            (l) => `<article class="card card-flat">
            <p class="font-semibold">${esc(logPlaceName(project, l))}${l.unplanned ? ' <span class="pill pill-warm">意外</span>' : ''}</p>
            <p class="text-[12px] text-muted">${esc(formatTimestamp(l.createdAt))}</p>
            <dl class="mt-2 flex flex-col gap-1.5 text-[14px]">
              ${LOG_STEPS.flatMap((s) => s.fields.filter((f) => l[f.k].trim()).map((f) => `<div><dt class="text-[12px] text-muted">${esc(s.zh)} · ${esc(f.label)}</dt><dd class="whitespace-pre-line">${esc(l[f.k])}</dd></div>`)).join('')}
            </dl>
          </article>`,
          )
          .join('')}
      </div>
      <button type="button" class="btn btn-secondary w-full mt-3" data-close>닫기</button>`,
      onMount: (el, close) => el.querySelector('[data-close]').addEventListener('click', () => close()),
    });
  });
}

// ── Scenes / 剪辑 ──────────────────────────────────────
function linkOptions(project, selected) {
  const places = project.places.map((p, i) => `<option value="place:${p.id}" ${selected === `place:${p.id}` ? 'selected' : ''}>${i + 1}. ${esc(p.name || '이름 없는 장소')}</option>`);
  const logs = [...project.logs]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((l) => `<option value="log:${l.id}" ${selected === `log:${l.id}` ? 'selected' : ''}>${esc(logPlaceName(project, l))} · ${esc(formatTimestamp(l.createdAt))}</option>`);
  return `<option value="">연결 안 함</option>
    ${places.length ? `<optgroup label="동선 장소">${places.join('')}</optgroup>` : ''}
    ${logs.length ? `<optgroup label="현장 기록">${logs.join('')}</optgroup>` : ''}`;
}

function totalView(project) {
  const total = totalSeconds(project.scenes);
  const { min, max } = project.target;
  const state = total === 0 ? 'empty' : total < min ? 'under' : total > max ? 'over' : 'ok';
  const msg = {
    empty: '장면 길이를 입력하면 자동으로 합산돼요.',
    under: `목표보다 ${formatDurationKo(min - total)} 짧아요.`,
    over: `목표보다 ${formatDurationKo(total - max)} 길어요.`,
    ok: '목표 길이 안에 있어요.',
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
          <span class="block truncate text-[16px] font-semibold" data-title="${s.id}">${esc(s.title || '이름 없는 장면')}</span>
          <span class="meta-row"><span data-sec="${s.id}" class="tabular-nums">${s.seconds}초</span>${s.highlight ? '<span aria-hidden="true">·</span><span>하이라이트</span>' : ''}</span>
        </button>
        <div class="flex flex-col -my-1">
          <button type="button" class="icon-btn icon-btn-sm" data-move="-1" data-id="${s.id}" aria-label="위로 이동" ${i === 0 ? 'disabled' : ''}>${icon('up', 'size-[18px]')}</button>
          <button type="button" class="icon-btn icon-btn-sm" data-move="1" data-id="${s.id}" aria-label="아래로 이동" ${i === project.scenes.length - 1 ? 'disabled' : ''}>${icon('down', 'size-[18px]')}</button>
        </div>
      </div>
      ${
        isOpen
          ? `
      <div class="mt-4 flex flex-col gap-4 border-t border-line pt-4">
        ${textInput({ bind: `${base}.title`, value: s.title, label: '장면명', placeholder: '예: 오프닝 – 비 오는 골목' })}
        <div class="field">
          <label class="field-label" for="sl-${s.id}">연결할 장소 · 현장 기록</label>
          <select id="sl-${s.id}" class="input" data-bind="${base}.link">${linkOptions(project, s.link)}</select>
        </div>
        <div class="field">
          <label class="field-label" for="ss-${s.id}">예상 길이 (초)</label>
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-secondary px-4" data-sec-step="-5" data-id="${s.id}" aria-label="5초 줄이기">−5</button>
            <input id="ss-${s.id}" class="input text-center tabular-nums" type="number" inputmode="numeric" min="0" max="36000" data-type="number" data-bind="${base}.seconds" value="${s.seconds}" />
            <button type="button" class="btn btn-secondary px-4" data-sec-step="5" data-id="${s.id}" aria-label="5초 늘리기">+5</button>
          </div>
        </div>
        ${textArea({ bind: `${base}.content`, value: s.content, label: '영상에 넣을 내용', placeholder: '어떤 컷들을 이어 붙일까요?' })}
        ${textArea({ bind: `${base}.subtitle`, value: s.subtitle, label: '자막 아이디어', placeholder: '화면에 띄울 문구' })}
        ${textArea({ bind: `${base}.voiceover`, value: s.voiceover, label: '독백 아이디어', placeholder: '내레이션 / 혼잣말' })}
        ${textArea({ bind: `${base}.memo`, value: s.memo, label: '편집 메모', placeholder: 'BGM, 전환, 속도 등' })}
        <label class="flex items-center gap-2.5 text-[14px]">
          <span class="check check-sm"><input type="checkbox" data-bind="${base}.highlight" ${s.highlight ? 'checked' : ''} /><span class="check-box">${icon('check', 'size-3.5')}</span></span>
          하이라이트 장면 (초반 배치용)
        </label>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-secondary" data-to-top="${s.id}" ${i === 0 ? 'disabled' : ''}>${icon('up', 'size-4')}맨 앞으로</button>
          <button type="button" class="btn btn-ghost text-danger" data-del="${s.id}">${icon('trash', 'size-4')}삭제</button>
        </div>
      </div>`
          : ''
      }
    </article>`;
}

function renderScenes(ctx, pane, host) {
  const { project } = ctx;
  const openId = openScene.get(project.id);
  const t = totalView(project);

  host.innerHTML = `
    <section class="card">
      <div class="flex items-end justify-between gap-3">
        <div>
          <p class="text-[13px] text-muted">예상 총 길이</p>
          <p class="text-[30px] font-bold tabular-nums leading-tight" id="total">${formatDuration(t.total)}</p>
        </div>
        <p class="text-right text-[13px] text-muted">목표<br><b class="text-ink tabular-nums" id="target-label">${formatDuration(project.target.min)} ~ ${formatDuration(project.target.max)}</b></p>
      </div>
      <div class="progress progress-lg mt-3" data-state="${t.state}" id="total-bar"><span style="width:${t.pct}%"></span></div>
      <p class="mt-2 text-[13px]" id="total-msg" data-state="${t.state}">${esc(t.msg)}</p>
      <details class="mt-3">
        <summary class="link-btn cursor-pointer">목표 길이 바꾸기</summary>
        <div class="mt-3 chip-row">
          ${PRESETS.map((p) => `<button type="button" class="chip chip-sm" data-preset="${p.min}-${p.max}" aria-pressed="${p.min === project.target.min && p.max === project.target.max}">${p.label}</button>`).join('')}
        </div>
        <div class="mt-3 grid grid-cols-2 gap-3">
          ${textInput({ bind: 'target.min', value: project.target.min, label: '최소 (초)', type: 'number', attrs: 'data-type="number" inputmode="numeric" min="0"' })}
          ${textInput({ bind: 'target.max', value: project.target.max, label: '최대 (초)', type: 'number', attrs: 'data-type="number" inputmode="numeric" min="0"' })}
        </div>
      </details>
    </section>

    <p class="mt-5 mb-2 text-[13px] text-muted">실제 동선과 별개로 영상에 나올 순서예요. 나중에 찍은 하이라이트를 맨 앞에 둘 수도 있어요.</p>
    ${
      project.scenes.length
        ? `<div class="flex flex-col gap-2.5">${project.scenes.map((s, i) => sceneCard(project, s, i, s.id === openId)).join('')}</div>`
        : `<div class="empty card">
            <div class="empty-icon">${icon('film', 'size-6')}</div>
            <p class="font-semibold">편집 장면을 구성해 보세요</p>
            ${project.places.length ? `<button type="button" class="btn btn-secondary mt-4" data-from-route>${icon('route', 'size-4')}동선 순서로 장면 만들기</button>` : ''}
          </div>`
    }
    <button type="button" class="btn btn-primary w-full mt-3" data-add-scene>${icon('plus')}장면 추가</button>`;

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
      pane.querySelector(`[data-sec="${s.id}"]`).textContent = `${s.seconds}초`;
      refreshTotal();
    }
    if (m[2] === 'title') pane.querySelector(`[data-title="${s.id}"]`).textContent = s.title || '이름 없는 장면';
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
      const ok = await confirmDialog({ title: '장면을 삭제할까요?', message: `"${s.title || '이름 없는 장면'}" 장면이 삭제돼요.`, confirmText: '삭제', danger: true });
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
      <h2 class="section-title">${term('촬영 후 정리', '后期整理')}</h2>
      <p class="section-sub">실제로 경험한 것을 바탕으로 이야기를 완성하고, 편집 순서를 계획해요.</p>
    </div>
    <div class="segmented segmented-2 mb-4" role="tablist">
      <button type="button" role="tab" class="seg ${current === 'story' ? 'is-active' : ''}" aria-selected="${current === 'story'}" data-mode="story">스토리 <span class="zh">故事感</span></button>
      <button type="button" role="tab" class="seg ${current === 'scenes' ? 'is-active' : ''}" aria-selected="${current === 'scenes'}" data-mode="scenes">장면 구성 <span class="zh">剪辑</span></button>
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
