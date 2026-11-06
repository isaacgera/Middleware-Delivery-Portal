/**
 * Shared modal accessibility helper (used by the Requests dialogs and the Menu Card create modal).
 *
 * trapFocus(host, dialog, remove): traps keyboard focus inside an open modal — Tab / Shift+Tab
 * cycle within `dialog`, Escape closes, focus moves in on open and is RESTORED to the element that
 * was focused before (usually the trigger) on close. Returns a wrapped `close()` that tears the
 * trap down + restores focus; call that instead of the raw remover.
 *
 * @param {HTMLElement} host    the backdrop element appended to the DOM
 * @param {HTMLElement} dialog  the role="dialog" element inside it
 * @param {Function}    remove  the raw close (e.g. () => host.remove())
 * @returns {Function}  close()
 */
export function trapFocus(host, dialog, remove) {
  const previouslyFocused = document.activeElement;
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const focusable = () => Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);

  function onKeydown(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) { ev.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (ev.shiftKey) {
      if (active === first || !dialog.contains(active)) { ev.preventDefault(); last.focus(); }
    } else {
      if (active === last || !dialog.contains(active)) { ev.preventDefault(); first.focus(); }
    }
  }

  function close() {
    host.removeEventListener('keydown', onKeydown, true);
    remove();
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try { previouslyFocused.focus(); } catch { /* element may be gone */ }
    }
  }

  host.addEventListener('keydown', onKeydown, true);
  const items = focusable();
  if (items.length) items[0].focus();
  else { dialog.setAttribute('tabindex', '-1'); dialog.focus(); }

  return close;
}
