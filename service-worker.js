/**
 * Compliance Central — Background Service Worker entry.
 *
 * Thin shim: wires up message routing, side-panel behavior, and alarms.
 * All business logic lives in src/worker/.
 */

import { handleMessage } from "./src/worker/message-router.js";
import { registerAlarmListeners } from "./src/worker/alarms.js";

console.log("[SW] Compliance Central service worker starting…");

// ---------- Side panel opening ----------
//
// Two parallel paths so the panel opens reliably:
//   1. setPanelBehavior({openPanelOnActionClick:true}) — Chrome handles the
//      click automatically. Persisted; only needs to be set once.
//   2. action.onClicked listener — explicit fallback. If a listener is
//      registered, Chrome routes the click to us instead of auto-opening,
//      so we call chrome.sidePanel.open() ourselves.
//
// Having both is redundant; we keep #2 as the canonical handler.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .then(() => console.log("[SW] setPanelBehavior OK"))
  .catch((err) => console.error("[SW] setPanelBehavior failed:", err));

chrome.action.onClicked.addListener(async (tab) => {
  console.log("[SW] action.onClicked tab=", tab?.id, "window=", tab?.windowId);
  try {
    // Prefer windowId (works regardless of which tab is active).
    if (tab?.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      console.log("[SW] sidePanel.open(windowId) OK");
      return;
    }
    if (tab?.id !== undefined) {
      await chrome.sidePanel.open({ tabId: tab.id });
      console.log("[SW] sidePanel.open(tabId) OK");
      return;
    }
    console.error("[SW] No tab.windowId or tab.id available");
  } catch (err) {
    console.error("[SW] sidePanel.open failed:", err);
  }
});

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  return true; // async response
});

// ---------- Alarms ----------

registerAlarmListeners();

console.log("[SW] Service worker initialized.");
