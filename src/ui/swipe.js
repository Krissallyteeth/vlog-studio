/**
 * Swipe-left-to-reveal rows (like iOS mail). Markup:
 *   <li class="swipe-row"><button class="swipe-action">…</button><div class="swipe-fg">…</div></li>
 * Works with touch, pen and mouse drag. Vertical drags are left to the browser (touch-action: pan-y),
 * only one row is open at a time, and the click that ends a drag never reaches links inside the row.
 */
const OPEN_X = -96; // action width (88px) + 8px gap
const START_SLOP = 8;

export function swipeRows(root) {
  let open = null;
  let drag = null;
  let suppressUntil = 0;

  const fgOf = (row) => row.querySelector('.swipe-fg');
  function setX(row, x, animate) {
    const fg = fgOf(row);
    fg.style.transition = animate ? '' : 'none';
    fg.style.transform = x ? `translateX(${x}px)` : '';
  }
  function close(row = open) {
    if (!row) return;
    if (row.isConnected) setX(row, 0, true);
    row.classList.remove('is-open');
    if (row === open) open = null;
  }
  function openRow(row) {
    if (open && open !== row) close(open);
    setX(row, OPEN_X, true);
    row.classList.add('is-open');
    open = row;
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const row = e.target.closest('.swipe-row');
    if (open && (!open.isConnected || row !== open)) close();
    if (!row || e.target.closest('.swipe-action')) return;
    drag = { row, id: e.pointerId, x0: e.clientX, y0: e.clientY, base: row === open ? OPEN_X : 0, x: 0, active: false };
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag = null; // a scroll, not a swipe
        return;
      }
      drag.active = true;
      drag.row.classList.add('is-dragging');
      fgOf(drag.row).setPointerCapture?.(e.pointerId);
    }
    let x = drag.base + dx;
    if (x > 0) x /= 4; // resist dragging right
    if (x < OPEN_X) x = OPEN_X + (x - OPEN_X) / 3; // and past the action
    drag.x = x;
    setX(drag.row, x, false);
  });

  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.row.classList.remove('is-dragging');
    if (!d.active) {
      // Tapping the card of an open row just closes it instead of opening the project.
      if (d.row === open && e.type === 'pointerup') {
        suppressUntil = performance.now() + 400;
        close();
      }
      return;
    }
    suppressUntil = performance.now() + 400;
    if (d.x < OPEN_X / 2) openRow(d.row);
    else close(d.row);
  }
  // A mouse drag on the card's link would otherwise start a native link drag and cancel the swipe.
  root.addEventListener('dragstart', (e) => {
    if (e.target.closest?.('.swipe-fg')) e.preventDefault();
  });
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  root.addEventListener(
    'click',
    (e) => {
      if (performance.now() > suppressUntil || !e.target.closest('.swipe-fg')) return;
      suppressUntil = 0;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  // Keyboard users reach the action with Tab: show it while it has focus.
  root.addEventListener('focusin', (e) => {
    const action = e.target.closest('.swipe-action');
    if (action) openRow(action.closest('.swipe-row'));
    else if (open && !open.contains(e.target)) close();
  });

  return { close: () => close() };
}
