/**
 * Sidepanel local state + persistence helpers.
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS, SEARCH_STATUS } from "../../lib/storage-keys.js";

let currentResults = null;
let isRunning = false;

export function getCurrentResults() {
  return currentResults;
}

export function setCurrentResults(next) {
  currentResults = next;
}

export function getIsRunning() {
  return isRunning;
}

export function setIsRunning(value) {
  isRunning = !!value;
}

/**
 * Merge a single-check result into `currentResults` for later printing.
 * Used by individual check handlers (OFAC Only, Repeat Offender, Title).
 */
export function mergeIntoCurrentResults(customer, checkKey, result, options = {}) {
  const cur =
    options.replace || !currentResults
      ? {
          customer,
          checks: {},
          timestamp: new Date().toISOString(),
          runType: options.runType || "individual",
          runLabel: options.runLabel || "Individual Check",
        }
      : currentResults;
  cur.customer = customer;
  cur.runType = options.runType || cur.runType || "individual";
  cur.runLabel = options.runLabel || cur.runLabel || "Individual Check";
  cur.checks = cur.checks || {};
  cur.checks[checkKey] = result;
  currentResults = cur;
  return cur;
}

export async function persistCurrentResults() {
  if (!currentResults) return;
  try {
    await chrome.storage.session.set({
      [STORAGE_KEYS.currentResults]: currentResults,
      [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.idle,
    });
  } catch (error) {
    console.error("Error persisting results:", error);
  }
}

/**
 * Loads any previously running or completed compliance run.
 *
 * @returns one of:
 *   { state: "idle" }
 *   { state: "running", results, progress }
 *   { state: "complete", results }
 *   { state: "stale" }  (auto-cleared)
 */
export async function loadPersistedResults() {
  try {
    const storage = await chrome.storage.session.get([
      STORAGE_KEYS.currentResults,
      STORAGE_KEYS.searchStatus,
      STORAGE_KEYS.searchProgress,
    ]);

    if (storage[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.running) {
      const startTime = storage[STORAGE_KEYS.currentResults]?.timestamp;
      if (startTime) {
        const elapsed = Date.now() - new Date(startTime).getTime();
        if (elapsed > CONFIG.timeouts.stuckSearchTimeout) {
          await chrome.storage.session.set({
            [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.idle,
            [STORAGE_KEYS.searchProgress]: 0,
          });
          return { state: "idle" };
        }
      }

      currentResults = storage[STORAGE_KEYS.currentResults] || null;
      isRunning = true;
      return {
        state: "running",
        results: currentResults,
        progress: storage[STORAGE_KEYS.searchProgress] || 0,
      };
    }

    if (storage[STORAGE_KEYS.currentResults]) {
      const resultTime = new Date(storage[STORAGE_KEYS.currentResults].timestamp);
      const hoursDiff = (Date.now() - resultTime.getTime()) / 3600000;
      if (hoursDiff < 8) {
        currentResults = storage[STORAGE_KEYS.currentResults];
        if (currentResults.runType === "individual") {
          return { state: "individual", results: currentResults };
        }
        return { state: "complete", results: currentResults };
      }
      currentResults = null;
      await chrome.storage.session.remove([
        STORAGE_KEYS.currentResults,
        STORAGE_KEYS.searchStatus,
        STORAGE_KEYS.searchProgress,
      ]);
      return { state: "stale" };
    }

    return { state: "idle" };
  } catch (error) {
    console.error("Error loading persisted results:", error);
    return { state: "idle" };
  }
}
