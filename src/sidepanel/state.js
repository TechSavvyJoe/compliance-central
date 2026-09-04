/**
 * Sidepanel local state + persistence helpers.
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS, SEARCH_STATUS } from "../../lib/storage-keys.js";
import { isCurrentRunState } from "../../lib/run-fence.js";

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
          operationId: options.operationId || null,
        }
      : currentResults;
  cur.customer = customer;
  cur.runType = options.runType || cur.runType || "individual";
  cur.runLabel = options.runLabel || cur.runLabel || "Individual Check";
  cur.operationId = options.operationId || cur.operationId || null;
  cur.checks = cur.checks || {};
  cur.checks[checkKey] = result;
  currentResults = cur;
  return cur;
}

export async function persistCurrentResults() {
  if (!currentResults) return;
  try {
    // Saving one panel's individual-check result must not announce that no run
    // is in progress anywhere. A side panel is per-window, but the storage
    // namespace is shared: with two windows open, an OFAC-only check in one
    // published `idle` and stood the other one down mid-run — that panel hid
    // its progress, re-enabled its buttons and forgot which run it was
    // watching, so when the run finished no panel accepted the result and it
    // was never shown and never saved to History. A completed compliance run
    // disappearing is the worst way for this to fail.
    //
    // Individual checks are gated behind disabled buttons within a window, so
    // in the single-window case this condition never fires and the reopen path
    // behaves exactly as before.
    const stored = await chrome.storage.session.get([
      STORAGE_KEYS.searchStatus,
      STORAGE_KEYS.activeRunId,
    ]);
    const runInProgress =
      stored[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.running &&
      Boolean(stored[STORAGE_KEYS.activeRunId]);
    await chrome.storage.session.set({
      [STORAGE_KEYS.currentResults]: currentResults,
      ...(runInProgress ? {} : { [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.idle }),
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
      STORAGE_KEYS.activeRunId,
      STORAGE_KEYS.stateRunId,
      STORAGE_KEYS.cancelledRunId,
    ]);

    if (storage[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.running) {
      const runState = {
        activeRunId: storage[STORAGE_KEYS.activeRunId],
        stateRunId: storage[STORAGE_KEYS.stateRunId],
        cancelledRunId: storage[STORAGE_KEYS.cancelledRunId],
      };
      if (!isCurrentRunState(runState)) {
        return { state: "idle" };
      }
      const startTime = storage[STORAGE_KEYS.currentResults]?.timestamp;
      if (startTime) {
        const parsedTime = new Date(startTime).getTime();
        if (!Number.isNaN(parsedTime)) {
          const elapsed = Date.now() - parsedTime;
          if (elapsed > CONFIG.timeouts.stuckSearchTimeout) {
            const runId = runState.activeRunId;
            // Persist the tombstone before messaging the worker. Even if the
            // worker is restarting, delayed state for this run is now rejected.
            await chrome.storage.session.set({
              [STORAGE_KEYS.cancelledRunId]: runId,
              [STORAGE_KEYS.activeRunId]: null,
              [STORAGE_KEYS.stateRunId]: runId,
              [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.idle,
              [STORAGE_KEYS.searchProgress]: 0,
              [STORAGE_KEYS.inFlightCheck]: null,
            });
            try {
              await chrome.runtime.sendMessage({
                type: "CANCEL_CURRENT_RUN",
                runId,
              });
            } catch {
              // SW may be unavailable; still clear local session state.
            }
            await chrome.storage.session.remove([
              STORAGE_KEYS.currentResults,
              STORAGE_KEYS.repeatOffenderScreenshot,
              STORAGE_KEYS.coBuyerRepeatOffenderScreenshot,
              STORAGE_KEYS.titleScreenshot,
              STORAGE_KEYS.lastResult,
            ]);
            await chrome.action.setBadgeText({ text: "" });
            return { state: "idle" };
          }
        }
      }

      currentResults = storage[STORAGE_KEYS.currentResults] || null;
      isRunning = true;
      return {
        state: "running",
        results: currentResults,
        progress: storage[STORAGE_KEYS.searchProgress] || 0,
        runId: runState.activeRunId,
      };
    }

    const completedRunState = {
      activeRunId: storage[STORAGE_KEYS.activeRunId],
      stateRunId: storage[STORAGE_KEYS.stateRunId],
      cancelledRunId: storage[STORAGE_KEYS.cancelledRunId],
    };
    if (
      storage[STORAGE_KEYS.currentResults] &&
      (storage[STORAGE_KEYS.currentResults].runType === "individual" ||
        isCurrentRunState(completedRunState))
    ) {
      const resultTime = new Date(storage[STORAGE_KEYS.currentResults].timestamp);
      const parsedTime = resultTime.getTime();
      if (!Number.isNaN(parsedTime)) {
        const hoursDiff = (Date.now() - parsedTime) / 3600000;
        if (hoursDiff < 8) {
          currentResults = storage[STORAGE_KEYS.currentResults];
          if (currentResults.runType === "individual") {
            return { state: "individual", results: currentResults };
          }
          return {
            state: "complete",
            results: currentResults,
            runId: completedRunState.activeRunId,
          };
        }
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
