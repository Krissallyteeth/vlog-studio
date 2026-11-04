import { SHOT_TYPES } from '../../lib/constants.js';
import { allShotStats, shotStats } from '../../lib/progress.js';
import { normalizeShot } from '../../lib/schema.js';
import { $, esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { term } from '../../ui/layout.js';

let addType = 'env';
const selectedPlace = new Map(); // projectId -> placeId

function shotItem(place, s) {
  const t = SHOT_TYPES.find((x) => x.id === s.type);
  const base = `places#${place.id}.shots#${s.id}`;
  return `
    <li class="shot-item ${s.done ? 'is-done' : ''}" data-shot="${s.id}">
      <label class="check" aria-label="촬영 완료">
        <input type="checkbox" data-bind="${base}.done" ${s.done ? 'checked' : ''} />
        <span class="check-box">${icon('check', 'size-4')}</span>
      </label>
      <div class="min-w-0 flex-1">
        <span class="type-tag type-${s.type}">${esc(t.zh)} · ${esc(t.ko)}</span>
        <input class="input-plain mt-1 font-medium shot-desc" data-bind="${base}.desc" value="${esc(s.desc)}" placeholder="${esc(t.hint)}" aria-label="촬영 장면 설명" />
        <input class="input-plain text-[14px] text-muted" data-bind="${base}.memo" value="${esc(s.memo)}" placeholder="메모 추가" aria-label="메모" />
      </div>
      <button type="button" class="icon-btn icon-btn-sm" data-del="${s.id}" aria-label="촬영 항목 삭제">${icon('x', 'size-[18px]')}</button>
    </li>`;
}

function statsText(st) {
  return st.total ? `${st.done}/${st.total} 완료 · ${st.pct}%` : '촬영 항목 없음';
}

export function render(ctx, pane, sub) {
  const { project } = ctx;
  if (!project.places.length) {
    pane.innerHTML = `
      <div class="section-head">
        <h2 class="section-title">${term('촬영 체크리스트', '必拍镜头')}</h2>
      </div>
      <div class="empty card">
        <div class="empty-icon">${icon('camera', 'size-6')}</div>
        <p class="font-semibold">장소별로 체크리스트를 만들어요</p>
        <p class="mt-1 text-[14px] text-muted">먼저 동선에 장소를 추가해 주세요.</p>
        <button type="button" class="btn btn-primary mt-4" data-go="route">동선에 장소 추가</button>
      </div>`;
    pane.addEventListener('click', (e) => e.target.closest('[data-go]') && ctx.go('route'));
    return;
  }

  if (sub && project.places.some((p) => p.id === sub)) selectedPlace.set(project.id, sub);
  let place = project.places.find((p) => p.id === selectedPlace.get(project.id)) ?? project.places[0];
  const all = allShotStats(project);
  const st = shotStats(place);

  pane.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">${term('촬영 체크리스트', '必拍镜头')}</h2>
      <p class="section-sub">다섯 유형을 다 찍을 필요는 없어요. 필요한 장면만 담아 두세요.</p>
    </div>
    <p class="text-[13px] text-muted mb-2" id="all-stats">전체 ${all.done}/${all.total} 완료</p>
    <div class="chip-row" role="tablist" aria-label="장소 선택">
      ${project.places
        .map((p, i) => {
          const s = shotStats(p);
          return `<button type="button" role="tab" class="chip" data-place="${p.id}" aria-pressed="${p.id === place.id}" aria-selected="${p.id === place.id}">
            ${i + 1}. ${esc(p.name || '이름 없는 장소')}${s.total ? ` <span class="chip-count" data-chip-pct="${p.id}">${s.pct}%</span>` : ''}
          </button>`;
        })
        .join('')}
    </div>

    <section class="card mt-3">
      <div class="flex items-center justify-between gap-3">
        <h3 class="truncate text-[17px] font-semibold">${esc(place.name || '이름 없는 장소')}</h3>
        <span class="shrink-0 text-[13px] tabular-nums text-muted" id="place-stats">${statsText(st)}</span>
      </div>
      <div class="progress mt-2.5"><span id="place-bar" style="width:${st.pct}%"></span></div>
      ${place.shotIdea ? `<p class="guide mt-3">${icon('idea', 'size-4 mt-0.5')}<span>${esc(place.shotIdea)}</span></p>` : ''}

      <ul class="mt-3 flex flex-col" id="shot-list">
        ${place.shots.map((s) => shotItem(place, s)).join('') || '<li class="py-6 text-center text-[14px] text-muted">아래에서 촬영할 장면을 추가하세요.</li>'}
      </ul>

      <form id="shot-add" class="mt-3 border-t border-line pt-3">
        <div class="chip-row" role="radiogroup" aria-label="촬영 유형">
          ${SHOT_TYPES.map(
            (t) => `<label class="chip chip-sm"><input type="radio" class="sr-only" name="type" value="${t.id}" ${t.id === addType ? 'checked' : ''}/>${esc(t.zh)}<span class="text-muted font-normal">${esc(t.ko)}</span></label>`,
          ).join('')}
        </div>
        <div class="add-row mt-2">
          <input class="input flex-1" name="desc" placeholder="${esc(SHOT_TYPES.find((t) => t.id === addType).hint)}" enterkeyhint="done" aria-label="촬영 장면 설명" />
          <button class="btn btn-primary px-4" aria-label="촬영 항목 추가">${icon('plus')}</button>
        </div>
      </form>
    </section>`;

  function refreshStats() {
    const s = shotStats(place);
    const a = allShotStats(project);
    $('#place-stats', pane).textContent = statsText(s);
    $('#place-bar', pane).style.width = `${s.pct}%`;
    $('#all-stats', pane).textContent = `전체 ${a.done}/${a.total} 완료`;
    const chip = pane.querySelector(`[data-chip-pct="${place.id}"]`);
    if (chip) chip.textContent = `${s.pct}%`;
  }

  pane.addEventListener('bound', (e) => {
    if (!e.detail.path.endsWith('.done')) return;
    e.detail.el.closest('.shot-item')?.classList.toggle('is-done', e.detail.value);
    refreshStats();
  });

  pane.addEventListener('change', (e) => {
    if (e.target.name === 'type' && e.target.closest('#shot-add')) {
      addType = e.target.value;
      $('#shot-add [name="desc"]', pane).placeholder = SHOT_TYPES.find((t) => t.id === addType).hint;
    }
  });

  pane.addEventListener('submit', (e) => {
    if (e.target.id !== 'shot-add') return;
    e.preventDefault();
    place.shots.push(normalizeShot({ type: addType, desc: e.target.desc.value.trim() }));
    ctx.commit();
    ctx.rerender();
    $('#shot-add [name="desc"]')?.focus();
  });

  pane.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-place]');
    if (chip) {
      selectedPlace.set(project.id, chip.dataset.place);
      ctx.go('shots', chip.dataset.place, { replace: true });
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      place.shots = place.shots.filter((s) => s.id !== del.dataset.del);
      ctx.commit();
      ctx.rerender();
    }
  });
}
