/**
 * Backend API Client
 *
 * Utility for calling the Fly.io headless browser backend
 * instead of using local tab automation.
 *
 * Toggle USE_BACKEND in config to switch between:
 * - true: Use Fly.io API (no visible tabs, serverless)
 * - false: Use local tab automation (current behavior)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

export const BACKEND_CONFIG = {
  // Set to true to use Fly.io backend instead of local tabs
  USE_BACKEND: true,

  // Fly.io API URL
  API_BASE_URL: "https://compliance-central-api.fly.dev",

  // Request timeout in milliseconds
  TIMEOUT: 60000,
};

// ============================================================================
// API CLIENT
// ============================================================================

/**
 * Call the backend API
 * @param {string} endpoint - API endpoint (e.g., '/api/repeat-offender')
 * @param {Object} data - Request body
 * @returns {Promise<Object>} - API response
 */
export async function callBackendAPI(endpoint, data) {
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
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

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
  const response = await callBackendAPI("/api/repeat-offender", {
    firstName: searchData.firstName,
    lastName: searchData.lastName,
    dob: searchData.dob || "",
    dln: searchData.dlnPid || searchData.dln || "",
  });

  if (!response.success) {
    return { success: false, error: response.error };
  }

  // Transform response to match extension's expected format
  return {
    success: true,
    result: {
      status: response.passed ? "eligible" : "ineligible",
      passed: response.passed,
      message: response.message,
      details: response.details,
      screenshotData: response.screenshot,
      timestamp: response.timestamp,
      rawText: response.message,
    },
  };
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
  return {
    success: true,
    result: {
      passed: response.passed,
      message: response.message,
      hasLien: response.details?.hasLien || false,
      titleStatus: response.details?.titleStatus || "Unknown",
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
