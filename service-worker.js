/**
 * Compliance Central — Background Service Worker entry.
 *
 * Thin shim: wires up message routing, side-panel behavior, and alarms.
 * All business logic lives in src/worker/.
 */

import { handleMessage } from "./src/worker/message-router.js";
import { registerAlarmListeners } from "./src/worker/alarms.js";

// Keep API-key/history storage private to trusted extension pages. Chrome's
// local storage area is otherwise readable by any future content script.
Promise.all(
  [chrome.storage.local, chrome.storage.session].map((area) =>
    area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  )
).catch((err) => console.error("[SW] storage access restriction failed:", err));

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
  handleMessage(message, sender)
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
