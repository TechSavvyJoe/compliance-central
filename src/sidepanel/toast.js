/**
 * Toast notifications. Styles live in sidepanel.css (.toast-container, .toast, etc).
 */

import { ICONS } from "./icons.js";

const TOAST_VARIANTS = {
  error: { icon: ICONS.x, className: "toast-error" },
  warning: { icon: ICONS.alertTriangle, className: "toast-warning" },
  success: { icon: ICONS.check, className: "toast-success" },
  info: { icon: ICONS.info, className: "toast-info" },
};
const MAX_VISIBLE_TOASTS = 3;

function getContainer() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Notifications");
    document.body.appendChild(container);
  }
  return container;
}

function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;
  if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
  toast.classList.add("toast-leaving");
  setTimeout(() => toast.remove(), 200);
}

function scheduleDismiss(toast, duration) {
  if (duration <= 0) return;
  if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
  toast._dismissTimer = setTimeout(() => dismissToast(toast), duration);
}

export function showToast(message, type = "info", duration = 5000) {
  const variant = TOAST_VARIANTS[type] || TOAST_VARIANTS.info;
  const container = getContainer();

  const toast = document.createElement("div");
  toast.className = `toast ${variant.className}`;
  const urgent = type === "error";
  toast.setAttribute("role", urgent ? "alert" : "status");
  toast.setAttribute("aria-live", urgent ? "assertive" : "polite");
  toast.setAttribute("aria-atomic", "true");

  const iconWrap = document.createElement("span");
  iconWrap.className = "toast-icon";
  iconWrap.setAttribute("aria-hidden", "true");
  iconWrap.innerHTML = variant.icon;

  const messageEl = document.createElement("div");
  messageEl.className = "toast-message";
  messageEl.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.innerHTML = ICONS.x;
  closeBtn.onclick = () => dismissToast(toast);

  toast.appendChild(iconWrap);
  toast.appendChild(messageEl);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  while (container.children.length > MAX_VISIBLE_TOASTS) {
    container.firstElementChild?.remove();
  }

  const accessibleDuration =
    duration <= 0
      ? duration
      : type === "error"
        ? Math.max(duration, 10000)
        : type === "warning"
          ? Math.max(duration, 8000)
          : duration;
  scheduleDismiss(toast, accessibleDuration);

  toast.addEventListener("pointerenter", () => {
    if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
  });
  toast.addEventListener("pointerleave", () =>
    scheduleDismiss(toast, accessibleDuration)
  );
  toast.addEventListener("focusin", () => {
    if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
  });
  toast.addEventListener("focusout", () =>
    scheduleDismiss(toast, accessibleDuration)
  );

  return toast;
}
