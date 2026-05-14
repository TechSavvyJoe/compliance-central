/**
 * Compliance Central — Background Service Worker entry.
 *
 * Thin shim: wires up message routing, side-panel behavior, and alarms.
 * All logic lives in src/worker/.
 */

import { handleMessage } from "./src/worker/message-router.js";
import { registerAlarmListeners } from "./src/worker/alarms.js";

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true; // async response
});

registerAlarmListeners();
