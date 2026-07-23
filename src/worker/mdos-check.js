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
import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { setBadgeForStatus } from "./badge.js";

const individualControllers = new Map();
let individualSideEffectLock = Promise.resolve();

function withIndividualSideEffectLock(callback) {
  const task = individualSideEffectLock.then(callback, callback);
  individualSideEffectLock = task.catch(() => {});
  return task;
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
  const allowed = await withIndividualSideEffectLock(async () => {
    if (controller.signal.aborted) return false;
    const stored = await chrome.storage.session.get([
      STORAGE_KEYS.activeIndividualOperationId,
      STORAGE_KEYS.cancelledIndividualOperationId,
    ]);
    if (
      controller.signal.aborted ||
      stored[STORAGE_KEYS.cancelledIndividualOperationId] === operationId
    ) {
      return false;
    }
    await chrome.storage.session.set({
      [STORAGE_KEYS.activeIndividualOperationId]: operationId,
    });
    return !controller.signal.aborted;
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
  return withIndividualSideEffectLock(async () => {
    if (!operation?.allowed || operation.controller.signal.aborted) return false;
    const stored = await chrome.storage.session.get([
      STORAGE_KEYS.activeIndividualOperationId,
      STORAGE_KEYS.cancelledIndividualOperationId,
    ]);
    if (
      operation.controller.signal.aborted ||
      stored[STORAGE_KEYS.activeIndividualOperationId] !==
        operation.operationId ||
      stored[STORAGE_KEYS.cancelledIndividualOperationId] ===
        operation.operationId
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
  const controller = individualControllers.get(operationId);
  controller?.abort();

  return withIndividualSideEffectLock(async () => {
    const stored = await chrome.storage.session.get(
      STORAGE_KEYS.activeIndividualOperationId
    );
    const activeId = stored[STORAGE_KEYS.activeIndividualOperationId];
    // A delayed cancellation for an older operation must not clear a newer one.
    if (activeId && activeId !== operationId) {
      return { success: true, cancelled: false };
    }

    await chrome.storage.session.set({
      [STORAGE_KEYS.cancelledIndividualOperationId]: operationId,
      [STORAGE_KEYS.activeIndividualOperationId]: null,
    });
    await chrome.storage.session.remove([
      STORAGE_KEYS.repeatOffenderScreenshot,
      STORAGE_KEYS.coBuyerRepeatOffenderScreenshot,
      STORAGE_KEYS.titleScreenshot,
      STORAGE_KEYS.lastResult,
    ]);
    await chrome.action.setBadgeText({ text: "" });
    return { success: true, cancelled: !!controller || activeId === operationId };
  });
}

export async function handleRepeatOffenderCheck(searchData) {
  const hasSideEffects = !searchData.suppressSideEffects;
  if (hasSideEffects && !searchData.operationId) {
    return { success: false, error: "Missing check operation ID." };
  }
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
    if (operation?.controller.signal.aborted) return cancelledResult();
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
    if (operation?.controller.signal.aborted) return cancelledResult();
    throw error;
  } finally {
    finishIndividualOperation(operation);
  }
}
