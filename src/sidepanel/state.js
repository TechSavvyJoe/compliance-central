/**
 * Sidepanel local state + persistence helpers.
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS, SEARCH_STATUS } from "../../lib/storage-keys.js";
import {
  CANCELLED_CHECK_IDS_KEY,
  RESULT_STATE_MESSAGES,
  createRunId,
  isCheckCancelled,
  isCurrentRunState,
  resultIdentity,
} from "../../lib/run-fence.js";

let currentResults = null;
let isRunning = false;
let expectedResultId = null;

export function getCurrentResults() {
  return currentResults;
}

export function setCurrentResults(next) {
  currentResults = next;
  expectedResultId = resultIdentity(next);
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

export async function persistCurrentResults({ restore = false } = {}) {
  if (!currentResults) return false;
  // A restored history entry is a new working copy, with a fresh cancellation
  // identity. Its audit/history metadata is otherwise retained.
  const results = structuredClone(currentResults);
  if (restore) {
    if (results.runType === "individual") results.operationId = createRunId();
    else results.runId = createRunId();
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: RESULT_STATE_MESSAGES.persist,
      data: { results, expectedResultId: restore ? null : expectedResultId },
    });
    if (!response?.success) throw new Error(response?.error || "Could not save results.");
    if (response.persisted && resultIdentity(currentResults) ===
        (restore ? expectedResultId : resultIdentity(results))) {
      expectedResultId = resultIdentity(results);
      if (restore) currentResults = results;
    }
    return response.persisted === true;
  } catch (error) {
    console.error("Error persisting results:", error);
    return false;
  }
}

export async function discardPersistedResult(resultId, timestamp) {
  return chrome.runtime.sendMessage({
    type: RESULT_STATE_MESSAGES.discard,
    data: { resultId, ...(timestamp === undefined ? {} : { timestamp }) },
  });
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
      STORAGE_KEYS.cancelledIndividualOperationId,
      CANCELLED_CHECK_IDS_KEY,
    ]);

    if (storage[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.running) {
      const runState = {
        activeRunId: storage[STORAGE_KEYS.activeRunId],
        stateRunId: storage[STORAGE_KEYS.stateRunId],
        cancelledRunId: storage[STORAGE_KEYS.cancelledRunId],
      };
      if (!isCurrentRunState(runState) || isCheckCancelled(storage, `run:${runState.activeRunId}`)) {
        return { state: "idle" };
      }
      const startTime = storage[STORAGE_KEYS.currentResults]?.timestamp;
      if (startTime) {
        const parsedTime = new Date(startTime).getTime();
        if (!Number.isNaN(parsedTime)) {
          const elapsed = Date.now() - parsedTime;
          if (elapsed > CONFIG.timeouts.stuckSearchTimeout) {
            const runId = runState.activeRunId;
            const response = await chrome.runtime.sendMessage({
              type: "CANCEL_CURRENT_RUN",
              runId,
            });
            if (!response?.success) throw new Error(response?.error || "Could not cancel the stale check.");
            setCurrentResults(null);
            isRunning = false;
            return { state: "idle" };
          }
        }
      }

      const results = storage[STORAGE_KEYS.currentResults];
      if (resultIdentity(results) !== `run:${runState.activeRunId}`) return { state: "idle" };
      setCurrentResults(results);
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
      !isCheckCancelled(storage, resultIdentity(storage[STORAGE_KEYS.currentResults])) &&
      ((storage[STORAGE_KEYS.currentResults].runType === "individual" &&
          !completedRunState.activeRunId &&
          storage[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.idle) ||
        (storage[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.complete &&
          isCurrentRunState(completedRunState) &&
          resultIdentity(storage[STORAGE_KEYS.currentResults]) === `run:${completedRunState.activeRunId}`))
    ) {
      const resultTime = new Date(storage[STORAGE_KEYS.currentResults].timestamp);
      const parsedTime = resultTime.getTime();
      if (!Number.isNaN(parsedTime)) {
        const hoursDiff = (Date.now() - parsedTime) / 3600000;
        if (hoursDiff < 8) {
          setCurrentResults(storage[STORAGE_KEYS.currentResults]);
          isRunning = false;
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
      setCurrentResults(null);
      isRunning = false;
      await discardPersistedResult(
        resultIdentity(storage[STORAGE_KEYS.currentResults]),
        storage[STORAGE_KEYS.currentResults].timestamp
      );
      return { state: "stale" };
    }

    return { state: "idle" };
  } catch (error) {
    console.error("Error loading persisted results:", error);
    return { state: "idle" };
  }
}
