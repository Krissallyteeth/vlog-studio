/*
 * Phone-friendly tables. Every read-only table (.xtable, not the editable spreadsheet .xgrid) gets
 * a data-label on each cell from its column header; on narrow screens the CSS (styles.css,
 * "stacked tables") shows each row as a card: the first cell as its heading, the rest as
 * "label · value" pairs, empty cells hidden. Wide screens keep the normal table.
 */

const EMPTY_OK = 'input,select,textarea,button,a,img,svg';

export function stackTables(root = document) {
  for (const table of root.querySelectorAll('table.xtable:not(.xgrid)')) {
    const heads = [...table.querySelectorAll('thead tr:last-child th')].map((th) => th.textContent.replace(/\s+/g, ' ').trim());
    table.classList.add('stack');
    for (const tr of table.querySelectorAll('tbody tr')) {
      if (tr.dataset.stacked === '1') continue;
      tr.dataset.stacked = '1';
      let col = 0;
      let filled = 0;
      for (const td of tr.children) {
        if (!td.hasAttribute('data-label')) td.dataset.label = heads[col] ?? '';
        col += Number(td.getAttribute('colspan') || 1);
        const blank = !td.textContent.replace(/[\s–-]+/g, '') && !td.querySelector(EMPTY_OK);
        td.classList.toggle('is-blank', blank);
        if (!blank && td !== tr.firstElementChild) filled++;
      }
      // A row with a heading but no values at all (e.g. a metric never recorded) is hidden on phones.
      tr.classList.toggle('is-blank-row', tr.children.length > 2 && filled === 0);
    }
  }
}

/** Keeps every table on the page stacked-ready, also tables drawn later. */
export function watchTables() {
  if (typeof MutationObserver === 'undefined') return;
  let queued = false;
  const run = () => {
    queued = false;
    stackTables(document);
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  }).observe(document.body, { childList: true, subtree: true });
  run();
}
