/**
 * Compliance Central Configuration
 *
 * Centralized configuration for all timeouts, URLs, and constants.
 * This makes it easy to adjust settings without hunting through code.
 */

export const CONFIG = {
  // ============================================================================
  // BACKEND API
  // ============================================================================
  backend: {
    // Set to true to use Fly.io backend, false for local tab automation
    useBackend: true,

    // Fly.io API URL
    apiBaseUrl: "https://compliance-central-api.fly.dev",

    // Request timeout in milliseconds (Puppeteer checks can be slow)
    requestTimeout: 90000, // 90 seconds

    // Health check timeout
    healthCheckTimeout: 5000, // 5 seconds

    // Default API key (production should use chrome.storage)
    defaultApiKey: "development-key-change-me",
  },

  // ============================================================================
  // MDOS (Michigan Department of State) URLs
  // ============================================================================
  mdos: {
    // Base URL for MDOS online services
    baseUrl: "https://dsvsesvc.sos.state.mi.us/TAP/_/",

    // URL pattern for tab queries
    urlPattern: "https://dsvsesvc.sos.state.mi.us/*",

    // Repeat Offender specific URL
    repeatOffenderUrl: "https://dsvsesvc.sos.state.mi.us/TAP/_/",
  },

  // ============================================================================
  // OFAC (Office of Foreign Assets Control)
  // ============================================================================
  ofac: {
    // OpenSanctions CSV data URL
    sdnDataUrl:
      "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv",

    // Allowed domains for SDN data downloads (security)
    allowedDomains: ["data.opensanctions.org", "opensanctions.org"],

    // Maximum redirect hops (security)
    maxRedirects: 3,

    // Default match threshold (0-100)
    defaultThreshold: 85,

    // Update interval in milliseconds (24 hours)
    updateInterval: 24 * 60 * 60 * 1000,
  },

  // ============================================================================
  // TIMEOUTS & DELAYS
  // ============================================================================
  timeouts: {
    // Maximum time to wait for tab to be ready
    tabReadyTimeout: 30000, // 30 seconds

    // How long before considering a search "stuck"
    stuckSearchTimeout: 2 * 60 * 1000, // 2 minutes

    // Form data cache expiry
    formCacheExpiry: 10 * 60 * 1000, // 10 minutes

    // Print window cleanup timeout
    printWindowTimeout: 5 * 60 * 1000, // 5 minutes

    // Keep-alive interval for service worker
    keepAliveInterval: 20000, // 20 seconds
  },

  // ============================================================================
  // LIMITS
  // ============================================================================
  limits: {
    // Maximum history entries to keep
    maxHistoryEntries: 50,

    // Data retention in days (entries older than this are purged)
    dataRetentionDays: 30,

    // Maximum OFAC matches to return
    maxOfacMatches: 5,

    // Rate limit: requests per minute
    rateLimitRequests: 10,
    rateLimitWindow: 60000, // 1 minute
  },

  // ============================================================================
  // INPUT VALIDATION
  // ============================================================================
  validation: {
    // VIN: 17 alphanumeric characters, no I, O, Q
    vinLength: 17,
    vinInvalidChars: /[IOQ]/i,
    vinPattern: /^[A-HJ-NPR-Z0-9]{17}$/,

    // DOB: MM/DD/YYYY format
    dobPattern: /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/,
    minAge: 16,
    maxAge: 120,

    // DLN: Michigan format (1 letter + 12 digits) or numeric PID
    dlnPattern: /^[A-Za-z]\d{12}$|^\d{9,12}$/,

    // Name: max length to prevent injection
    nameMaxLength: 100,
  },

  // ============================================================================
  // UI SETTINGS
  // ============================================================================
  ui: {
    // Progress bar update steps
    progressSteps: {
      ofac: 25,
      repeatOffender: 50,
      coBuyerOfac: 62,
      coBuyerRepeatOffender: 75,
      title: 90,
      complete: 100,
    },

    // Animation delays
    fadeDelay: 300,
    sleepBetweenSteps: 200,
  },
};

/**
 * Get a nested config value safely
 * @param {string} path - Dot-separated path (e.g., "backend.apiBaseUrl")
 * @param {*} defaultValue - Default if not found
 * @returns {*} - The config value or default
 */
export function getConfig(path, defaultValue = undefined) {
  const parts = path.split(".");
  let current = CONFIG;

  for (const part of parts) {
    if (current === undefined || current === null) {
      return defaultValue;
    }
    current = current[part];
  }

  return current !== undefined ? current : defaultValue;
}
