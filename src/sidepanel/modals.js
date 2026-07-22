/**
 * Generic modal show/hide with focus management, Escape, and backdrop click.
 */

let lastFocusedElement = null;
let activeModal = null;
let activeOnClose = null;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(modalEl) {
  return Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

function handleKeydown(e) {
  if (!activeModal) return;
  if (e.key === "Escape") {
    e.preventDefault();
    hideModal(activeModal);
    return;
  }
  // Trap Tab/Shift+Tab inside the modal so keyboard focus can't escape to the
  // page behind it (accessibility: WAI-ARIA dialog pattern).
  if (e.key === "Tab") {
    const focusable = getFocusable(activeModal);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !activeModal.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !activeModal.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
}

function handleBackdropClick(e) {
  // Close when click target is the modal root itself (the dark backdrop),
  // not a descendant inside .modal-content.
  if (activeModal && e.target === activeModal) {
    hideModal(activeModal);
  }
}

/**
 * Open a modal with focus management, Escape, backdrop-click, and Tab-trapping.
 * @param {HTMLElement} modalEl
 * @param {{ onClose?: () => void, focusEl?: HTMLElement }} [opts]
 *   onClose runs on every close path (Escape, backdrop, or hideModal) so
 *   callers can release resources (e.g. cancel an in-flight pairing).
 */
export function showModal(modalEl, opts = {}) {
  if (!modalEl) return;
  lastFocusedElement = document.activeElement;
  activeModal = modalEl;
  activeOnClose = typeof opts.onClose === "function" ? opts.onClose : null;
  modalEl.classList.remove("hidden");
  modalEl.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  const focusEl = opts.focusEl || modalEl.querySelector(".modal-close");
  if (focusEl) requestAnimationFrame(() => focusEl.focus());

  document.addEventListener("keydown", handleKeydown);
  modalEl.addEventListener("click", handleBackdropClick);
}

export function hideModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  modalEl.setAttribute("aria-hidden", "true");
  modalEl.removeEventListener("click", handleBackdropClick);

  // A late async callback can try to close a pairing modal after another
  // dialog has opened. Do not tear down that newer dialog's focus trap or
  // restore its opener in that case.
  if (activeModal !== modalEl) return;

  document.removeEventListener("keydown", handleKeydown);

  // Run and clear the close hook before restoring focus, guarding against
  // re-entrancy if the hook itself triggers another hide.
  const onClose = activeOnClose;
  activeModal = null;
  activeOnClose = null;
  document.body.classList.remove("modal-open");
  if (onClose) onClose();

  const focusTarget = lastFocusedElement;
  lastFocusedElement = null;
  if (focusTarget?.isConnected && focusTarget?.focus) focusTarget.focus();
}
