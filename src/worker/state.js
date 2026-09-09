/**
 * Worker state helpers.
 *
 * Serializes chrome.storage.session writes so concurrent check progress
 * updates can't clobber each other.
 */

import { STORAGE_KEYS, SEARCH_STATUS } from "../../lib/storage-keys.js";
import {
  CANCELLED_CHECK_IDS_KEY,
  isCheckCancelled,
  resultIdentity,
} from "../../lib/run-fence.js";

let stateUpdateLock = Promise.resolve();

export function withSessionStateLock(callback) {
  const task = stateUpdateLock.then(callback);
  stateUpdateLock = task.catch(() => {});
  return task;
}

export function cancellationState(current, identity) {
  return {
    [CANCELLED_CHECK_IDS_KEY]: [...new Set([
      ...(current[CANCELLED_CHECK_IDS_KEY] || []),
      ...(current.cancelledRunId ? [`run:${current.cancelledRunId}`] : []),
      ...(current.cancelledIndividualOperationId ? [`operation:${current.cancelledIndividualOperationId}`] : []),
      identity,
    ])],
  };
}

export function clearedResultArtifacts() {
  return {
    [STORAGE_KEYS.currentResults]: null,
    [STORAGE_KEYS.repeatOffenderScreenshot]: null,
    [STORAGE_KEYS.coBuyerRepeatOffenderScreenshot]: null,
    [STORAGE_KEYS.titleScreenshot]: null,
    [STORAGE_KEYS.lastResult]: null,
    [STORAGE_KEYS.lastError]: null,
  };
}

export async function clearBadge() {
  try {
    await chrome.action.setBadgeText({ text: "" });
  } catch (error) {
    console.error("Could not clear the toolbar badge:", error);
  }
}

// The optional side effect stays in the queue too: a cancelled run's delayed
// badge update must finish before cancellation clears it or a new run starts.
export function atomicStateUpdate(updateFn, afterApply) {
  return withSessionStateLock(async () => {
    try {
      const current = await chrome.storage.session.get([
        STORAGE_KEYS.currentResults,
        STORAGE_KEYS.searchProgress,
        STORAGE_KEYS.searchStatus,
        STORAGE_KEYS.activeRunId,
        STORAGE_KEYS.stateRunId,
        STORAGE_KEYS.cancelledRunId,
        STORAGE_KEYS.activeIndividualOperationId,
        STORAGE_KEYS.cancelledIndividualOperationId,
        CANCELLED_CHECK_IDS_KEY,
      ]);
      const updates = await updateFn(current);
      if (updates && Object.keys(updates).length > 0) {
        await chrome.storage.session.set(updates);
        await afterApply?.();
        return { applied: true, error: null };
      }
      return { applied: false, error: null };
    } catch (e) {
      console.error("[State] Atomic update error:", e);
      return { applied: false, error: e };
    }
  });
}

/** Compare ownership and publish in the same worker queue as Run All/Clear. */
export async function persistResults({ results, expectedResultId }) {
  const identity = resultIdentity(results);
  const publication = await atomicStateUpdate((current) => {
    if (!identity || isCheckCancelled(current, identity)) return {};
    if (current[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.running) return {};
    const previous = current[STORAGE_KEYS.currentResults];
    const activeOperation = current[STORAGE_KEYS.activeIndividualOperationId];
    const ownsEmptySlot = !previous && identity === `operation:${activeOperation}`;
    if (resultIdentity(previous) !== expectedResultId && !ownsEmptySlot) return {};
    const activeRun = current[STORAGE_KEYS.activeRunId];
    if (activeRun && expectedResultId !== `run:${activeRun}`) return {};
    if (activeOperation && identity !== `operation:${activeOperation}`) return {};
    const individual = results.runType === "individual";
    return {
      [STORAGE_KEYS.currentResults]: results,
      [STORAGE_KEYS.activeRunId]: individual ? null : results.runId,
      [STORAGE_KEYS.stateRunId]: individual ? null : results.runId,
      [STORAGE_KEYS.activeIndividualOperationId]: null,
      [STORAGE_KEYS.searchStatus]: individual ? SEARCH_STATUS.idle : SEARCH_STATUS.complete,
      [STORAGE_KEYS.searchProgress]: individual ? 0 : 100,
      [STORAGE_KEYS.inFlightCheck]: null,
    };
  });
  if (publication.error) throw publication.error;
  return { success: true, persisted: publication.applied };
}

/** Exact-record cleanup; a stale panel can never erase a newer record. */
export async function discardPersistedResults({ resultId, timestamp }) {
  const publication = await atomicStateUpdate((current) => {
    const results = current[STORAGE_KEYS.currentResults];
    if (!resultId || resultIdentity(results) !== resultId) return {};
    if (timestamp !== undefined && results.timestamp !== timestamp) return {};
    if (current[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.running) return {};
    const runId = current[STORAGE_KEYS.activeRunId];
    if (runId && resultId !== `run:${runId}`) return {};
    const operationId = current[STORAGE_KEYS.activeIndividualOperationId];
    if (operationId && resultId !== `operation:${operationId}`) return {};
    return {
      ...clearedResultArtifacts(),
      ...cancellationState(current, resultId),
      [STORAGE_KEYS.activeRunId]: null,
      [STORAGE_KEYS.stateRunId]: runId || null,
      ...(runId ? { [STORAGE_KEYS.cancelledRunId]: runId } : {}),
      [STORAGE_KEYS.activeIndividualOperationId]: null,
      [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.idle,
      [STORAGE_KEYS.searchProgress]: 0,
      [STORAGE_KEYS.inFlightCheck]: null,
    };
  }, clearBadge);
  if (publication.error) throw publication.error;
  return { success: true, discarded: publication.applied };
}

export async function reconcileInterruptedRun() {
  const publication = await atomicStateUpdate((current) => {
    const updates = {};
    const operationId = current[STORAGE_KEYS.activeIndividualOperationId];
    if (operationId) {
      updates[STORAGE_KEYS.activeIndividualOperationId] = null;
      if (resultIdentity(current[STORAGE_KEYS.currentResults]) !== `operation:${operationId}`) {
        Object.assign(updates, cancellationState(current, `operation:${operationId}`));
        updates[STORAGE_KEYS.cancelledIndividualOperationId] = operationId;
      }
    }
    if (current[STORAGE_KEYS.searchStatus] !== SEARCH_STATUS.running) return updates;
    const runId = current[STORAGE_KEYS.activeRunId] || current[STORAGE_KEYS.stateRunId] || null;
    return {
      ...updates,
      ...(runId ? cancellationState({ ...current, ...updates }, `run:${runId}`) : {}),
      [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.error,
      [STORAGE_KEYS.lastError]: "The previous check was interrupted when the extension restarted. Run the checks again.",
      [STORAGE_KEYS.cancelledRunId]: runId,
      [STORAGE_KEYS.activeRunId]: null,
      [STORAGE_KEYS.stateRunId]: runId,
      [STORAGE_KEYS.inFlightCheck]: null,
    };
  }, clearBadge);
  if (publication.error) throw publication.error;
}
