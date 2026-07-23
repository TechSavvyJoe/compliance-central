/**
 * Backend API Client (Fly.io)
 *
 * Calls the Puppeteer-driven backend that screens against the MDOS portal.
 */

import { CONFIG } from "./config.js";
import { MISSING_API_KEY } from "./errors.js";

const API_BASE_URL = CONFIG.backend.apiBaseUrl;
const TIMEOUT_MS = CONFIG.backend.requestTimeout;

// The backend serializes MDOS checks per machine and returns 503/429 when its
// short queue is full (a transient "busy" under concurrent load). Retry those
// automatically a couple of times — honoring Retry-After — so brief contention
// is invisible to the user instead of surfacing as an error.
const BUSY_MAX_RETRIES = CONFIG.backend.busyMaxRetries;
const BUSY_MAX_WAIT_MS = CONFIG.backend.busyMaxWaitMs;

function getApiKey() {
  // Service access is part of the extension. Do not accept a value from local
  // storage: older releases exposed a custom-key setting, and a stale or
  // injected override must not silently redirect authentication behavior.
  return CONFIG.backend.defaultApiKey || null;
}

export { getApiKey };

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

function cancelledError() {
  const error = new Error("Request cancelled.");
  error.name = "AbortError";
  return error;
}

function waitForRetry(ms, signal) {
  if (signal?.aborted) return Promise.reject(cancelledError());
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = () => {
      clearTimeout(timeoutId);
      reject(cancelledError());
    };
    const timeoutId = setTimeout(finish, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

// Re-exported from lib/errors.js so existing importers keep working.
export { MISSING_API_KEY };

async function callBackend(endpoint, data, { signal } = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    const err = new Error(MISSING_API_KEY);
    err.code = MISSING_API_KEY;
    throw err;
  }

  startKeepAlive();

  try {
    if (signal?.aborted) throw cancelledError();

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, TIMEOUT_MS);
      const cancelRequest = () => controller.abort();
      signal?.addEventListener("abort", cancelRequest, { once: true });

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
        if (error.name === "AbortError") {
          if (signal?.aborted) throw cancelledError();
          if (!timedOut) throw error;
          throw new Error("Backend request timed out. Please try again.");
        }
        if (error instanceof TypeError) {
          throw new Error(
            "Could not reach the compliance service. Check your internet connection and try again."
          );
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", cancelRequest);
      }

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
        try {
          await response.body?.cancel?.();
        } catch {
          // Body cleanup is best-effort; the retry itself can still proceed.
        }
        await waitForRetry(waitMs, signal);
        continue;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Backend error: HTTP ${response.status}`);
      }

      try {
        return await response.json();
      } catch {
        throw new Error(
          "The compliance service returned an invalid response. Please try again."
        );
      }
    }
  } finally {
    stopKeepAlive();
  }
}

export async function backendRepeatOffenderCheck(searchData, options) {
  const response = await callBackend(
    "/api/repeat-offender",
    {
      firstName: searchData.firstName,
      middleName: searchData.middleName || "",
      lastName: searchData.lastName,
      suffix: searchData.suffix || "",
      dob: searchData.dob || "",
      dln: searchData.dlnPid || searchData.dln || "",
    },
    options
  );

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

export async function backendTitleCheck(data, options) {
  const response = await callBackend(
    "/api/title-check",
    { vin: data.vin },
    options
  );

  if (!response.success) {
    return { success: false, error: response.error };
  }

  const details = response.details;
  if (
    !details ||
    typeof details !== "object" ||
    Array.isArray(details) ||
    typeof response.passed !== "boolean" ||
    typeof details.titleStatus !== "string" ||
    details.titleStatus.trim().length === 0 ||
    typeof details.hasLien !== "boolean"
  ) {
    return {
      success: false,
      error:
        "The compliance service returned an incomplete title result. Please try again.",
    };
  }

  const titleStatus = details.titleStatus.trim();
  const brandByStatus = {
    clear: "CLEAN",
    salvage: "SALVAGE",
    rebuilt: "REBUILT",
    scrap: "SCRAP",
    flood: "FLOOD",
    "no record found": "UNKNOWN",
    unknown: "UNKNOWN",
  };
  const reportedBrand =
    typeof details.titleBrand === "string"
      ? details.titleBrand.trim().toUpperCase()
      : "";
  const statusBrand = brandByStatus[titleStatus.toLowerCase()] || "UNKNOWN";
  // A contradictory backend brand/status pair is not trustworthy. In
  // particular, historical servers labelled "No Record Found" as CLEAN.
  const titleBrand =
    reportedBrand && reportedBrand !== statusBrand ? "UNKNOWN" : statusBrand;
  const passed = response.passed === true && titleBrand !== "UNKNOWN";

  return {
    success: true,
    result: {
      passed,
      message: response.message,
      year: details.year,
      make: details.make,
      model: details.model,
      unladenWeight: details.unladenWeight,
      titleStatus,
      titleBrand,
      titleType: details.titleType,
      titleIssued: details.titleIssued,
      hasLien: details.hasLien,
      lienStatus:
        details.lienStatusText ||
        (details.hasLien ? "Active Lien" : "No Active Liens"),
      lienHolder: details.lienHolder || null,
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
