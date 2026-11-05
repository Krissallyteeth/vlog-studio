import { createNewProject, getProject, saveProject } from '../data/repo.js';
import { STATUSES, TYPES } from '../lib/constants.js';
import { normalizeCustomTypes } from '../lib/schema.js';
import { isEndBeforeStart, isValidDate, isWithinRange, todayString } from '../lib/dates.js';
import { navigate } from '../router.js';
import { $, esc, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { mount } from '../ui/layout.js';
import { t } from '../i18n/index.js';

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
    toast(t('project.notFound'));
    navigate('/', { replace: true });
    return null;
  }
  const v = project ?? { name: '', startDate: todayString(), endDate: '', location: '', types: [], customTypes: [], status: 'planning' };
  const back = editing ? `#/p/${encodeURIComponent(id)}` : '#/';

  const root = mount(`
    <div class="view">
      <header class="top-bar">
        <a href="${back}" class="icon-btn" aria-label="${esc(t('common.back'))}">${icon('chevronLeft')}</a>
        <h1 class="top-bar-title">${esc(editing ? t('form.editTitle') : t('nav.new'))}</h1>
        <span class="w-11"></span>
      </header>
      <main class="page-main pb-40">
        <form id="pform" class="flex flex-col gap-6" novalidate>
          <div class="field">
            <label class="field-label" for="f-name">${esc(t('project.name'))} <span class="req">${esc(t('common.required'))}</span></label>
            <input id="f-name" name="name" class="input" maxlength="80" required placeholder="${esc(t('project.namePh'))}" value="${esc(v.name)}" ${editing ? '' : 'autofocus'} />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="field">
              <label class="field-label" for="f-start">${esc(t('project.start'))} <span class="req">${esc(t('common.required'))}</span></label>
              <input id="f-start" name="startDate" type="date" class="input" required value="${esc(v.startDate)}" />
            </div>
            <div class="field">
              <label class="field-label" for="f-end">${esc(t('project.end'))} <span class="opt">${esc(t('common.optional'))}</span></label>
              <input id="f-end" name="endDate" type="date" class="input" min="${esc(v.startDate)}" value="${esc(v.endDate)}" />
            </div>
          </div>
          <p class="-mt-4 text-[13px] text-muted flex items-center justify-between gap-2">
            <span>${esc(t('project.oneDayHint'))}</span>
            <button type="button" id="clear-end" class="link-btn ${v.endDate ? '' : 'hidden'}">${esc(t('form.clearEnd'))}</button>
          </p>

          <div class="field">
            <label class="field-label" for="f-loc">${esc(t('project.location'))}</label>
            <input id="f-loc" name="location" class="input" maxlength="120" placeholder="${esc(t('project.locationPh'))}" value="${esc(v.location)}" />
          </div>

          <fieldset class="field">
            <legend class="field-label">${esc(t('project.types'))} <span class="opt">${esc(t('form.multi'))}</span></legend>
            <div class="flex flex-wrap gap-2">${choices('checkbox', 'types', TYPES, (t) => v.types.includes(t))}</div>
            <input id="f-custom-types" name="customTypes" class="input mt-2" maxlength="120" placeholder="${esc(t('form.customTypesPh'))}" value="${esc(v.customTypes.join(', '))}" aria-label="${esc(t('form.customTypes'))}" />
          </fieldset>

          <fieldset class="field">
            <legend class="field-label">${esc(t('project.status'))}</legend>
            <div class="flex flex-wrap gap-2">${choices('radio', 'status', STATUSES, (st) => st === v.status)}</div>
          </fieldset>

          <p id="form-error" class="form-error hidden" role="alert"></p>
        </form>
      </main>
      <div class="action-bar">
        <div class="action-bar-inner grid grid-cols-[1fr_2fr] gap-2">
          <a href="${back}" class="btn btn-secondary">${esc(t('common.cancel'))}</a>
          <button type="submit" form="pform" class="btn btn-primary">${esc(editing ? t('common.save') : t('form.create'))}</button>
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
    if (isEndBeforeStart(start.value, end.value)) showError(t('form.endEarlier'));
    else showError('');
  });
  end.addEventListener('change', () => {
    $('#clear-end', root).classList.toggle('hidden', !end.value);
    showError(isEndBeforeStart(start.value, end.value) ? t('project.endBeforeStart') : '');
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
      showError(t('project.nameRequired'));
      $('#f-name', root).focus();
      return;
    }
    if (!isValidDate(data.startDate)) {
      showError(t('project.startRequired'));
      start.focus();
      return;
    }
    if (data.endDate && isEndBeforeStart(data.startDate, data.endDate)) {
      showError(t('project.endBeforeStart'));
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
        toast(outside ? t('project.savedOutside', { n: outside }) : t('common.saved'));
        navigate(`/p/${encodeURIComponent(project.id)}`, { replace: true });
      } else {
        const created = await createNewProject(fields);
        toast(t('project.created'));
        navigate(`/p/${encodeURIComponent(created.id)}/plan`, { replace: true });
      }
    } catch (err) {
      showError(t('common.saveFailed', { msg: err.message }));
    }
  });

  window.scrollTo(0, 0);
  return { kind: 'form' };
}
