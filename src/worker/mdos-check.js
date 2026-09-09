/**
 * MDOS (Michigan Department of State) checks.
 *
 * Backend-only: the Fly.io API runs Puppeteer against the MDOS portal and
 * returns structured results plus a screenshot. The local-tab fallback was
 * removed in v1.2.0.
 */

import {
  backendRepeatOffenderCheck,
  backendTitleCheck,
} from "../../lib/api-client.js";
import { STORAGE_KEYS, SEARCH_STATUS } from "../../lib/storage-keys.js";
import { CANCELLED_CHECK_IDS_KEY, isCheckCancelled, resultIdentity } from "../../lib/run-fence.js";
import {
  atomicStateUpdate,
  cancellationState,
  clearedResultArtifacts,
  clearBadge,
  withSessionStateLock,
} from "./state.js";
import { setBadgeForStatus } from "./badge.js";

const individualControllers = new Map();

export function isIndividualMdosInFlight() {
  return individualControllers.size > 0;
}

function busyResult() {
  return {
    success: false,
    busy: true,
    error: "A Michigan state-site check is already in progress.",
  };
}

function cancelledResult() {
  return {
    success: false,
    cancelled: true,
    error: "Request cancelled.",
  };
}

async function beginIndividualOperation(operationId) {
  if (!operationId) return null;

  const controller = new AbortController();
  individualControllers.set(operationId, controller);
  const allowed = await withSessionStateLock(async () => {
    if (controller.signal.aborted) return false;
    const stored = await chrome.storage.session.get([
      STORAGE_KEYS.activeIndividualOperationId,
      STORAGE_KEYS.cancelledIndividualOperationId,
      STORAGE_KEYS.searchStatus,
      CANCELLED_CHECK_IDS_KEY,
    ]);
    if (
      controller.signal.aborted ||
      isCheckCancelled(stored, `operation:${operationId}`) ||
      stored[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.running
    ) {
      return false;
    }
    await chrome.storage.session.set({
      ...clearedResultArtifacts(),
      [STORAGE_KEYS.activeRunId]: null,
      [STORAGE_KEYS.stateRunId]: null,
      [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.idle,
      [STORAGE_KEYS.searchProgress]: 0,
      [STORAGE_KEYS.inFlightCheck]: null,
      [STORAGE_KEYS.activeIndividualOperationId]: operationId,
    });
    await clearBadge();
    return !controller.signal.aborted;
  }).catch((error) => {
    if (individualControllers.get(operationId) === controller) {
      individualControllers.delete(operationId);
    }
    throw error;
  });

  if (!allowed && individualControllers.get(operationId) === controller) {
    individualControllers.delete(operationId);
  }
  return { operationId, controller, allowed };
}

function finishIndividualOperation(operation) {
  if (
    operation &&
    individualControllers.get(operation.operationId) === operation.controller
  ) {
    individualControllers.delete(operation.operationId);
  }
}

async function publishIndividualSideEffects(operation, updates, badgeStatus) {
  return withSessionStateLock(async () => {
    if (!operation?.allowed || operation.controller.signal.aborted) return false;
    const stored = await chrome.storage.session.get([
      STORAGE_KEYS.activeIndividualOperationId,
      STORAGE_KEYS.cancelledIndividualOperationId,
      STORAGE_KEYS.activeRunId,
      CANCELLED_CHECK_IDS_KEY,
    ]);
    if (
      operation.controller.signal.aborted ||
      stored[STORAGE_KEYS.activeIndividualOperationId] !==
        operation.operationId ||
      isCheckCancelled(stored, `operation:${operation.operationId}`) ||
      stored[STORAGE_KEYS.activeRunId]
    ) {
      return false;
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.session.set(updates);
    }
    if (badgeStatus) await setBadgeForStatus(badgeStatus);
    return !operation.controller.signal.aborted;
  });
}

/** Abort one individual MDOS request and fence/clean all of its late writes. */
export async function cancelIndividualOperation(operationId) {
  if (!operationId) return { success: false, error: "A check operation ID is required." };
  const controller = individualControllers.get(operationId);
  controller?.abort();
  let cleaned = false;
  try {
    const publication = await atomicStateUpdate((stored) => {
      const tombstone = cancellationState(stored, `operation:${operationId}`);
      const activeId = stored[STORAGE_KEYS.activeIndividualOperationId];
      const ownsResult = resultIdentity(stored[STORAGE_KEYS.currentResults]) === `operation:${operationId}`;
      if (stored[STORAGE_KEYS.activeRunId] ||
          (activeId !== operationId && (activeId || !ownsResult))) return tombstone;
      cleaned = true;
      return {
        ...tombstone,
        ...clearedResultArtifacts(),
        [STORAGE_KEYS.cancelledIndividualOperationId]: operationId,
        [STORAGE_KEYS.activeIndividualOperationId]: null,
      };
    }, async () => { if (cleaned) await clearBadge(); });
    if (publication.error) throw publication.error;
    return { success: true, cancelled: !!controller || cleaned };
  } finally {
    if (individualControllers.get(operationId) === controller) {
      individualControllers.delete(operationId);
    }
  }
}

export async function handleRepeatOffenderCheck(searchData) {
  const hasSideEffects = !searchData.suppressSideEffects;
  if (hasSideEffects && !searchData.operationId) {
    return { success: false, error: "Missing check operation ID." };
  }
  // Claim the individual slot before the first await. That makes the guard
  // atomic within the service-worker event loop and prevents two side-panel
  // clicks from creating overlapping MDOS portal sessions.
  if (hasSideEffects && isIndividualMdosInFlight()) return busyResult();
  const operation = hasSideEffects
    ? await beginIndividualOperation(searchData.operationId)
    : null;
  if (operation && !operation.allowed) return cancelledResult();

  try {
    const result = await backendRepeatOffenderCheck(searchData, {
      signal: operation?.controller.signal || searchData.signal,
    });

    if (!result.success) {
      return result;
    }

    if (!hasSideEffects) return result;

    const screenshotKey =
      searchData.screenshotStorageKey || STORAGE_KEYS.repeatOffenderScreenshot;
    const updates = {
      [STORAGE_KEYS.lastResult]: result.result,
    };
    if (result.result.screenshotData) {
      updates[screenshotKey] = result.result.screenshotData;
    }

    const published = await publishIndividualSideEffects(
      operation,
      updates,
      result.result.status
    );
    return published ? result : cancelledResult();
  } catch (error) {
    if (
      operation?.controller.signal.aborted ||
      searchData?.signal?.aborted ||
      error?.name === "AbortError"
    ) {
      return cancelledResult();
    }
    throw error;
  } finally {
    finishIndividualOperation(operation);
  }
}

export async function handleTitleCheck(data) {
  const hasSideEffects = !data.suppressSideEffects;
  if (hasSideEffects && !data.operationId) {
    return { success: false, error: "Missing check operation ID." };
  }
  if (hasSideEffects && isIndividualMdosInFlight()) return busyResult();
  const operation = hasSideEffects
    ? await beginIndividualOperation(data.operationId)
    : null;
  if (operation && !operation.allowed) return cancelledResult();

  try {
    const result = await backendTitleCheck(data, {
      signal: operation?.controller.signal || data.signal,
    });

    if (!result.success) {
      return result;
    }

    if (!hasSideEffects) return result;

    const updates = {};
    if (result.result.screenshotData) {
      updates[STORAGE_KEYS.titleScreenshot] = result.result.screenshotData;
    }
    const published = await publishIndividualSideEffects(
      operation,
      updates,
      null
    );
    return published ? result : cancelledResult();
  } catch (error) {
    if (
      operation?.controller.signal.aborted ||
      data?.signal?.aborted ||
      error?.name === "AbortError"
    ) {
      return cancelledResult();
    }
    throw error;
  } finally {
    finishIndividualOperation(operation);
  }
}
