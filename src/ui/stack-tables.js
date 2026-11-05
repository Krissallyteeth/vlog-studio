/*
 * Phone-friendly tables (below 640px; wide screens keep normal tables). Following common mobile
 * table guidance (keep the identifying column visible, show only the few values that matter, put
 * the rest one tap away, prefer light lists over heavy boxes), each row becomes a list item:
 *
 *   Title (first cell)                       key value
 *   label value · label value · label value          ⌄
 *   (tap) → the remaining values in two columns
 *
 * Header cells can say what a column is for: data-m="key" (the number on the right),
 * data-m="inline" (summary line), data-m="more" (only after a tap). Without marks, small tables
 * show everything in the summary and bigger ones the first three values. Tables with inputs, or
 * marked data-stack="cards", become simple cards instead. The editable spreadsheet (.xgrid) is
 * left alone. CSS: styles.css, "stacked tables".
 */

const INTERACTIVE = 'input,select,textarea,button,a,img,svg';
const MAX_INLINE = 3;

function roles(table, heads) {
  const marked = heads.some((h) => h.m);
  return heads.map((h, i) => {
    if (i === 0) return 'title';
    if (marked) return h.m || 'more';
    return heads.length - 1 <= 4 ? 'inline' : 'auto';
  });
}

export function stackTables(root = document) {
  for (const table of root.querySelectorAll('table.xtable:not(.xgrid)')) {
    const ths = [...table.querySelectorAll('thead tr:last-child th')];
    const heads = ths.map((th) => ({ label: th.textContent.replace(/\s+/g, ' ').trim(), m: th.dataset.m || '' }));
    const cards = table.dataset.stack === 'cards' || !!table.querySelector('tbody input, tbody select');
    table.classList.add('stack');
    table.classList.toggle('stack-cards', cards);
    table.classList.toggle('stack-list', !cards);
    const role = roles(table, heads);
    for (const tr of table.querySelectorAll('tbody tr')) {
      if (tr.dataset.stacked === '1') continue;
      tr.dataset.stacked = '1';
      let col = 0;
      let inline = 0;
      let more = 0;
      let filled = 0;
      for (const td of tr.children) {
        if (!td.hasAttribute('data-label')) td.dataset.label = heads[col]?.label ?? '';
        const blank = !td.textContent.replace(/[\s–-]+/g, '') && !td.querySelector(INTERACTIVE);
        td.classList.toggle('is-blank', blank);
        let r = td.hasAttribute('colspan') ? 'span' : role[col] ?? 'more';
        if (r === 'auto') r = !blank && inline < MAX_INLINE ? 'inline' : 'more';
        if (r === 'inline' && !blank) inline++;
        if (r === 'more' && !blank) more++;
        if (!blank && col > 0) filled++;
        td.classList.add(`m-${r}`);
        col += Number(td.getAttribute('colspan') || 1);
      }
      tr.classList.toggle('has-more', more > 0);
      // A row with a heading but no values at all (e.g. a metric never recorded) is hidden on phones.
      tr.classList.toggle('is-blank-row', tr.children.length > 2 && filled === 0);
    }
  }
}

/** Keeps every table on the page ready, also tables drawn later; rows open on tap (phones). */
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
  document.addEventListener('click', (e) => {
    if (!matchMedia('(max-width: 639.98px)').matches) return;
    const tr = e.target.closest('table.stack-list tr.has-more');
    if (!tr || e.target.closest(INTERACTIVE)) return;
    tr.classList.toggle('is-open');
  });
  run();
}
