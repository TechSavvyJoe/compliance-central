/**
 * Generic modal show/hide with focus management, Escape, and backdrop click.
 */

let lastFocusedElement = null;
let activeModal = null;

function handleKeydown(e) {
  if (e.key === "Escape" && activeModal) {
    hideModal(activeModal);
  }
}

function handleBackdropClick(e) {
  // Close when click target is the modal root itself (the dark backdrop),
  // not a descendant inside .modal-content.
  if (activeModal && e.target === activeModal) {
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
  modalEl.addEventListener("click", handleBackdropClick);
}

export function hideModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  modalEl.removeEventListener("click", handleBackdropClick);
  if (activeModal === modalEl) activeModal = null;
  document.removeEventListener("keydown", handleKeydown);

  if (lastFocusedElement?.focus) {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
}
