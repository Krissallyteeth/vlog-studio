import { SHOT_TYPES } from '../../lib/constants.js';
import { allShotStats, shotStats } from '../../lib/progress.js';
import { MAX_PHOTOS, normalizeShot } from '../../lib/schema.js';
import { addPhotos, photoUrl } from '../../data/media.js';
import { $, actionSheet, esc, openSheet, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { t } from '../../i18n/index.js';

let addType = 'env';
const selectedPlace = new Map(); // projectId -> placeId
const touchDevice = () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

function photoStrip(s) {
  if (!s.photos.length) return '';
  return `<div class="shot-photos">${s.photos
    .map((id) => `<button type="button" class="shot-photo" data-photo="${id}" data-shot-of="${s.id}" aria-label="${esc(t('photos.view'))}"><img data-photo-id="${id}" alt="" /></button>`)
    .join('')}</div>`;
}

function shotItem(place, s) {
  const type = SHOT_TYPES.find((x) => x.id === s.type);
  const base = `places#${place.id}.shots#${s.id}`;
  return `
    <li class="shot-item ${s.done ? 'is-done' : ''}" data-shot="${s.id}">
      <label class="check" aria-label="${esc(t('shots.done'))}">
        <input type="checkbox" data-bind="${base}.done" ${s.done ? 'checked' : ''} />
        <span class="check-box">${icon('check', 'size-4')}</span>
      </label>
      <div class="min-w-0 flex-1">
        <select class="type-select type-${s.type}" data-bind="${base}.type" aria-label="${esc(t('shots.changeType'))}">
          ${SHOT_TYPES.map((x) => `<option value="${x.id}" ${x.id === s.type ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>
        ${photoStrip(s)}
        <input class="input-plain mt-1 font-medium shot-desc" data-bind="${base}.desc" value="${esc(s.desc)}" placeholder="${esc(type.hint)}" aria-label="${esc(t('shots.desc'))}" />
        <input class="input-plain text-[14px] text-muted" data-bind="${base}.memo" value="${esc(s.memo)}" placeholder="${esc(t('shots.memoPh'))}" aria-label="${esc(t('shots.memo'))}" />
      </div>
      <div class="flex flex-col">
        <button type="button" class="icon-btn icon-btn-sm" data-del="${s.id}" aria-label="${esc(t('shots.deleteAria'))}">${icon('x', 'size-[18px]')}</button>
        <button type="button" class="icon-btn icon-btn-sm" data-add-photo="${s.id}" aria-label="${esc(t('photos.addToShot'))}" ${s.photos.length >= MAX_PHOTOS ? 'disabled' : ''}>${icon('camera', 'size-[18px]')}</button>
      </div>
    </li>`;
}

function statsText(st) {
  return st.total ? t('shots.stats', { done: st.done, total: st.total, pct: st.pct }) : t('shots.none');
}

export function render(ctx, pane, sub) {
  const { project } = ctx;
  if (!project.places.length) {
    pane.innerHTML = `
      <div class="section-head">
        <h2 class="section-title">${esc(t('shots.title'))}</h2>
      </div>
      <div class="empty card">
        <div class="empty-icon">${icon('camera', 'size-6')}</div>
        <p class="font-semibold">${esc(t('shots.emptyTitle'))}</p>
        <p class="mt-1 text-[14px] text-muted">${esc(t('shots.emptyHint'))}</p>
        <button type="button" class="btn btn-primary mt-4" data-go="route">${esc(t('shots.emptyBtn'))}</button>
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
      <h2 class="section-title">${esc(t('shots.title'))}</h2>
      <p class="section-sub">${esc(t('shots.sub'))}</p>
    </div>
    <p class="text-[13px] text-muted mb-2" id="all-stats">${esc(t('shots.all', { done: all.done, total: all.total }))}</p>
    <div class="chip-row" role="tablist" aria-label="${esc(t('shots.pickPlace'))}">
      ${project.places
        .map((p, i) => {
          const s = shotStats(p);
          return `<button type="button" role="tab" class="chip" data-place="${p.id}" aria-pressed="${p.id === place.id}" aria-selected="${p.id === place.id}">
            ${i + 1}. ${esc(p.name || t('place.unnamed'))}${s.total ? ` <span class="chip-count" data-chip-pct="${p.id}">${s.pct}%</span>` : ''}
          </button>`;
        })
        .join('')}
    </div>

    <section class="card mt-3 drop-target" id="shot-card">
      <div class="drop-overlay" aria-hidden="true">${icon('camera', 'size-6')}<span>${esc(t('photos.dropHere'))}</span></div>
      <div class="flex items-center justify-between gap-3">
        <h3 class="truncate text-[17px] font-semibold">${esc(place.name || t('place.unnamed'))}</h3>
        <span class="shrink-0 text-[13px] tabular-nums text-muted" id="place-stats">${statsText(st)}</span>
      </div>
      <div class="progress mt-2.5"><span id="place-bar" style="width:${st.pct}%"></span></div>
      ${place.shotIdea ? `<p class="guide mt-3">${icon('idea', 'size-4 mt-0.5')}<span>${esc(place.shotIdea)}</span></p>` : ''}

      <ul class="mt-3 flex flex-col" id="shot-list">
        ${place.shots.map((s) => shotItem(place, s)).join('') || `<li class="py-6 text-center text-[14px] text-muted">${esc(t('shots.emptyList'))}${touchDevice() ? '' : `<br><span class="text-[13px]">${esc(t('photos.dropHint'))}</span>`}</li>`}
      </ul>

      <form id="shot-add" class="mt-3 border-t border-line pt-3">
        <div class="chip-row" role="radiogroup" aria-label="${esc(t('shots.type'))}">
          ${SHOT_TYPES.map(
            (x) => `<label class="chip chip-sm"><input type="radio" class="sr-only" name="type" value="${x.id}" ${x.id === addType ? 'checked' : ''}/>${esc(x.name)}<span class="text-muted font-normal">${esc(x.desc)}</span></label>`,
          ).join('')}
        </div>
        <div class="add-row mt-2">
          <input class="input flex-1" name="desc" placeholder="${esc(SHOT_TYPES.find((x) => x.id === addType).hint)}" enterkeyhint="done" aria-label="${esc(t('shots.desc'))}" />
          <button type="button" class="btn btn-secondary px-3.5" data-pick-photos aria-label="${esc(t('photos.add'))}">${icon('camera')}</button>
          <button class="btn btn-primary px-4" aria-label="${esc(t('shots.addAria'))}">${icon('plus')}</button>
        </div>
        <p class="mt-2 text-[12px] text-muted">${esc(t('photos.hint'))}</p>
        <input type="file" accept="image/*" multiple class="hidden" id="photo-pick" />
        <input type="file" accept="image/*" capture="environment" class="hidden" id="photo-cam" />
      </form>
    </section>`;

  function refreshStats() {
    const s = shotStats(place);
    const a = allShotStats(project);
    $('#place-stats', pane).textContent = statsText(s);
    $('#place-bar', pane).style.width = `${s.pct}%`;
    $('#all-stats', pane).textContent = t('shots.all', { done: a.done, total: a.total });
    const chip = pane.querySelector(`[data-chip-pct="${place.id}"]`);
    if (chip) chip.textContent = `${s.pct}%`;
  }

  pane.addEventListener('bound', (e) => {
    if (e.detail.path.endsWith('.type')) return ctx.rerender(); // new hint text and colour
    if (!e.detail.path.endsWith('.done')) return;
    e.detail.el.closest('.shot-item')?.classList.toggle('is-done', e.detail.value);
    refreshStats();
  });

  pane.addEventListener('change', (e) => {
    if (e.target.name === 'type' && e.target.closest('#shot-add')) {
      addType = e.target.value;
      $('#shot-add [name="desc"]', pane).placeholder = SHOT_TYPES.find((x) => x.id === addType).hint;
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

  // ── Photos: pick, shoot, drop or paste ──
  let photoTarget = null; // shot id when adding to an existing item, else new items
  async function takeFiles(fileList) {
    const files = [...(fileList ?? [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) return;
    const target = photoTarget && place.shots.find((s) => s.id === photoTarget);
    photoTarget = null;
    toast(t('photos.adding'));
    const ids = await addPhotos(files);
    if (target) {
      const room = MAX_PHOTOS - target.photos.length;
      target.photos.push(...ids.slice(0, room));
      if (ids.length > room) toast(t('photos.max', { n: MAX_PHOTOS }));
    } else {
      ids.forEach((id) => place.shots.push(normalizeShot({ type: addType, photos: [id] })));
    }
    if (ids.length) {
      await ctx.commit();
      ctx.rerender();
    }
    const failed = files.length - ids.length;
    if (failed) toast(t('photos.failed', { n: failed }), { tone: 'error' });
    else if (ids.length && !(target && ids.length > MAX_PHOTOS - target.photos.length)) toast(t('photos.added', { n: ids.length }));
  }

  async function pickPhotos() {
    if (!touchDevice()) return $('#photo-pick', pane).click();
    const how = await actionSheet({
      title: t('photos.add'),
      actions: [
        { id: 'album', label: t('photos.album'), icon: 'archive' },
        { id: 'camera', label: t('photos.camera'), icon: 'camera' },
      ],
    });
    if (how) $(how === 'camera' ? '#photo-cam' : '#photo-pick', pane).click();
  }

  pane.addEventListener('change', (e) => {
    if (e.target.id === 'photo-pick' || e.target.id === 'photo-cam') {
      takeFiles(e.target.files);
      e.target.value = '';
    }
  });

  const card = $('#shot-card', pane);
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  card.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    card.classList.add('is-dragging');
  });
  card.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      card.classList.remove('is-dragging');
    }
  });
  card.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    card.classList.remove('is-dragging');
    const shot = e.target.closest('[data-shot]')?.dataset.shot;
    photoTarget = shot ?? null; // dropped on an item: add to it
    takeFiles(e.dataTransfer.files);
  });
  // A file dropped next to the card must not make the browser open it instead of the app.
  const stray = (e) => hasFiles(e) && e.preventDefault();
  const onPaste = (e) => {
    if (e.target.closest?.('input, textarea') && !e.clipboardData?.files?.length) return;
    if (e.clipboardData?.files?.length) {
      e.preventDefault();
      photoTarget = null;
      takeFiles(e.clipboardData.files);
    }
  };
  window.addEventListener('dragover', stray);
  window.addEventListener('drop', stray);
  window.addEventListener('paste', onPaste);

  // Thumbnails load after render (from this device, or downloaded from the sync server).
  pane.querySelectorAll('img[data-photo-id]').forEach((img) => {
    photoUrl(img.dataset.photoId).then((url) => {
      if (url) img.src = url;
      else img.closest('.shot-photo')?.classList.add('is-missing');
    });
  });

  async function viewPhoto(shotId, id) {
    const shot = place.shots.find((s) => s.id === shotId);
    const url = await photoUrl(id);
    const remove = await openSheet({
      title: t('photos.view'),
      body: `
        ${url ? `<img src="${url}" alt="" class="photo-full" />` : `<p class="py-8 text-center text-muted">${esc(t('photos.missing'))}</p>`}
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-ghost text-danger" data-v="remove">${icon('trash', 'size-4')}${esc(t('photos.remove'))}</button>
          <button type="button" class="btn btn-secondary" data-v="">${esc(t('common.close'))}</button>
        </div>`,
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]');
          if (b) close(b.dataset.v || null);
        });
      },
    });
    if (remove !== 'remove' || !shot) return;
    shot.photos = shot.photos.filter((x) => x !== id);
    await ctx.commit();
    ctx.rerender();
    toast(t('photos.removed'));
  }

  pane.addEventListener('click', (e) => {
    if (e.target.closest('[data-pick-photos]')) {
      photoTarget = null;
      return pickPhotos();
    }
    const addTo = e.target.closest('[data-add-photo]');
    if (addTo) {
      photoTarget = addTo.dataset.addPhoto;
      return pickPhotos();
    }
    const ph = e.target.closest('[data-photo]');
    if (ph) return viewPhoto(ph.dataset.shotOf, ph.dataset.photo);
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

  return () => {
    window.removeEventListener('dragover', stray);
    window.removeEventListener('drop', stray);
    window.removeEventListener('paste', onPaste);
  };
}
