/**
 * Sidepanel local state + persistence helpers.
 */

import { CONFIG } from "../../lib/config.js";

let currentResults = null;

export function getCurrentResults() {
  return currentResults;
}

export function setCurrentResults(next) {
  currentResults = next;
}

export async function persistCurrentResults() {
  if (!currentResults) return;
  try {
    await chrome.storage.local.set({ currentResults });
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
    const storage = await chrome.storage.local.get([
      "currentResults",
      "searchStatus",
      "searchProgress",
    ]);

    if (storage.searchStatus === "running") {
      const startTime = storage.currentResults?.timestamp;
      if (startTime) {
        const elapsed = Date.now() - new Date(startTime).getTime();
        if (elapsed > CONFIG.timeouts.stuckSearchTimeout) {
          await chrome.storage.local.set({
            searchStatus: "idle",
            searchProgress: 0,
          });
          return { state: "idle" };
        }
      }

      currentResults = storage.currentResults || null;
      return {
        state: "running",
        results: currentResults,
        progress: storage.searchProgress || 0,
      };
    }

    if (storage.currentResults) {
      const resultTime = new Date(storage.currentResults.timestamp);
      const hoursDiff = (Date.now() - resultTime.getTime()) / 3600000;
      if (hoursDiff < 8) {
        currentResults = storage.currentResults;
        return { state: "complete", results: currentResults };
      }
      currentResults = null;
      await chrome.storage.local.remove([
        "currentResults",
        "searchStatus",
        "searchProgress",
      ]);
      return { state: "stale" };
    }

    return { state: "idle" };
  } catch (error) {
    console.error("Error loading persisted results:", error);
    return { state: "idle" };
  }
}
