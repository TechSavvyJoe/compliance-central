/**
 * Settings panel — optional backend key override.
 *
 * All checks work out of the box: OFAC runs locally, and Repeat Offender /
 * Title-Lien use a built-in backend key shipped with the extension (CONFIG.
 * backend.defaultApiKey). This panel lets advanced users override that with
 * their own key, stored only on this device.
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { showModal, hideModal } from "./modals.js";
import { showToast } from "./toast.js";

// The effective key: a user's saved override if present, otherwise the
// built-in key shipped with the extension (so everything works with no setup).
export async function getBackendApiKey() {
  const override = await getStoredOverride();
  if (override) return override;
  return CONFIG.backend.defaultApiKey || "";
}

export async function hasBackendApiKey() {
  return !!(await getBackendApiKey());
}

// Only the user-saved override (ignores the built-in default).
async function getStoredOverride() {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEYS.backendApiKey);
    return r[STORAGE_KEYS.backendApiKey] || "";
  } catch {
    return "";
  }
}

let els = null;

export function initSettings(elements) {
  els = elements;

  els.settingsBtn?.addEventListener("click", openSettings);
  els.closeSettingsModal?.addEventListener("click", () =>
    hideModal(els.settingsModal)
  );
  els.saveApiKeyBtn?.addEventListener("click", saveKey);
  els.clearApiKeyBtn?.addEventListener("click", clearKey);
  els.toggleApiKeyVisibility?.addEventListener("click", toggleVisibility);

  if (els.supportEmailLink) {
    els.supportEmailLink.href = `mailto:${CONFIG.support.email}`;
    els.supportEmailLink.textContent = CONFIG.support.email;
  }
}

export async function openSettings() {
  if (!els?.settingsModal) return;
  await refreshKeyStatus();
  showModal(els.settingsModal);
  setTimeout(() => els.apiKeyInput?.focus(), 120);
}

async function refreshKeyStatus() {
  const override = await getStoredOverride();
  if (els.apiKeyInput) {
    els.apiKeyInput.value = override;
    els.apiKeyInput.type = "password";
  }
  setStatus(!!(await getBackendApiKey()));
}

function setStatus(active) {
  if (!els.apiKeyStatus) return;
  if (active) {
    els.apiKeyStatus.textContent = "All checks active — no setup needed.";
    els.apiKeyStatus.className = "settings-status connected";
  } else {
    els.apiKeyStatus.textContent = "Not connected.";
    els.apiKeyStatus.className = "settings-status disconnected";
  }
}

async function saveKey() {
  const key = (els.apiKeyInput?.value || "").trim();
  if (!key) {
    showToast("Enter a key to override the built-in access.", "warning");
    return;
  }
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.backendApiKey]: key });
    setStatus(true);
    showToast("Custom backend key saved.", "success");
  } catch {
    showToast("Could not save the key. Please try again.", "error");
  }
}

async function clearKey() {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.backendApiKey);
  } catch {
    // ignore
  }
  if (els.apiKeyInput) els.apiKeyInput.value = "";
  setStatus(!!(await getBackendApiKey()));
  showToast("Reverted to built-in access.", "info");
}

function toggleVisibility() {
  if (!els.apiKeyInput) return;
  els.apiKeyInput.type =
    els.apiKeyInput.type === "password" ? "text" : "password";
}
