/**
 * Persisted run identity helpers shared by the sidepanel and service worker.
 *
 * `cancelledRunId` is a tombstone: it prevents a delayed start/write for a
 * cleared run from becoming current again.
 */
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
