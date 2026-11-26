import { t } from '../../i18n/index.js';
import { $$, esc, openSheet, toast } from '../../ui/dom.js';
import { fmt } from '../../xhs/format.js';
import { saveSettings, savePosts } from '../../xhs/store.js';
import { REF_UNDER, SIDE_MIN, SPONSOR_TYPES, moveToSponsored, sponsorTypePosts, subTagCompare, typeTable } from '../../xhs/type-table.js';

/* Dashboard card: followers by main type, secondary tags with/without, sponsored filter. Keys: tt.* */

const KEY = 'xhs-type-sponsored';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const rate = (v) => (isNum(v) ? `${(v * 100).toFixed(2)}%` : '–');
const num = (v) => (isNum(v) ? (Math.round(v * 10) / 10).toLocaleString('en-US') : '–');

function getMode() {
  try {
    return localStorage.getItem(KEY) === 'exclude' ? 'exclude' : 'include';
  } catch {
    return 'include';
  }
}

function inner(posts) {
  const mode = getMode();
  const table = typeTable(posts, { sponsored: mode });
  const tags = subTagCompare(posts, { sponsored: mode });
  const toMove = sponsorTypePosts(posts);
  const toggle = `<div class="segmented !w-auto" role="radiogroup">${['include', 'exclude'].map((m) => `<button type="button" class="seg px-3 ${m === mode ? 'is-active' : ''}" data-tt-mode="${m}">${esc(t(`tt.${m}`))}</button>`).join('')}</div>`;
  const rows = table.rows
    .map(
      (r) => `<tr><td>${esc(r.type || t('data.noType'))}${r.reference ? ` <span class="badge bg-surface-2" title="${esc(t('tt.refHelp', { n: REF_UNDER }))}">${esc(t('ops.ref'))}</span>` : ''}${r.sponsored ? ` <span class="text-[11px] text-muted">${esc(t('tt.sponsoredN', { n: r.sponsored }))}</span>` : ''}</td>
        <td class="num">${r.n}</td><td class="num">${esc(fmt('views', r.views) || '–')}</td><td class="num">${esc(fmt('ctr', r.ctr) || '–')}</td><td class="num"><b>${esc(rate(r.followRate))}</b></td><td class="num">${esc(num(r.newFollowers))}</td></tr>`,
    )
    .join('');
  const tagRows = tags
    .map(
      (x) => `<tr><td>${esc(x.tag)}${x.comparable ? '' : ` <span class="text-[11px] text-muted">${esc(t('tt.tagFew', { n: SIDE_MIN }))}</span>`}</td><td class="num">${x.with.n}</td><td class="num">${esc(x.comparable ? rate(x.with.followRate) : '–')}</td><td class="num">${x.without.n}</td><td class="num">${esc(x.comparable ? rate(x.without.followRate) : '–')}</td></tr>`,
    )
    .join('');
  const tagHtml = tags.length
    ? `<h4 class="mt-4 text-[14px] font-semibold">${esc(t('tt.tagsTitle'))}</h4>
      <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('tt.tag'))}</th><th class="num">${esc(t('tt.withN'))}</th><th class="num" data-m="key">${esc(t('tt.withRate'))}</th><th class="num">${esc(t('tt.withoutN'))}</th><th class="num" data-m="inline">${esc(t('tt.withoutRate'))}</th></tr></thead><tbody>${tagRows}</tbody></table></div>
      <p class="mt-1 text-[12px] text-muted">${esc(t('tt.tagsNote'))}</p>`
    : `<p class="mt-3 text-[12px] text-muted">${esc(t('tt.noTags'))}</p>`;
  const move = toMove.length ? `<div class="notice mt-3 flex flex-col items-start gap-2 text-[13px] sm:flex-row sm:items-center"><span class="flex-1">${esc(t('tt.moveHint', { n: toMove.length }))}</span><button type="button" class="btn btn-secondary btn-sm" data-tt-move>${esc(t('tt.moveBtn'))}</button></div>` : '';
  return `<div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-[15px] font-semibold">${esc(t('tt.title'))}</h3>${toggle}</div>
    <p class="mt-1 text-[12px] text-muted">${esc(t('tt.sub', { n: table.total, s: table.sponsoredTotal }))}</p>
    ${table.rows.length ? `<div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('tt.type'))}</th><th class="num" data-m="inline">${esc(t('tt.n'))}</th><th class="num">${esc(t('tt.views'))}</th><th class="num">${esc(t('tt.ctr'))}</th><th class="num" data-m="key">${esc(t('tt.followRate'))}</th><th class="num">${esc(t('tt.newFollowers'))}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="mt-2 text-[13px] text-muted">${esc(t('tt.empty'))}</p>`}
    <p class="mt-1 text-[12px] text-muted">${esc(t('tt.note', { n: REF_UNDER }))}</p>
    ${tagHtml}${move}`;
}

export const typeTableHtml = (posts) => `<section class="card" id="type-table">${inner(posts)}</section>`;

async function moveSheet(posts, settings) {
  const list = sponsorTypePosts(posts);
  const types = settings.contentTypes.filter((x) => !SPONSOR_TYPES.includes(x));
  const options = (sel) => `<option value="">${esc(t('data.noType'))}</option>${types.map((x) => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
  const result = await openSheet({
    title: t('tt.moveTitle'),
    body: `<p class="text-[13px] text-muted">${esc(t('tt.moveHelp'))}</p>
      <ul class="mt-3 flex flex-col gap-2">${list
        .map((p) => `<li class="rounded-[10px] bg-surface-2 p-2.5 text-[13px]"><label class="flex items-center gap-2"><input type="checkbox" data-mv="${esc(p.id)}" checked /> <b class="flex-1">${esc(p.title || t('xg.untitled'))}</b><span class="text-muted">${esc(p.date)}</span></label>
          <label class="field mt-1"><span class="field-label">${esc(t('tt.mainType'))}</span><select class="input" data-mv-type="${esc(p.id)}">${options('')}</select></label></li>`)
        .join('')}</ul>
      <label class="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" id="mv-drop" checked /> ${esc(t('tt.dropType'))}</label>
      <div class="mt-3 grid grid-cols-[1fr_2fr] gap-2"><button type="button" class="btn btn-secondary" data-v="">${esc(t('common.cancel'))}</button><button type="button" class="btn btn-primary" data-v="1">${esc(t('tt.moveSave'))}</button></div>`,
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        if (!b.dataset.v) return close(null);
        const picks = $$('[data-mv]', el).filter((x) => x.checked).map((x) => ({ id: x.dataset.mv, type: el.querySelector(`[data-mv-type="${CSS.escape(x.dataset.mv)}"]`).value }));
        close({ picks, drop: el.querySelector('#mv-drop').checked });
      });
    },
  });
  if (!result?.picks.length) return;
  const byId = new Map(posts.map((p) => [p.id, p]));
  await savePosts(result.picks.map((x) => moveToSponsored(byId.get(x.id), x.type)));
  const left = list.length - result.picks.length;
  if (result.drop && left === 0) await saveSettings({ ...settings, contentTypes: settings.contentTypes.filter((x) => !SPONSOR_TYPES.includes(x)) });
  toast(t('tt.moved', { n: result.picks.length }));
}

/** Sponsored filter (redraws the card) and the move sheet. */
export function bindTypeTable(root, posts, settings) {
  root.addEventListener('click', async (e) => {
    const mode = e.target.closest('[data-tt-mode]')?.dataset.ttMode;
    if (mode) {
      try {
        localStorage.setItem(KEY, mode);
      } catch {
        /* ignore */
      }
      const card = root.querySelector('#type-table');
      if (card) card.innerHTML = inner(posts);
      return;
    }
    if (e.target.closest('[data-tt-move]')) await moveSheet(posts, settings);
  });
}
