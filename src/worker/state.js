/**
 * Worker state helpers.
 *
 * Serializes chrome.storage.session writes so concurrent check progress
 * updates can't clobber each other.
 */

import { STORAGE_KEYS } from "../../lib/storage-keys.js";

let stateUpdateLock = Promise.resolve();

export async function atomicStateUpdate(updateFn) {
  stateUpdateLock = stateUpdateLock.then(async () => {
    try {
      const current = await chrome.storage.session.get([
        STORAGE_KEYS.currentResults,
        STORAGE_KEYS.searchProgress,
        STORAGE_KEYS.searchStatus,
        STORAGE_KEYS.activeRunId,
        STORAGE_KEYS.stateRunId,
        STORAGE_KEYS.cancelledRunId,
      ]);
      const updates = updateFn(current);
      if (updates && Object.keys(updates).length > 0) {
        await chrome.storage.session.set(updates);
        return { applied: true, error: null };
      }
      return { applied: false, error: null };
    } catch (e) {
      console.error("[State] Atomic update error:", e);
      return { applied: false, error: e };
    }
  });
  return stateUpdateLock;
}
