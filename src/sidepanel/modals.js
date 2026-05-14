/**
 * Generic modal show/hide with focus management and Escape handling.
 */

let lastFocusedElement = null;
let activeModal = null;

function handleKeydown(e) {
  if (e.key === "Escape" && activeModal) {
    hideModal(activeModal);
  }
}

export function showModal(modalEl) {
  if (!modalEl) return;
  lastFocusedElement = document.activeElement;
  activeModal = modalEl;
  modalEl.classList.remove("hidden");

  const closeBtn = modalEl.querySelector(".modal-close");
  if (closeBtn) setTimeout(() => closeBtn.focus(), 80);

  document.addEventListener("keydown", handleKeydown);
}

export function hideModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  if (activeModal === modalEl) activeModal = null;
  document.removeEventListener("keydown", handleKeydown);

  if (lastFocusedElement?.focus) {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
}
