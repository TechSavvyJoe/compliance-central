/**
 * Centralised storage keys and status enums shared by worker and sidepanel.
 *
 * Any change here must be coordinated across the consumers — keep this file
 * the single source of truth.
 */

export const STORAGE_KEYS = Object.freeze({
  // Per-run state
  currentResults: "currentResults",
  searchStatus: "searchStatus",
  searchProgress: "searchProgress",
  inFlightCheck: "inFlightCheck", // which MDOS check is currently running
  lastError: "lastError",

  // Screenshots (transient between worker write and sidepanel read)
  repeatOffenderScreenshot: "repeatOffenderScreenshot",
  coBuyerRepeatOffenderScreenshot: "coBuyerRepeatOffenderScreenshot",
  titleScreenshot: "titleScreenshot",

  // Persistent
  complianceHistory: "complianceHistory",
  searchHistory: "searchHistory", // legacy per-check feed
  backendApiKey: "backendApiKey",
  lastResult: "lastResult",

  // Session-only
  cachedFormData: "cachedFormData",
  cachedAt: "cachedAt",
});

export const SEARCH_STATUS = Object.freeze({
  idle: "idle",
  running: "running",
  complete: "complete",
  error: "error",
});

// Keys used for `inFlightCheck` so sidepanel knows which row to mark "Running".
export const IN_FLIGHT = Object.freeze({
  ofac: "ofac",
  coBuyerOfac: "coBuyerOfac",
  repeatOffender: "repeatOffender",
  coBuyerRepeatOffender: "coBuyerRepeatOffender",
  title: "title",
});
