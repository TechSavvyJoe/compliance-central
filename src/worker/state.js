/**
 * Worker state helpers.
 *
 * Serializes chrome.storage.local writes so concurrent check progress
 * updates can't clobber each other.
 */

let stateUpdateLock = Promise.resolve();

export async function atomicStateUpdate(updateFn) {
  stateUpdateLock = stateUpdateLock.then(async () => {
    try {
      const current = await chrome.storage.local.get([
        "currentResults",
        "searchProgress",
        "searchStatus",
      ]);
      const updates = updateFn(current);
      if (updates && Object.keys(updates).length > 0) {
        await chrome.storage.local.set(updates);
      }
    } catch (e) {
      console.error("[State] Atomic update error:", e);
    }
  });
  return stateUpdateLock;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
