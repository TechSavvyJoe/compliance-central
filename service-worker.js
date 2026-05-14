/**
 * Compliance Central — Background Service Worker entry.
 *
 * Thin shim: wires up message routing, side-panel behavior, and alarms.
 * All logic lives in src/worker/.
 */

import { handleMessage } from "./src/worker/message-router.js";
import { registerAlarmListeners } from "./src/worker/alarms.js";

// Chrome consumes the toolbar click to open the side panel automatically.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true; // async response
});

registerAlarmListeners();
