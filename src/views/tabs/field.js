import { formatShortDate, formatTimestamp, isWithinRange, todayString } from '../../lib/dates.js';
import { logPlaceName } from '../../lib/markdown.js';
import { logHasContent } from '../../lib/progress.js';
import { normalizeLog, normalizePlace } from '../../lib/schema.js';
import { $, confirmDialog, esc, toast } from '../../ui/dom.js';
import { keywordChips, textArea } from '../../ui/fields.js';
import { icon } from '../../ui/icons.js';
import { term } from '../../ui/layout.js';

const FEELINGS = ['설렘', '편안함', '여유', '감동', '놀람', '뿌듯함', '아쉬움', '피곤함', '낯섦', '그리움'];

export const STEPS = [
  {
    id: 'expect', zh: '期待', ko: '경험 전', short: '期待',
    fields: [
      { k: 'expectWhy', label: '왜 이 장소에 왔나요?', ph: '예: 한옥 골목 분위기가 궁금해서' },
      { k: 'expectWhat', label: '무엇을 기대했나요?', ph: '예: 조용한 아침 산책' },
    ],
  },
  {
    id: 'experience', zh: '体验', ko: '경험 중', short: '体验',
    fields: [
      { k: 'experience', label: '실제로 무엇을 경험했나요?', ph: '예: 골목 3개, 팥빙수, 비 소리' },
      { k: 'happened', label: '어떤 일이 있었나요?', ph: '예: 갑자기 비 → 처마 밑에서 20분' },
    ],
  },
  {
    id: 'feeling', zh: '真实感受', ko: '경험 후', short: '感受',
    fields: [
      { k: 'feeling', label: '실제로 어떤 감정을 느꼈나요?', ph: '키워드만 눌러도 돼요', chips: FEELINGS },
      { k: 'good', label: '좋았던 점', ph: '예: 사람이 적었다' },
      { k: 'bad', label: '아쉬웠던 점', ph: '예: 오후엔 너무 붐빔' },
    ],
  },
  {
    id: 'surprise', zh: '意外发现', ko: '예상 밖의 발견', short: '意外',
    fields: [{ k: 'surprise', label: '계획하지 않았지만 기억에 남는 것', ph: '예: 골목 끝 작은 책방, 주인 할머니의 한마디' }],
  },
  {
    id: 'memo', zh: '现场备注', ko: '현장 메모', short: '备注',
    fields: [{ k: 'memo', label: '자유롭게 기록', ph: '다시 찍을 컷, 소리, 빛, 동선 변경 등' }],
  },
];

const activeStep = new Map(); // logId -> step id
const stepFilled = (log, step) => step.fields.some((f) => log[f.k].trim());

function snippet(log) {
  for (const step of STEPS) {
    for (const f of step.fields) if (log[f.k].trim()) return `${step.zh} · ${log[f.k].trim().split('\n')[0]}`;
  }
  return '아직 내용이 없어요';
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
      <h2 class="section-title">${term('현장 기록', '现场记录')}</h2>
      <p class="section-sub">짧은 단어나 키워드만 적어도 충분해요. 입력하는 즉시 저장돼요.</p>
    </div>

    <section class="card card-accent">
      <h3 class="text-[15px] font-semibold">지금 어디에서 기록하나요?</h3>
      ${
        project.places.length
          ? `<div class="mt-3 flex flex-col gap-2">
          ${project.places
            .map(
              (p, i) => `
            <button type="button" class="quick-place" data-start-place="${p.id}">
              <span class="num-badge">${i + 1}</span>
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate font-medium">${esc(p.name || '이름 없는 장소')}</span>
                ${p.date ? `<span class="text-[12px] text-muted">${esc(formatShortDate(p.date))}${p.time ? ` ${esc(p.time)}` : ''}</span>` : ''}
              </span>
              ${p.date === today ? '<span class="pill">오늘</span>' : ''}
              ${icon('plus', 'size-5 text-muted')}
            </button>`,
            )
            .join('')}
        </div>`
          : '<p class="mt-1 text-[14px] text-muted">동선에 장소가 없어도 바로 기록할 수 있어요.</p>'
      }
      <form id="unplanned" class="add-row mt-3">
        <input class="input flex-1" name="name" placeholder="새 장소 · 예상 못한 경험" enterkeyhint="go" aria-label="새 장소 또는 예상 못한 경험" />
        <button class="btn btn-primary px-4 whitespace-nowrap">기록</button>
      </form>
      <p class="mt-2 text-[12px] text-muted">새 장소로 시작한 기록은 <b>계획 외 / 意外</b>로 표시돼요.</p>
    </section>

    <h3 class="mt-6 mb-2 text-[14px] font-semibold text-muted">기록 ${logs.length}개</h3>
    <ul class="flex flex-col gap-2.5">
      ${
        logs
          .map(
            (l) => `
        <li>
          <a href="#/p/${encodeURIComponent(project.id)}/field/${encodeURIComponent(l.id)}" class="card log-card">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate font-semibold">${esc(logPlaceName(project, l))}</span>
              ${l.unplanned ? '<span class="pill pill-warm">意外</span>' : ''}
            </div>
            <p class="mt-1 line-clamp-2 text-[14px] ${logHasContent(l) ? '' : 'text-muted'}">${esc(snippet(l))}</p>
            <div class="mt-2 flex items-center justify-between text-[12px] text-muted">
              <span class="step-dots">${STEPS.map((s) => `<i class="${stepFilled(l, s) ? 'on' : ''}" title="${s.zh}"></i>`).join('')}</span>
              <span class="tabular-nums">${esc(formatTimestamp(l.updatedAt))}</span>
            </div>
          </a>
        </li>`,
          )
          .join('') || '<li class="py-8 text-center text-[14px] text-muted">아직 현장 기록이 없어요.</li>'
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
      <a href="#/p/${encodeURIComponent(project.id)}/field" class="btn btn-ghost -ml-3 px-3">${icon('chevronLeft', 'size-4')}기록 목록</a>
      <button type="button" class="icon-btn" data-del-log aria-label="기록 삭제">${icon('trash', 'size-5')}</button>
    </div>

    <section class="card">
      <div class="field">
        <label class="field-label" for="log-place">장소</label>
        <select id="log-place" class="input" data-bind="${base}.placeId">
          <option value="">직접 입력 / 장소 없음</option>
          ${project.places.map((p, i) => `<option value="${p.id}" ${p.id === log.placeId ? 'selected' : ''}>${i + 1}. ${esc(p.name || '이름 없는 장소')}</option>`).join('')}
        </select>
      </div>
      ${
        linked
          ? ''
          : `<div class="mt-3 flex gap-2">
              <input class="input flex-1" data-bind="${base}.placeName" value="${esc(log.placeName)}" placeholder="장소 또는 경험 이름" aria-label="장소 이름" />
              ${log.placeName.trim() ? `<button type="button" class="btn btn-secondary px-3 text-[14px] whitespace-nowrap" data-add-route>동선에 추가</button>` : ''}
            </div>`
      }
      <label class="mt-3 flex items-center gap-2.5 text-[14px]">
        <span class="check check-sm"><input type="checkbox" data-bind="${base}.unplanned" ${log.unplanned ? 'checked' : ''} /><span class="check-box">${icon('check', 'size-3.5')}</span></span>
        계획 외 경험 <span class="zh">意外</span>
      </label>
      <p class="mt-3 text-[12px] text-muted tabular-nums" id="log-times">작성 ${esc(formatTimestamp(log.createdAt))} · 수정 ${esc(formatTimestamp(log.updatedAt))}</p>
    </section>

    <div class="segmented mt-4" role="tablist" aria-label="기록 단계">
      ${STEPS.map(
        (s) => `<button type="button" role="tab" class="seg ${s === step ? 'is-active' : ''}" aria-selected="${s === step}" data-step="${s.id}">
          <span class="seg-dot ${stepFilled(log, s) ? 'on' : ''}" data-dot="${s.id}"></span>${esc(s.short)}
        </button>`,
      ).join('')}
    </div>

    <section class="card mt-3 pane-enter" aria-live="polite">
      <p class="text-[13px] text-muted">${stepIndex + 1}/${STEPS.length} · ${esc(step.ko)}</p>
      <h3 class="mt-0.5 text-[18px] font-semibold">${esc(step.zh)}</h3>
      <div class="mt-4 flex flex-col gap-4">
        ${step.fields
          .map((f) => textArea({ bind: `${base}.${f.k}`, value: log[f.k], label: esc(f.label), placeholder: f.ph, rows: 2 }) + (f.chips ? keywordChips(`${base}.${f.k}`, f.chips) : ''))
          .join('')}
      </div>
    </section>

    <div class="mt-4 grid grid-cols-2 gap-2">
      ${stepIndex > 0 ? `<button type="button" class="btn btn-secondary" data-step="${STEPS[stepIndex - 1].id}">${icon('chevronLeft', 'size-4')}${esc(STEPS[stepIndex - 1].short)}</button>` : '<span></span>'}
      ${
        stepIndex < STEPS.length - 1
          ? `<button type="button" class="btn btn-primary" data-step="${STEPS[stepIndex + 1].id}">${esc(STEPS[stepIndex + 1].short)}${icon('chevronRight', 'size-4')}</button>`
          : `<a href="#/p/${encodeURIComponent(project.id)}/field" class="btn btn-primary">${icon('check', 'size-4')}기록 완료</a>`
      }
    </div>`;

  pane.addEventListener('bound', (e) => {
    const field = e.detail.path.slice(base.length + 1);
    $('#log-times', pane).textContent = `작성 ${formatTimestamp(log.createdAt)} · 수정 ${formatTimestamp(log.updatedAt)}`;
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
      toast('동선 마지막에 추가했어요.');
      return;
    }
    if (e.target.closest('[data-del-log]')) {
      const ok = await confirmDialog({ title: '이 현장 기록을 삭제할까요?', message: '삭제한 기록은 되돌릴 수 없어요.', confirmText: '삭제', danger: true });
      if (!ok) return;
      project.logs = project.logs.filter((l) => l.id !== log.id);
      project.scenes.forEach((s) => {
        if (s.link === `log:${log.id}`) s.link = '';
      });
      await ctx.commit();
      toast('기록을 삭제했어요.');
      ctx.go('field', undefined, { replace: true });
    }
  });
}

export function render(ctx, pane, sub) {
  const log = sub && ctx.project.logs.find((l) => l.id === sub);
  if (log) renderComposer(ctx, pane, log);
  else renderList(ctx, pane);
}
