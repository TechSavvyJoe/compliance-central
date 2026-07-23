/**
 * Simple, salesperson-focused Settings panel.
 *
 * Backend access is built in. Settings contains only useful preferences,
 * privacy/data controls, support, and version information.
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { showModal, hideModal } from "./modals.js";
import { showToast } from "./toast.js";

export async function getBackendApiKey() {
  return CONFIG.backend.defaultApiKey || "";
}

export async function hasBackendApiKey() {
  return Boolean(await getBackendApiKey());
}

let els = null;
let clearHistory = null;

export async function removeLegacyBackendApiKey() {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.backendApiKey);
    return true;
  } catch {
    // A blocked storage cleanup must not prevent Settings from opening. The API
    // client ignores this retired value even if Chrome cannot remove it.
    return false;
  }
}

export function initSettings(elements, { onClearHistory } = {}) {
  els = elements;
  clearHistory = onClearHistory;

  els.settingsBtn?.addEventListener("click", openSettings);
  els.closeSettingsModal?.addEventListener("click", () =>
    hideModal(els.settingsModal)
  );
  els.settingsClearHistoryBtn?.addEventListener("click", handleClearHistory);

  if (els.supportEmailLink) {
    els.supportEmailLink.href = `mailto:${CONFIG.support.email}`;
    els.supportEmailLink.textContent = CONFIG.support.email;
  }
  if (els.settingsPrivacyLink) {
    els.settingsPrivacyLink.href =
      "https://techsavvyjoe.github.io/compliance-central/#privacy-policy";
  }
  if (els.settingsVersion) {
    try {
      els.settingsVersion.textContent = `Version ${chrome.runtime.getManifest().version}`;
    } catch {
      els.settingsVersion.textContent = "";
    }
  }

  // Remove the retired custom-key override from upgraded installations. The
  // public extension uses its built-in service access and stores no reusable
  // user-entered secret.
  void removeLegacyBackendApiKey();
}

export async function openSettings() {
  if (!els?.settingsModal) return;
  const ready = await hasBackendApiKey();
  if (els.serviceStatus) {
    els.serviceStatus.textContent = ready
      ? "All checks are ready — no setup needed."
      : "Service setup is unavailable. Contact support.";
    els.serviceStatus.className = ready
      ? "settings-status connected"
      : "settings-status disconnected";
  }
  showModal(els.settingsModal, { focusEl: els.closeSettingsModal });
}

async function handleClearHistory() {
  if (typeof clearHistory !== "function") return;
  const button = els.settingsClearHistoryBtn;
  if (button) button.disabled = true;
  try {
    const cleared = await clearHistory();
    if (cleared) showToast("Audit history cleared.", "success");
  } catch {
    showToast("Could not clear audit history. Please try again.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}
