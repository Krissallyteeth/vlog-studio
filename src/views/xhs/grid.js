import { t } from '../../i18n/index.js';
import { esc, openSheet } from '../../ui/dom.js';

/*
 * Spreadsheet-like table.
 *  - Sticky header rows and sticky left (frozen) columns, horizontal scroll.
 *  - Click selects a cell; arrows / Tab / Enter move; typing, Enter, F2 or double-click edits.
 *  - Paste (Ctrl/⌘+V) of a block copied from Excel fills cells from the selected one.
 *  - Edits stay pending (highlighted) until "Review & save": a list of before → after is shown first.
 *  - Ctrl/⌘+Z undoes the last pending edit or paste.
 *
 * columns: [{ id, label, sub?, group?, width?, editable?, options?: [values] }]
 * rows:    [{ key, ... }] (opaque objects)
 * value(row, col)            → current stored value
 * render(row, col, value)    → { text, cls?, title?, html? }
 * parse(col, text)           → { ok: true, value } | { ok: false }
 * editText(col, value)       → text shown in the editor
 * onSave(changes)            → Promise; changes: [{ row, col, before, after }]
 * label(row)                 → row name for the review list
 * onOpen(row)                → open the row's detail
 */
export function createGrid(host, opts) {
  const { columns, frozen = 1, value, render, parse, editText, onSave, label, onOpen } = opts;
  let rows = opts.rows;
  let sel = null; // { r, c }
  let editing = null; // { r, c, input }
  const pending = new Map(); // `${rowKey}\u0000${colId}` → { row, col, before, after }
  const undo = []; // batches: [{ key, prev }] (prev = previous pending entry or undefined)

  host.innerHTML = `
    <div class="grid-toolbar" data-grid-bar></div>
    <div class="table-scroll grid-scroll" tabindex="0" data-grid-scroll aria-label="${esc(t('grid.aria'))}"></div>`;
  const scroll = host.querySelector('[data-grid-scroll]');
  const bar = host.querySelector('[data-grid-bar]');
  // Invisible input kept over the selected cell. Typing (including Korean/Chinese IME composition)
  // goes straight into it, and it becomes the cell editor — so no first character is ever lost.
  // inputmode="none" keeps phones from opening the keyboard just because a cell was tapped.
  host.style.position = 'relative';
  const proxy = document.createElement('input');
  proxy.className = 'grid-proxy';
  proxy.setAttribute('inputmode', 'none');
  proxy.setAttribute('aria-hidden', 'true');
  proxy.tabIndex = -1;
  host.append(proxy);

  const k = (row, col) => `${row.key}\u0000${col.id}`;
  const current = (row, col) => {
    const p = pending.get(k(row, col));
    return p ? p.after : value(row, col);
  };

  function headerHtml() {
    const groups = [];
    for (const c of columns) {
      const g = c.group ?? '';
      if (groups.length && groups.at(-1).g === g) groups.at(-1).n++;
      else groups.push({ g, n: 1, cls: c.groupCls ?? '' });
    }
    let ci = 0;
    const groupRow = groups
      .map((g) => {
        const start = ci;
        ci += g.n;
        const sticky = start < frozen ? `data-sticky="${start}"` : '';
        return `<th colspan="${g.n}" class="grid-group ${g.cls}" ${sticky}>${esc(g.g)}</th>`;
      })
      .join('');
    const colRow = columns
      .map((c, i) => `<th class="${c.num ? 'num' : ''} ${c.groupCls ?? ''}" ${i < frozen ? `data-sticky="${i}"` : ''} style="min-width:${c.width ?? 84}px" title="${esc(c.title ?? '')}">${esc(c.label)}${c.computed ? ' <span class="text-muted" title="ƒ">ƒ</span>' : ''}${c.sub ? `<span class="grid-sub">${esc(c.sub)}</span>` : ''}</th>`)
      .join('');
    return `<thead><tr class="grid-groups">${groupRow}</tr><tr>${colRow}</tr></thead>`;
  }

  function cellHtml(row, col, r, c) {
    const v = current(row, col);
    const out = render(row, col, v) ?? { text: '' };
    const pend = pending.has(k(row, col));
    const cls = [out.cls ?? '', col.num ? 'num' : '', col.editable ? 'editable' : 'readonly', pend ? 'is-pending' : '', sel && sel.r === r && sel.c === c ? 'is-sel' : ''].join(' ');
    return `<td class="${cls}" data-r="${r}" data-c="${c}" ${c < frozen ? `data-sticky="${c}"` : ''} title="${esc(out.title ?? '')}">${out.html ?? esc(out.text ?? '')}</td>`;
  }

  function draw() {
    const body = rows.length
      ? rows.map((row, r) => `<tr data-row="${r}" class="${row.rowCls ?? ''}">${columns.map((col, c) => cellHtml(row, col, r, c)).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}" class="py-8 text-center text-muted">${esc(t('grid.empty'))}</td></tr>`;
    const left = scroll.scrollLeft;
    const top = scroll.scrollTop;
    scroll.innerHTML = `<table class="xtable xgrid">${headerHtml()}<tbody>${body}</tbody></table>`;
    stickLeft();
    scroll.scrollLeft = left;
    scroll.scrollTop = top;
    drawBar();
  }

  /** Frozen columns: each gets `left` = sum of the widths before it. */
  function stickLeft() {
    const first = scroll.querySelector('tbody tr') ?? scroll.querySelector('thead tr:last-child');
    if (!first) return;
    const widths = [...scroll.querySelectorAll('thead tr:last-child th')].slice(0, frozen).map((th) => th.getBoundingClientRect().width);
    const offsets = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
    scroll.querySelectorAll('[data-sticky]').forEach((el) => {
      const i = Number(el.dataset.sticky);
      el.style.left = `${offsets[i] ?? 0}px`;
      el.classList.add('is-frozen');
      if (i === frozen - 1) el.classList.add('is-frozen-last');
    });
  }

  function drawBar() {
    const n = pending.size;
    bar.innerHTML = n
      ? `<span class="text-[13px] font-semibold">${esc(t('grid.pending', { n }))}</span>
         <button type="button" class="btn btn-secondary btn-sm" data-act="undo">${esc(t('grid.undo'))}</button>
         <button type="button" class="btn btn-ghost btn-sm" data-act="revert">${esc(t('grid.revert'))}</button>
         <button type="button" class="btn btn-primary btn-sm" data-act="save">${esc(t('grid.review'))}</button>`
      : `<span class="text-[12px] text-muted">${esc(t('grid.hint'))}</span>`;
    bar.classList.toggle('has-pending', n > 0);
  }

  function select(r, c, { keepFocus = false } = {}) {
    if (!rows.length) return;
    r = Math.max(0, Math.min(rows.length - 1, r));
    c = Math.max(0, Math.min(columns.length - 1, c));
    scroll.querySelector('td.is-sel')?.classList.remove('is-sel');
    sel = { r, c };
    const td = cellEl(r, c);
    td?.classList.add('is-sel');
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    placeProxy(td);
    if (!keepFocus) proxy.focus({ preventScroll: true });
  }
  function placeProxy(td) {
    if (!td) return;
    const a = td.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    Object.assign(proxy.style, { left: `${a.left - h.left}px`, top: `${a.top - h.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  }
  function beginProxyEdit() {
    if (editing || !sel) return;
    const col = columns[sel.c];
    if (!col.editable) {
      proxy.value = '';
      return;
    }
    if (col.options) {
      proxy.value = '';
      return startEdit();
    }
    placeProxy(cellEl(sel.r, sel.c));
    proxy.classList.add('is-active');
    proxy.setAttribute('inputmode', col.num ? 'decimal' : 'text');
    editing = { r: sel.r, c: sel.c, input: proxy, proxy: true };
  }
  function releaseProxy() {
    proxy.classList.remove('is-active');
    proxy.setAttribute('inputmode', 'none');
    proxy.value = '';
  }
  const cellEl = (r, c) => scroll.querySelector(`td[data-r="${r}"][data-c="${c}"]`);

  function setPending(batch, row, col, after) {
    const key = k(row, col);
    const before = value(row, col);
    const prev = pending.get(key);
    batch.push({ key, prev });
    const same = (a, b) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-12);
    if (same(before, after)) pending.delete(key);
    else pending.set(key, { row, col, before, after });
  }

  function startEdit(initial) {
    if (!sel) return;
    const row = rows[sel.r];
    const col = columns[sel.c];
    if (!col.editable) return;
    const td = cellEl(sel.r, sel.c);
    const text = initial ?? editText(col, current(row, col));
    td.classList.add('is-editing');
    if (col.options) {
      td.innerHTML = `<select class="grid-input">${['', ...col.options].map((o) => `<option ${String(o) === String(current(row, col) ?? '') ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else {
      td.innerHTML = `<input class="grid-input ${col.num ? 'text-right' : ''}" value="${esc(text)}" ${col.inputType ? `type="${col.inputType}"` : ''} />`;
    }
    const input = td.firstElementChild;
    editing = { r: sel.r, c: sel.c, input };
    input.focus();
    if (initial == null && input.select) input.select();
    else if (input.setSelectionRange && input.type !== 'date' && input.type !== 'time') input.setSelectionRange(input.value.length, input.value.length);
  }

  function commitEdit(move) {
    if (!editing) return;
    const { r, c, input } = editing;
    const text = input.value;
    if (editing.proxy) releaseProxy();
    editing = null;
    const row = rows[r];
    const col = columns[c];
    const res = parse(col, text);
    if (!res.ok) {
      flash(t('grid.invalid', { v: text }));
    } else {
      const batch = [];
      setPending(batch, row, col, res.value);
      undo.push(batch);
    }
    draw();
    select(r + (move === 'down' ? 1 : 0), c + (move === 'right' ? 1 : move === 'left' ? -1 : 0));
  }
  function cancelEdit() {
    if (!editing) return;
    const { r, c } = editing;
    if (editing.proxy) releaseProxy();
    editing = null;
    draw();
    select(r, c);
  }

  let flashTimer;
  function flash(msg) {
    bar.dataset.flash = msg;
    bar.classList.add('is-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => bar.classList.remove('is-flash'), 2600);
  }

  function paste(text) {
    if (!sel) return;
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const batch = [];
    let bad = 0;
    let skipped = 0;
    lines.forEach((cells, i) =>
      cells.forEach((cellText, j) => {
        const row = rows[sel.r + i];
        const col = columns[sel.c + j];
        if (!row || !col) return void skipped++;
        if (!col.editable) return void skipped++;
        const res = parse(col, cellText);
        if (!res.ok) return void bad++;
        setPending(batch, row, col, res.value);
      }),
    );
    if (batch.length) undo.push(batch);
    draw();
    select(sel.r, sel.c);
    if (bad || skipped) flash(t('grid.pasteReport', { ok: batch.length, bad, skipped }));
  }

  function undoLast() {
    const batch = undo.pop();
    if (!batch) return;
    for (const { key, prev } of [...batch].reverse()) {
      if (prev) pending.set(key, prev);
      else pending.delete(key);
    }
    draw();
    if (sel) select(sel.r, sel.c);
  }

  async function review() {
    const changes = [...pending.values()];
    const fmtV = (ch, v) => render(ch.row, ch.col, v)?.text ?? '';
    const ok = await openSheet({
      title: t('grid.reviewTitle', { n: changes.length }),
      body: `<div class="table-scroll max-h-[55vh]"><table class="xtable">
        <thead><tr><th>${esc(t('grid.row'))}</th><th>${esc(t('grid.col'))}</th><th class="num">${esc(t('grid.before'))}</th><th class="num">${esc(t('grid.after'))}</th></tr></thead>
        <tbody>${changes.map((ch) => `<tr><td>${esc(label(ch.row))}</td><td>${esc(ch.col.label)}</td><td class="num text-muted">${esc(fmtV(ch, ch.before) || '∅')}</td><td class="num font-semibold">${esc(fmtV(ch, ch.after) || '∅')}</td></tr>`).join('')}</tbody></table></div>
        <p class="mt-2 text-[12px] text-muted">${esc(t('grid.reviewNote'))}</p>
        <div class="mt-3 grid grid-cols-[1fr_2fr] gap-2"><button type="button" class="btn btn-secondary" data-v="">${esc(t('common.cancel'))}</button><button type="button" class="btn btn-primary" data-v="1">${esc(t('grid.saveN', { n: changes.length }))}</button></div>`,
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]');
          if (b) close(b.dataset.v === '1');
        });
      },
    });
    if (!ok) return;
    await onSave(changes);
    pending.clear();
    undo.length = 0;
  }

  // ── Events ──
  scroll.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td[data-r]');
    if (!td || e.target.closest('.grid-input')) return;
    if (!e.target.closest('[data-open-row]')) e.preventDefault(); // keep focus on the typing proxy
    if (editing) commitEdit();
    select(Number(td.dataset.r), Number(td.dataset.c));
  });
  scroll.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-row]');
    if (open) onOpen?.(rows[Number(open.dataset.openRow)]);
  });
  scroll.addEventListener('dblclick', (e) => {
    if (e.target.closest('td[data-r]') && !editing) startEdit();
  });
  host.addEventListener('keydown', (e) => {
    if (bar.contains(e.target) || e.isComposing || e.keyCode === 229) return;
    if (editing) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit('down');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit(e.shiftKey ? 'left' : 'right');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
      return;
    }
    if (!sel) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return undoLast();
    }
    if (mod && e.key.toLowerCase() === 'c') {
      const v = render(rows[sel.r], columns[sel.c], current(rows[sel.r], columns[sel.c]))?.text ?? '';
      navigator.clipboard?.writeText(v).catch(() => {});
      return;
    }
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      return select(sel.r + moves[e.key][0], sel.c + moves[e.key][1]);
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      return select(sel.r, sel.c + (e.shiftKey ? -1 : 1));
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      return startEdit();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const col = columns[sel.c];
      if (!col.editable) return;
      e.preventDefault();
      const batch = [];
      setPending(batch, rows[sel.r], col, col.options ? '' : null);
      undo.push(batch);
      draw();
      return select(sel.r, sel.c);
    }
    // Printable keys fall through into the proxy input; its "input" event starts editing.
  });
  proxy.addEventListener('compositionstart', beginProxyEdit);
  proxy.addEventListener('input', (e) => {
    if (!e.isComposing) beginProxyEdit();
  });
  host.addEventListener('focusout', (e) => {
    if (editing && e.target === editing.input && !host.contains(e.relatedTarget)) commitEdit();
  });
  host.addEventListener('paste', (e) => {
    if (editing) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    paste(text);
  });
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'undo') undoLast();
    if (act === 'revert') {
      pending.clear();
      undo.length = 0;
      draw();
    }
    if (act === 'save') review();
  });

  draw();
  return {
    setRows(next) {
      rows = next;
      sel = null;
      draw();
    },
    redraw: draw,
    hasPending: () => pending.size > 0,
    /** The row of the selected cell (or null). */
    selectedRow: () => (sel ? rows[sel.r] ?? null : null),
    /** Forgets unsaved edits of a row that is being removed. */
    dropRow(key) {
      for (const k2 of [...pending.keys()]) if (k2.startsWith(`${key}\u0000`)) pending.delete(k2);
      for (const batch of undo) for (let i = batch.length - 1; i >= 0; i--) if (batch[i].key.startsWith(`${key}\u0000`)) batch.splice(i, 1);
    },
    focusRow(key) {
      const r = rows.findIndex((x) => x.key === key);
      if (r < 0) return;
      select(r, 0);
      scroll.querySelector(`tr[data-row="${r}"]`)?.classList.add('is-focus-row');
    },
  };
}
