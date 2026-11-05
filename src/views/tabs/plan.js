import { VALUES } from '../../lib/constants.js';
import { uid } from '../../lib/ids.js';
import { $, esc } from '../../ui/dom.js';
import { textArea } from '../../ui/fields.js';
import { icon } from '../../ui/icons.js';
import { term } from '../../ui/layout.js';

const QUESTIONS = [
  {
    key: 'theme', ko: '주제', zh: '主题',
    q: '이 영상은 무엇에 관한 이야기인가요?',
    ph: '예: 혼자 떠난 전주 당일치기, 천천히 걷는 하루',
  },
  {
    key: 'direction', ko: '중심 이야기 방향', zh: '主线方向',
    q: '무엇을 중심으로 기록할 건가요?',
    ph: '예: 한옥마을 골목을 걸으며 "느리게 보내는 하루"가 어떤지 기록해 본다',
    guide: '아직 겪지 않은 결과나 감정은 미리 정하지 마세요. "~가 궁금하다", "~를 기록해 본다"처럼 방향만 적어 두면 충분해요. 실제 이야기는 촬영 후 <b>最终主线</b>에서 확정해요.',
  },
  { key: 'highlights', ko: '핵심 볼거리', zh: '核心看点', q: '꼭 담고 싶은 장소, 경험, 볼거리를 하나씩 추가하세요.' },
  {
    key: 'curiosity', ko: '시청자의 궁금증', zh: '观众好奇点', optional: true,
    q: '시청자는 무엇을 궁금해하고, 다음 장면을 보고 싶어 할까요?',
    ph: '예: 당일치기로 정말 여유로울 수 있을까?',
  },
  {
    key: 'persona', ko: '캐릭터 · 정체성', zh: '人设',
    q: '이번 영상에서 보여주고 싶은 나의 특징이나 취향은?',
    ph: '예: 사진보다 공간의 공기를 좋아하는 사람',
  },
  {
    key: 'resonance', ko: '공감', zh: '共鸣',
    q: '시청자가 공감할 수 있는 경험이나 감정은?',
    ph: '예: 바쁜 주말에 혼자만의 시간이 필요했던 순간',
  },
  { key: 'values', ko: '시청자에게 전달하는 가치', zh: '价值', q: '해당하는 가치를 모두 고르세요. (복수 선택)' },
];

const openState = new Map(); // projectId -> Set of open question keys

function preview(plan, key) {
  if (key === 'highlights') return plan.highlights.filter((h) => h.text.trim()).map((h) => h.text.trim()).join(' · ');
  if (key === 'values') return VALUES.filter((v) => plan.values.includes(v.id)).map((v) => v.zh).join(' · ');
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
          <input class="input flex-1" data-bind="plan.highlights#${h.id}.text" value="${esc(h.text)}" aria-label="핵심 볼거리 ${i + 1}" />
          <button type="button" class="icon-btn icon-btn-sm" data-del-hl="${h.id}" aria-label="삭제">${icon('trash', 'size-[18px]')}</button>
        </li>`,
        )
        .join('')}
    </ul>
    <form class="mt-2 flex gap-2" id="hl-add">
      <input class="input flex-1" name="text" placeholder="예: 경기전 대나무 숲" enterkeyhint="done" aria-label="핵심 볼거리 추가" />
      <button class="btn btn-primary px-4" aria-label="추가">${icon('plus')}</button>
    </form>`;
}

function valuesBody(plan) {
  return `
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="가치 선택">
      ${VALUES.map(
        (v) => `
        <button type="button" class="value-chip" data-value="${v.id}" aria-pressed="${plan.values.includes(v.id)}">
          <span class="font-semibold">${esc(v.zh)}</span>
          <span class="text-[12px] text-muted">${esc(v.ko)}</span>
        </button>`,
      ).join('')}
    </div>
    <div class="mt-3">${textArea({ bind: 'plan.valueNote', value: plan.valueNote, placeholder: '추가 메모 (선택)' })}</div>`;
}

export function render(ctx, pane) {
  const { plan } = ctx.project;
  if (!openState.has(ctx.project.id)) openState.set(ctx.project.id, new Set(['theme']));
  const open = openState.get(ctx.project.id);

  pane.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">${term('촬영 전 기획', '前期策划')}</h2>
      <p class="section-sub">모두 채울 필요 없어요. 떠오르는 것만 적어도 자동 저장돼요.</p>
    </div>
    <div class="flex flex-col gap-2.5">
      ${QUESTIONS.map((q, i) => {
        const pv = preview(plan, q.key);
        const body =
          q.key === 'highlights'
            ? highlightsBody(plan)
            : q.key === 'values'
              ? valuesBody(plan)
              : `${q.guide ? `<p class="guide">${icon('info', 'size-4 mt-0.5')}<span>${q.guide}</span></p>` : ''}
                 ${textArea({ bind: `plan.${q.key}`, value: plan[q.key], placeholder: q.ph, rows: 3 })}`;
        return `
          <details class="card fold" data-key="${q.key}" ${open.has(q.key) ? 'open' : ''}>
            <summary class="fold-summary">
              <span class="step-dot ${pv ? 'is-filled' : ''}">${pv ? icon('check', 'size-3.5') : i + 1}</span>
              <span class="min-w-0 flex-1">
                <span class="block text-[16px] font-semibold">${term(q.ko, q.zh)}${q.optional ? ' <span class="opt">선택</span>' : ''}</span>
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
