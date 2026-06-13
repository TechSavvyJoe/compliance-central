/**
 * Compliance Central Configuration
 *
 * Centralised timeouts, URLs, and constants.
 */

export const CONFIG = {
  backend: {
    apiBaseUrl: "https://compliance-central-api.fly.dev",
    requestTimeout: 90000,
    healthCheckTimeout: 5000,
    // Built-in access key shipped with the extension so all checks work for
    // everyone with no setup (the tool surfaces public MDOS info for free).
    // A user CAN override this with their own key via Settings (stored in
    // chrome.storage.local.backendApiKey). The backend still requires this key,
    // which (with its rate limiter) blocks anonymous/non-extension traffic.
    // To cut off abuse: rotate CC_API_KEY on the backend and ship a new value here.
    defaultApiKey: "cc_live_bbafa0f7e9b3ca22a9d4c2177047800f9480b3c78b0a4d09",
  },

  // Public support contact (shown in Settings and on the store listing).
  support: {
    email: "joejgallant@gmail.com",
  },

  mdos: {
    baseUrl: "https://dsvsesvc.sos.state.mi.us/TAP/_/",
    urlPattern: "https://dsvsesvc.sos.state.mi.us/*",
  },

  ofac: {
    sdnDataUrl:
      "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv",
    allowedDomains: ["data.opensanctions.org", "opensanctions.org"],
    maxRedirects: 3,
    defaultThreshold: 85,
    updateInterval: 24 * 60 * 60 * 1000,
  },

  timeouts: {
    tabReadyTimeout: 30000,
    stuckSearchTimeout: 5 * 60 * 1000,
    formCacheExpiry: 10 * 60 * 1000,
    printWindowTimeout: 5 * 60 * 1000,
    keepAliveInterval: 20000,
  },

  limits: {
    maxHistoryEntries: 50,
    dataRetentionDays: 30,
    maxOfacMatches: 5,
    rateLimitRequests: 10,
    rateLimitWindow: 60000,
  },

  validation: {
    vinLength: 17,
    vinInvalidChars: /[IOQ]/i,
    vinPattern: /^[A-HJ-NPR-Z0-9]{17}$/,
    dobPattern: /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/,
    minAge: 16,
    maxAge: 120,
    dlnPattern: /^[A-Za-z]\d{12}$|^\d{9,12}$/,
    nameMaxLength: 100,
  },

  ui: {
    progressSteps: {
      ofac: 25,
      repeatOffender: 50,
      coBuyerOfac: 62,
      coBuyerRepeatOffender: 75,
      title: 90,
      complete: 100,
    },
    fadeDelay: 300,
    sleepBetweenSteps: 200,
  },
};

export function getConfig(path, defaultValue = undefined) {
  const parts = path.split(".");
  let current = CONFIG;
  for (const part of parts) {
    if (current === undefined || current === null) return defaultValue;
    current = current[part];
  }
  return current !== undefined ? current : defaultValue;
}
