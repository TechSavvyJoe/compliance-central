/**
 * Backend API Client (Fly.io)
 *
 * Calls the Puppeteer-driven backend that screens against the MDOS portal.
 */

import { CONFIG } from "./config.js";
import { STORAGE_KEYS } from "./storage-keys.js";

const API_BASE_URL = CONFIG.backend.apiBaseUrl;
const TIMEOUT_MS = CONFIG.backend.requestTimeout;

// The backend serializes MDOS checks per machine and returns 503/429 when its
// short queue is full (a transient "busy" under concurrent load). Retry those
// automatically a couple of times — honoring Retry-After — so brief contention
// is invisible to the user instead of surfacing as an error.
const BUSY_MAX_RETRIES = 2;
const BUSY_MAX_WAIT_MS = 12000;

async function getApiKey() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.backendApiKey);
    const key = result[STORAGE_KEYS.backendApiKey];
    if (key) return key;
  } catch {
    // Storage unavailable; fall through.
  }
  return CONFIG.backend.defaultApiKey || null;
}

let keepAliveInterval = null;
let keepAliveRefs = 0;
function startKeepAlive() {
  keepAliveRefs++;
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, CONFIG.timeouts.keepAliveInterval);
}
function stopKeepAlive() {
  keepAliveRefs = Math.max(0, keepAliveRefs - 1);
  if (keepAliveRefs === 0 && keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

export const MISSING_API_KEY = "MISSING_API_KEY";

async function callBackend(endpoint, data) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    const err = new Error(MISSING_API_KEY);
    err.code = MISSING_API_KEY;
    throw err;
  }

  startKeepAlive();

  try {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let response;
      try {
        response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(data),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === "AbortError") {
          throw new Error("Backend request timed out. Please try again.");
        }
        throw error;
      }
      clearTimeout(timeoutId);

      // Transient "busy" (server queue full) — wait and retry automatically.
      if (
        (response.status === 503 || response.status === 429) &&
        attempt < BUSY_MAX_RETRIES
      ) {
        const retryAfterHeader =
          response.headers && typeof response.headers.get === "function"
            ? response.headers.get("Retry-After")
            : null;
        const retryAfter = parseInt(retryAfterHeader || "", 10);
        const waitMs = Math.min(
          Number.isFinite(retryAfter) ? retryAfter * 1000 : 5000,
          BUSY_MAX_WAIT_MS
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Backend error: HTTP ${response.status}`);
      }

      return await response.json();
    }
  } finally {
    stopKeepAlive();
  }
}

export async function backendRepeatOffenderCheck(searchData) {
  const response = await callBackend("/api/repeat-offender", {
    firstName: searchData.firstName,
    middleName: searchData.middleName || "",
    lastName: searchData.lastName,
    suffix: searchData.suffix || "",
    dob: searchData.dob || "",
    dln: searchData.dlnPid || searchData.dln || "",
  });

  if (!response.success) {
    return { success: false, error: response.error };
  }

  return {
    success: true,
    result: {
      status: response.status || (response.passed ? "eligible" : "ineligible"),
      passed: response.passed,
      message: response.message,
      details: response.details || {},
      screenshotData: response.screenshot,
      timestamp: response.timestamp,
      rawText: response.message,
    },
  };
}

export async function backendTitleCheck(data) {
  const response = await callBackend("/api/title-check", { vin: data.vin });

  if (!response.success) {
    return { success: false, error: response.error };
  }

  const titleStatus = response.details?.titleStatus || "Unknown";
  let titleBrand = "CLEAN";
  if (titleStatus === "Salvage") titleBrand = "SALVAGE";
  else if (titleStatus === "Rebuilt") titleBrand = "REBUILT";
  else if (titleStatus === "No Record Found") titleBrand = "UNKNOWN";

  const details = response.details || {};

  return {
    success: true,
    result: {
      passed: response.passed,
      message: response.message,
      year: details.year,
      make: details.make,
      model: details.model,
      unladenWeight: details.unladenWeight,
      titleStatus,
      titleBrand,
      titleType: details.titleType,
      titleIssued: details.titleIssued,
      hasLien: details.hasLien || false,
      lienStatus:
        details.lienStatusText ||
        (details.hasLien ? "Active Lien" : "No Active Liens"),
      vehicleBrands: details.vehicleBrands || [],
      screenshotData: response.screenshot,
      timestamp: response.timestamp,
    },
  };
}

export async function isBackendAvailable() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(CONFIG.backend.healthCheckTimeout),
    });
    return response.ok;
  } catch {
    return false;
  }
}
