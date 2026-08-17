/**
 * Compliance Central — Background Service Worker entry.
 *
 * Thin shim: wires up message routing, side-panel behavior, and alarms.
 * All business logic lives in src/worker/.
 */

import { handleMessage } from "./src/worker/message-router.js";
import { registerAlarmListeners } from "./src/worker/alarms.js";
import { STORAGE_KEYS, SEARCH_STATUS } from "./lib/storage-keys.js";

// Keep API-key/history storage private to trusted extension pages. Chrome's
// local storage area is otherwise readable by any future content script.
const storageAccessReady = Promise.all(
  [chrome.storage.local, chrome.storage.session].map((area) =>
    area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  )
).catch((err) => console.error("[SW] storage access restriction failed:", err));

async function reconcileInterruptedRun() {
  const state = await chrome.storage.session.get([
    STORAGE_KEYS.searchStatus,
    STORAGE_KEYS.activeRunId,
  ]);
  if (state[STORAGE_KEYS.searchStatus] !== SEARCH_STATUS.running) return;
  const interruptedRunId = state[STORAGE_KEYS.activeRunId] || null;
  await chrome.storage.session.set({
    [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.error,
    [STORAGE_KEYS.lastError]:
      "The previous check was interrupted when the extension restarted. Run the checks again.",
    [STORAGE_KEYS.cancelledRunId]: interruptedRunId,
    [STORAGE_KEYS.activeRunId]: null,
    [STORAGE_KEYS.stateRunId]: interruptedRunId,
    [STORAGE_KEYS.inFlightCheck]: null,
  });
  await chrome.action.setBadgeText({ text: "" });
}

const startupReady = storageAccessReady
  .then(reconcileInterruptedRun)
  .catch((err) => console.error("[SW] startup reconciliation failed:", err));

// ---------- Side panel opening ----------
//
// Open the panel when the user clicks the toolbar icon. With
// openPanelOnActionClick:true, Chrome opens it directly and does NOT dispatch
// chrome.action.onClicked — so a manual onClicked handler would be dead code.
// This single documented path is all that's needed (persisted; set once).

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[SW] setPanelBehavior failed:", err));

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  startupReady
    .then(() => handleMessage(message, sender))
    .then((response) => sendResponse(response))
    .catch((error) =>
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : "Unexpected error",
      })
    );
  return true; // async response
});

// ---------- Alarms ----------

registerAlarmListeners();
