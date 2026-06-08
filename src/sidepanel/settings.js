/**
 * Settings panel — manage the per-install backend API key.
 *
 * OFAC screening runs locally and needs no key. The Repeat Offender and
 * Title/Lien checks call the secure backend, which requires an API key the
 * dealer obtains separately. This panel lets the user paste/save/clear that
 * key without touching DevTools, and points them at how to get one.
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { showModal, hideModal } from "./modals.js";
import { showToast } from "./toast.js";

export async function getBackendApiKey() {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEYS.backendApiKey);
    return r[STORAGE_KEYS.backendApiKey] || "";
  } catch {
    return "";
  }
}

export async function hasBackendApiKey() {
  return !!(await getBackendApiKey());
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

  if (els.getAccessLink) els.getAccessLink.href = CONFIG.support.getAccessUrl;
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
  const key = await getBackendApiKey();
  if (els.apiKeyInput) {
    els.apiKeyInput.value = key;
    els.apiKeyInput.type = "password";
  }
  setStatus(key);
}

function setStatus(key) {
  if (!els.apiKeyStatus) return;
  if (key) {
    els.apiKeyStatus.textContent = "Connected — MDOS checks enabled.";
    els.apiKeyStatus.className = "settings-status connected";
  } else {
    els.apiKeyStatus.textContent =
      "Not connected — OFAC works now; MDOS checks need a key.";
    els.apiKeyStatus.className = "settings-status disconnected";
  }
}

async function saveKey() {
  const key = (els.apiKeyInput?.value || "").trim();
  if (!key) {
    showToast("Enter an API key first.", "warning");
    return;
  }
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.backendApiKey]: key });
    setStatus(key);
    showToast("API key saved. MDOS checks are now enabled.", "success");
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
  setStatus("");
  showToast("API key cleared.", "info");
}

function toggleVisibility() {
  if (!els.apiKeyInput) return;
  els.apiKeyInput.type =
    els.apiKeyInput.type === "password" ? "text" : "password";
}
