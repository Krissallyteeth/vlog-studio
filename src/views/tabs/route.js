import { dateRange, formatDate, formatShortDate, isWithinRange } from '../../lib/dates.js';
import { shotStats } from '../../lib/progress.js';
import { normalizePlace } from '../../lib/schema.js';
import { $, confirmDialog, esc, toast } from '../../ui/dom.js';
import { textArea, textInput } from '../../ui/fields.js';
import { icon } from '../../ui/icons.js';
import { term } from '../../ui/layout.js';

const openPlace = new Map(); // projectId -> open place id

export function dateOptions(project, selected) {
  const days = dateRange(project.startDate, project.endDate);
  const opts = days.map(
    (d, i) => `<option value="${d}" ${d === selected ? 'selected' : ''}>${days.length > 1 ? `Day ${i + 1} · ` : ''}${formatShortDate(d)}</option>`,
  );
  if (selected && !days.includes(selected)) {
    opts.push(`<option value="${selected}" selected>${formatDate(selected)} (촬영 기간 밖)</option>`);
  }
  return `<option value="" ${selected ? '' : 'selected'}>날짜 미정</option>${opts.join('')}`;
}

function placeMeta(project, p) {
  const st = shotStats(p);
  const when = [p.date ? formatShortDate(p.date) : '', p.time].filter(Boolean).join(' ');
  const outside = p.date && !isWithinRange(p.date, project.startDate, project.endDate);
  return [
    when ? `<span class="${outside ? 'text-danger' : ''}">${esc(when)}${outside ? ' · 기간 밖' : ''}</span>` : '<span>날짜 미정</span>',
    st.total ? `<span>${icon('camera', 'size-3.5')}${st.done}/${st.total}</span>` : '',
  ].filter(Boolean).join('<span aria-hidden="true">·</span>');
}

function placeCard(project, p, i, isOpen) {
  const last = project.places.length - 1;
  return `
    <article class="card place-card ${isOpen ? 'is-open' : ''}" data-place="${p.id}">
      <div class="flex items-center gap-3">
        <span class="num-badge">${i + 1}</span>
        <button type="button" class="min-w-0 flex-1 text-left py-1" data-toggle="${p.id}" aria-expanded="${isOpen}">
          <span class="block truncate text-[16px] font-semibold" data-title="${p.id}">${esc(p.name || '이름 없는 장소')}</span>
          <span class="meta-row">${placeMeta(project, p)}</span>
        </button>
        <div class="flex flex-col -my-1">
          <button type="button" class="icon-btn icon-btn-sm" data-move="-1" data-id="${p.id}" aria-label="위로 이동" ${i === 0 ? 'disabled' : ''}>${icon('up', 'size-[18px]')}</button>
          <button type="button" class="icon-btn icon-btn-sm" data-move="1" data-id="${p.id}" aria-label="아래로 이동" ${i === last ? 'disabled' : ''}>${icon('down', 'size-[18px]')}</button>
        </div>
      </div>
      ${
        isOpen
          ? `
      <div class="mt-4 flex flex-col gap-4 border-t border-line pt-4">
        ${textInput({ bind: `places#${p.id}.name`, value: p.name, label: '장소명', placeholder: '예: 전주 한옥마을' })}
        <div class="grid grid-cols-[1.4fr_1fr] gap-3">
          <div class="field">
            <label class="field-label" for="pd-${p.id}">방문 날짜</label>
            <select id="pd-${p.id}" class="input" data-bind="places#${p.id}.date">${dateOptions(project, p.date)}</select>
          </div>
          ${textInput({ bind: `places#${p.id}.time`, value: p.time, label: '예상 시간', type: 'time' })}
        </div>
        ${textArea({ bind: `places#${p.id}.purpose`, value: p.purpose, label: '방문 목적', placeholder: '왜 이곳에 가나요?' })}
        ${textArea({ bind: `places#${p.id}.expectation`, value: p.expectation, label: '기대하는 경험', placeholder: '무엇을 해 보고 싶나요?' })}
        ${textArea({ bind: `places#${p.id}.shotIdea`, value: p.shotIdea, label: '촬영 아이디어', placeholder: '예: 골목 입구에서 걸어 들어가는 뒷모습' })}
        ${textArea({ bind: `places#${p.id}.memo`, value: p.memo, label: '자유 메모', placeholder: '예약, 운영 시간, 주차 등' })}
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-secondary" data-shots="${p.id}">${icon('camera', 'size-4')}체크리스트</button>
          <button type="button" class="btn btn-ghost text-danger" data-del="${p.id}">${icon('trash', 'size-4')}삭제</button>
        </div>
      </div>`
          : ''
      }
    </article>`;
}

export function render(ctx, pane) {
  const { project } = ctx;
  const openId = openPlace.get(project.id);

  pane.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">${term('동선', '行程')}</h2>
      <p class="section-sub">실제로 방문할 순서예요. 편집 순서는 편집 탭에서 따로 정해요.</p>
    </div>
    ${
      project.places.length
        ? `<div class="flex flex-col gap-2.5" id="places">${project.places.map((p, i) => placeCard(project, p, i, p.id === openId)).join('')}</div>`
        : `<div class="empty card">
            <div class="empty-icon">${icon('route', 'size-6')}</div>
            <p class="font-semibold">아직 동선이 없어요</p>
            <p class="mt-1 text-[14px] text-muted">방문할 장소를 순서대로 추가해 보세요.</p>
          </div>`
    }
    <form id="place-add" class="add-row mt-3">
      <input class="input flex-1" name="name" placeholder="장소 이름 입력 후 추가" enterkeyhint="done" aria-label="새 장소 이름" />
      <button class="btn btn-primary px-4">${icon('plus')}<span class="sr-only sm:not-sr-only">추가</span></button>
    </form>`;

  pane.addEventListener('bound', (e) => {
    const m = /^places#([^.]+)\.(name|date|time)$/.exec(e.detail.path);
    if (!m) return;
    const p = project.places.find((x) => x.id === m[1]);
    const card = pane.querySelector(`[data-place="${m[1]}"]`);
    if (!p || !card) return;
    if (m[2] === 'name') card.querySelector('[data-title]').textContent = p.name || '이름 없는 장소';
    else card.querySelector('.meta-row').innerHTML = placeMeta(project, p);
  });

  pane.addEventListener('submit', (e) => {
    if (e.target.id !== 'place-add') return;
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const date = project.places.at(-1)?.date || project.startDate;
    const place = normalizePlace({ name, date });
    project.places.push(place);
    openPlace.set(project.id, place.id);
    ctx.commit();
    ctx.rerender();
    $('#place-add input')?.focus();
  });

  pane.addEventListener('click', async (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.dataset.toggle;
      openPlace.set(project.id, openPlace.get(project.id) === id ? null : id);
      ctx.rerender();
      return;
    }
    const move = e.target.closest('[data-move]');
    if (move) {
      const i = project.places.findIndex((p) => p.id === move.dataset.id);
      const j = i + Number(move.dataset.move);
      if (i < 0 || j < 0 || j >= project.places.length) return;
      [project.places[i], project.places[j]] = [project.places[j], project.places[i]];
      ctx.commit();
      ctx.rerender();
      document.querySelector(`[data-place="${move.dataset.id}"] [data-move="${move.dataset.move}"]:not([disabled])`)?.focus();
      return;
    }
    const shots = e.target.closest('[data-shots]');
    if (shots) return ctx.go('shots', shots.dataset.shots);
    const del = e.target.closest('[data-del]');
    if (del) {
      const p = project.places.find((x) => x.id === del.dataset.del);
      const ok = await confirmDialog({
        title: '장소를 삭제할까요?',
        message: `"${p.name || '이름 없는 장소'}"와 촬영 체크리스트 ${p.shots.length}개가 삭제돼요. 이 장소에 연결된 현장 기록은 남아 있어요.`,
        confirmText: '삭제',
        danger: true,
      });
      if (!ok) return;
      project.places = project.places.filter((x) => x.id !== p.id);
      project.scenes.forEach((s) => {
        if (s.link === `place:${p.id}`) s.link = '';
      });
      project.logs.forEach((l) => {
        if (l.placeId === p.id) {
          l.placeId = '';
          l.placeName = l.placeName || p.name;
        }
      });
      ctx.commit();
      ctx.rerender();
      toast('장소를 삭제했어요.');
    }
  });
}
