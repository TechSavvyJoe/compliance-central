/**
 * Persisted run identity helpers shared by the sidepanel and service worker.
 *
 * `cancelledRunId` is a tombstone: it prevents a delayed start/write for a
 * cleared run from becoming current again.
 */
import { SEARCH_STATUS } from "./storage-keys.js";

export const RESULT_STATE_MESSAGES = Object.freeze({
  persist: "PERSIST_CURRENT_RESULTS",
  discard: "DISCARD_PERSISTED_RESULTS",
});

// Session-lifetime tombstones also fence messages delayed past a second Clear.
export const CANCELLED_CHECK_IDS_KEY = "cancelledCheckIds";

export function resultIdentity(results) {
  if (results?.runType === "individual") {
    return results.operationId ? `operation:${results.operationId}` : null;
  }
  return results?.runId ? `run:${results.runId}` : null;
}

export function isCheckCancelled(state, identity) {
  if (!identity) return false;
  return (
    state?.[CANCELLED_CHECK_IDS_KEY]?.includes(identity) ||
    identity === `run:${state?.cancelledRunId}` ||
    identity === `operation:${state?.cancelledIndividualOperationId}`
  );
}

export function createRunId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isCurrentRunState(state, expectedRunId) {
  const activeRunId = state?.activeRunId;
  const stateRunId = state?.stateRunId;
  const cancelledRunId = state?.cancelledRunId;

  if (!activeRunId || activeRunId !== stateRunId) return false;
  if (activeRunId === cancelledRunId) return false;
  return expectedRunId === undefined || activeRunId === expectedRunId;
}

/**
 * Whether an open side panel should act on a published `searchStatus`.
 *
 * Progress belongs to the run the panel is watching. Terminal notifications
 * from a torn-down fence must name that same run, including Clear's `idle`.
 *
 * `error` is the exception. The two writers that report a failed run tear the
 * fence down in the *same* write that reports it: the restarted service worker
 * reconciling a run its predecessor was killed in the middle of, and any future
 * writer that follows that shape. By the time the panel reads the state back,
 * `activeRunId` is already null, so `isCurrentRunState` is false and the panel
 * would ignore the only notice it will ever get — leaving a spinner and a
 * locked form over a run that ended minutes ago. The run it was watching is
 * still named by the tombstone it left, so recognise it there.
 */
export function acceptsRunStatusUpdate(state, uiRunId, status) {
  if (uiRunId === null || uiRunId === undefined) return false;
  if (state?.searchStatus !== undefined && state.searchStatus !== status) return false;
  if (status !== SEARCH_STATUS.idle && isCurrentRunState(state, uiRunId)) return true;
  if (status !== SEARCH_STATUS.error && status !== SEARCH_STATUS.idle) return false;
  return !state?.activeRunId &&
    state?.stateRunId === uiRunId && state?.cancelledRunId === uiRunId;
}

/** Generation fence for side-panel operations that cannot be aborted remotely. */
export function createOperationFence() {
  let generation = 0;
  return {
    start() {
      generation += 1;
      return generation;
    },
    cancel() {
      generation += 1;
    },
    isCurrent(token) {
      return token === generation;
    },
  };
}
