/**
 * Persisted run identity helpers shared by the sidepanel and service worker.
 *
 * `cancelledRunId` is a tombstone: it prevents a delayed start/write for a
 * cleared run from becoming current again.
 */
import { SEARCH_STATUS } from "./storage-keys.js";

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
 * Progress belongs to the run the panel is watching, so `running` and
 * `complete` are accepted only while that run is still the current one, and
 * `idle` — the Clear tombstone — always returns a panel to rest.
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
  if (status === SEARCH_STATUS.idle) return true;
  if (uiRunId === null || uiRunId === undefined) return false;
  if (isCurrentRunState(state, uiRunId)) return true;
  if (status !== SEARCH_STATUS.error) return false;
  return state?.stateRunId === uiRunId || state?.cancelledRunId === uiRunId;
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
