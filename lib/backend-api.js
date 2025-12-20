/**
 * Backend API Client
 *
 * Utility for calling the Fly.io headless browser backend
 * instead of using local tab automation.
 *
 * Toggle USE_BACKEND in config to switch between:
 * - true: Use Fly.io API (no visible tabs, serverless)
 * - false: Use local tab automation (current behavior)
 *
 * Security:
 * - API key is required for all requests
 * - Store your API key in chrome.storage.local under 'apiKey'
 * - Or set it directly in config for development
 */

import { CONFIG } from "./config.js";

// ============================================================================
// CONFIGURATION (from centralized config)
// ============================================================================

export const BACKEND_CONFIG = {
  // Set to true to use Fly.io backend instead of local tabs
  USE_BACKEND: CONFIG.backend.useBackend,

  // Fly.io API URL
  API_BASE_URL: CONFIG.backend.apiBaseUrl,

  // Request timeout in milliseconds (90 seconds for Puppeteer checks)
  TIMEOUT: CONFIG.backend.requestTimeout,

  // API Key for authentication (should match CC_API_KEY on Fly.io)
  // For production, store in chrome.storage.local and retrieve dynamically
  API_KEY: CONFIG.backend.defaultApiKey,
};

/**
 * Get API key from storage or config
 * @returns {Promise<string>} API key
 */
async function getApiKey() {
  try {
    // Try to get from chrome.storage.local first (production)
    const result = await chrome.storage.local.get("backendApiKey");
    if (result.backendApiKey) {
      return result.backendApiKey;
    }
  } catch (e) {
    // Storage not available, use config
  }
  // Fall back to config (development)
  return BACKEND_CONFIG.API_KEY;
}

// ============================================================================
// API CLIENT
// ============================================================================

/**
 * Keep service worker alive during long operations
 * Chrome MV3 terminates service workers after ~30 seconds of inactivity
 */
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  console.log("[Backend API] Starting keep-alive...");
  keepAliveInterval = setInterval(() => {
    // Access chrome.runtime to keep service worker alive
    chrome.runtime.getPlatformInfo(() => {});
  }, CONFIG.timeouts.keepAliveInterval);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    console.log("[Backend API] Stopping keep-alive");
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

/**
 * Call the backend API
 * @param {string} endpoint - API endpoint (e.g., '/api/repeat-offender')
 * @param {Object} data - Request body
 * @returns {Promise<Object>} - API response
 */
export async function callBackendAPI(endpoint, data) {
  console.log(`[Backend API] Calling ${endpoint}...`);

  // Start keep-alive to prevent service worker termination
  startKeepAlive();

  // Get API key for authentication
  const apiKey = await getApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    BACKEND_CONFIG.TIMEOUT
  );

  try {
    const response = await fetch(`${BACKEND_CONFIG.API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    console.log(`[Backend API] Response status: ${response.status}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      stopKeepAlive();
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const jsonResponse = await response.json();
    console.log(
      `[Backend API] Response received:`,
      jsonResponse.success ? "SUCCESS" : "FAILED"
    );
    stopKeepAlive();
    return jsonResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    stopKeepAlive();
    console.error(`[Backend API] Error:`, error.message);

    if (error.name === "AbortError") {
      throw new Error("Backend request timed out. Please try again.");
    }

    throw error;
  }
}

/**
 * Run Repeat Offender check via backend API
 * @param {Object} searchData - { firstName, lastName, dob, dln }
 * @returns {Promise<Object>} - Check result
 */
export async function backendRepeatOffenderCheck(searchData) {
  console.log("[Backend API] Starting Repeat Offender check...");

  const response = await callBackendAPI("/api/repeat-offender", {
    firstName: searchData.firstName,
    lastName: searchData.lastName,
    dob: searchData.dob || "",
    dln: searchData.dlnPid || searchData.dln || "",
  });

  console.log(
    "[Backend API] Repeat Offender response success:",
    response.success
  );

  if (!response.success) {
    return { success: false, error: response.error };
  }

  // Transform response to match extension's expected format
  // Use status from backend if available, otherwise derive from passed
  const result = {
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

  console.log(
    "[Backend API] Transformed result - status:",
    result.result.status
  );
  return result;
}

/**
 * Run Title/Lien check via backend API
 * @param {Object} data - { vin }
 * @returns {Promise<Object>} - Check result
 */
export async function backendTitleCheck(data) {
  const response = await callBackendAPI("/api/title-check", {
    vin: data.vin,
  });

  if (!response.success) {
    return { success: false, error: response.error };
  }

  // Transform response to match extension's expected format
  // If no brands found, titleBrand should be "CLEAN"
  const titleStatus = response.details?.titleStatus || "Unknown";
  let titleBrand = "CLEAN"; // Default to clean

  // Check if there's a problematic title status that indicates branding
  if (titleStatus === "Salvage") {
    titleBrand = "SALVAGE";
  } else if (titleStatus === "Rebuilt") {
    titleBrand = "REBUILT";
  } else if (titleStatus === "No Record Found") {
    titleBrand = "UNKNOWN";
  }

  // Extract vehicle details from response
  const details = response.details || {};

  return {
    success: true,
    result: {
      passed: response.passed,
      message: response.message,
      // Vehicle info
      year: details.year,
      make: details.make,
      model: details.model,
      unladenWeight: details.unladenWeight,
      // Title info
      titleStatus: titleStatus,
      titleBrand: titleBrand,
      titleType: details.titleType,
      titleIssued: details.titleIssued,
      // Lien info
      hasLien: details.hasLien || false,
      lienStatus:
        details.lienStatusText ||
        (details.hasLien ? "Active Lien" : "No Active Liens"),
      // Brands
      vehicleBrands: details.vehicleBrands || [],
      // Screenshot & metadata
      screenshotData: response.screenshot,
      timestamp: response.timestamp,
    },
  };
}

/**
 * Run all MDOS checks via backend API (combined endpoint)
 * @param {Object} data - { firstName, lastName, dob, dln, vin }
 * @returns {Promise<Object>} - Combined results
 */
export async function backendRunAllMDOSChecks(data) {
  const response = await callBackendAPI("/api/run-all", data);

  if (!response.success) {
    return { success: false, error: response.error };
  }

  return {
    success: true,
    results: response.results,
    duration: response.duration,
  };
}

/**
 * Check if backend is available
 * @returns {Promise<boolean>}
 */
export async function isBackendAvailable() {
  try {
    const response = await fetch(`${BACKEND_CONFIG.API_BASE_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
