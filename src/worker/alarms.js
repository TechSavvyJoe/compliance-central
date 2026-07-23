/**
 * Daily OFAC SDN refresh alarm — fires every morning at 6:00 AM local time.
 *
 * If Chrome is closed at 6 AM, the alarm fires on next startup (assuming the
 * data is stale, which onStartup also checks via needsUpdate).
 */

import { initDB } from "../../ofac/storage.js";
import { handleGetDataStatus, performSDNUpdate } from "./ofac-check.js";
import { purgeHistory } from "./history.js";

const UPDATE_ALARM_NAME = "ofac-sdn-update";
const UPDATE_HOUR_LOCAL = 6;

/** Timestamp (ms since epoch) of the next 6:00 AM local time. */
function nextRefreshTimestamp() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(UPDATE_HOUR_LOCAL, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

export async function setupUpdateAlarm() {
  await chrome.alarms.clear(UPDATE_ALARM_NAME);
  await chrome.alarms.create(UPDATE_ALARM_NAME, {
    when: nextRefreshTimestamp(),
    periodInMinutes: 24 * 60,
  });
}

export function registerAlarmListeners() {
  // Each handler is fully guarded: an async event listener that rejects becomes
  // an unhandled rejection, which Chrome surfaces on the extension Errors page.
  chrome.runtime.onInstalled.addListener(async (details) => {
    try {
      // Persist the next refresh before doing a potentially long first download.
      // If Chrome stops the worker mid-update, the alarm still recovers later.
      await setupUpdateAlarm();
      await purgeHistory();
      if (details.reason === "install") {
        await initDB();
        await performSDNUpdate();
      } else if (details.reason === "update") {
        await initDB();
        const status = await handleGetDataStatus();
        if (status.needsUpdate) {
          await performSDNUpdate();
        }
      }
    } catch (err) {
      console.error("[Alarms] onInstalled handler failed:", err);
    }
  });

  chrome.runtime.onStartup.addListener(async () => {
    try {
      await setupUpdateAlarm();
      await purgeHistory();
      await initDB();
      const status = await handleGetDataStatus();
      if (status.needsUpdate) {
        await performSDNUpdate();
      }
    } catch (err) {
      console.error("[Alarms] onStartup handler failed:", err);
    }
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
      if (alarm.name === UPDATE_ALARM_NAME) {
        await purgeHistory();
        await performSDNUpdate();
      }
    } catch (err) {
      console.error("[Alarms] onAlarm handler failed:", err);
    }
  });
}
