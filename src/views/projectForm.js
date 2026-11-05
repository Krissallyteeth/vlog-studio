import { createNewProject, getProject, saveProject } from '../data/repo.js';
import { STATUSES, TYPES } from '../lib/constants.js';
import { normalizeCustomTypes } from '../lib/schema.js';
import { isEndBeforeStart, isValidDate, isWithinRange, todayString } from '../lib/dates.js';
import { navigate } from '../router.js';
import { $, esc, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { mount } from '../ui/layout.js';

const choices = (kind, name, list, isChecked) =>
  list
    .map(
      (x) => `
      <label class="chip">
        <input type="${kind}" class="sr-only" name="${name}" value="${x.id}" ${isChecked(x.id) ? 'checked' : ''} />
        ${esc(x.label)}
      </label>`,
    )
    .join('');

export async function renderProjectForm(id, { isCurrent }) {
  const editing = Boolean(id);
  const project = editing ? await getProject(id) : null;
  if (!isCurrent()) return null;
  if (editing && !project) {
    toast('프로젝트를 찾을 수 없어요.');
    navigate('/', { replace: true });
    return null;
  }
  const v = project ?? { name: '', startDate: todayString(), endDate: '', location: '', types: [], customTypes: [], status: 'planning' };
  const back = editing ? `#/p/${encodeURIComponent(id)}` : '#/';

  const root = mount(`
    <div class="view">
      <header class="top-bar">
        <a href="${back}" class="icon-btn" aria-label="뒤로">${icon('chevronLeft')}</a>
        <h1 class="top-bar-title">${editing ? '프로젝트 정보 수정' : '새 프로젝트'}</h1>
        <span class="w-11"></span>
      </header>
      <main class="page-main pb-40">
        <form id="pform" class="flex flex-col gap-6" novalidate>
          <div class="field">
            <label class="field-label" for="f-name">프로젝트명 <span class="req">필수</span></label>
            <input id="f-name" name="name" class="input" maxlength="80" required placeholder="예: 전주 당일치기 Vlog" value="${esc(v.name)}" ${editing ? '' : 'autofocus'} />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="field">
              <label class="field-label" for="f-start">촬영 시작일 <span class="req">필수</span></label>
              <input id="f-start" name="startDate" type="date" class="input" required value="${esc(v.startDate)}" />
            </div>
            <div class="field">
              <label class="field-label" for="f-end">촬영 종료일 <span class="opt">선택</span></label>
              <input id="f-end" name="endDate" type="date" class="input" min="${esc(v.startDate)}" value="${esc(v.endDate)}" />
            </div>
          </div>
          <p class="-mt-4 text-[13px] text-muted flex items-center justify-between gap-2">
            <span>하루 촬영이면 종료일은 비워 두세요.</span>
            <button type="button" id="clear-end" class="link-btn ${v.endDate ? '' : 'hidden'}">종료일 지우기</button>
          </p>

          <div class="field">
            <label class="field-label" for="f-loc">주요 촬영 지역 / 장소</label>
            <input id="f-loc" name="location" class="input" maxlength="120" placeholder="예: 전주 · 한옥마을" value="${esc(v.location)}" />
          </div>

          <fieldset class="field">
            <legend class="field-label">영상 유형 <span class="opt">여러 개 선택 가능</span></legend>
            <div class="flex flex-wrap gap-2">${choices('checkbox', 'types', TYPES, (t) => v.types.includes(t))}</div>
            <input id="f-custom-types" name="customTypes" class="input mt-2" maxlength="120" placeholder="직접 입력 · 예: 맛집, 캠핑 (쉼표로 구분)" value="${esc(v.customTypes.join(', '))}" aria-label="영상 유형 직접 입력" />
          </fieldset>

          <fieldset class="field">
            <legend class="field-label">프로젝트 상태</legend>
            <div class="flex flex-wrap gap-2">${choices('radio', 'status', STATUSES, (st) => st === v.status)}</div>
          </fieldset>

          <p id="form-error" class="form-error hidden" role="alert"></p>
        </form>
      </main>
      <div class="action-bar">
        <div class="action-bar-inner grid grid-cols-[1fr_2fr] gap-2">
          <a href="${back}" class="btn btn-secondary">취소</a>
          <button type="submit" form="pform" class="btn btn-primary">${editing ? '저장' : '프로젝트 만들기'}</button>
        </div>
      </div>
    </div>`);

  const form = $('#pform', root);
  const start = $('#f-start', root);
  const end = $('#f-end', root);
  const error = $('#form-error', root);
  const showError = (msg) => {
    error.textContent = msg;
    error.classList.toggle('hidden', !msg);
  };

  start.addEventListener('change', () => {
    end.min = start.value;
    if (isEndBeforeStart(start.value, end.value)) showError('종료일이 시작일보다 빨라요. 종료일을 다시 선택해 주세요.');
    else showError('');
  });
  end.addEventListener('change', () => {
    $('#clear-end', root).classList.toggle('hidden', !end.value);
    showError(isEndBeforeStart(start.value, end.value) ? '종료일은 시작일 이후로 선택해 주세요.' : '');
  });
  $('#clear-end', root).addEventListener('click', (e) => {
    end.value = '';
    e.currentTarget.classList.add('hidden');
    showError('');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    const name = String(data.name ?? '').trim();
    if (!name) {
      showError('프로젝트명을 입력해 주세요.');
      $('#f-name', root).focus();
      return;
    }
    if (!isValidDate(data.startDate)) {
      showError('촬영 시작일을 선택해 주세요.');
      start.focus();
      return;
    }
    if (data.endDate && isEndBeforeStart(data.startDate, data.endDate)) {
      showError('종료일은 시작일 이후로 선택해 주세요.');
      end.focus();
      return;
    }
    const fields = {
      name,
      startDate: data.startDate,
      endDate: data.endDate && data.endDate !== data.startDate ? data.endDate : '',
      location: String(data.location ?? '').trim(),
      types: formData.getAll('types'),
      customTypes: normalizeCustomTypes(String(data.customTypes ?? '')),
      status: data.status,
    };
    try {
      if (editing) {
        Object.assign(project, fields);
        await saveProject(project);
        const outside = project.places.filter((p) => p.date && !isWithinRange(p.date, project.startDate, project.endDate)).length;
        toast(outside ? `저장했어요. 촬영 기간 밖 방문일이 ${outside}곳 있어요.` : '저장했어요.');
        navigate(`/p/${encodeURIComponent(project.id)}`, { replace: true });
      } else {
        const created = await createNewProject(fields);
        toast('프로젝트를 만들었어요.');
        navigate(`/p/${encodeURIComponent(created.id)}/plan`, { replace: true });
      }
    } catch (err) {
      showError(`저장하지 못했어요: ${err.message}`);
    }
  });

  window.scrollTo(0, 0);
  return { kind: 'form' };
}
