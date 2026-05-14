/**
 * Daily OFAC SDN refresh alarm.
 */

import { initDB } from "../../ofac/storage.js";
import { handleGetDataStatus, performSDNUpdate } from "./ofac-check.js";

const UPDATE_ALARM_NAME = "ofac-sdn-update";
const UPDATE_INTERVAL_HOURS = 24;

export async function setupUpdateAlarm() {
  await chrome.alarms.clear(UPDATE_ALARM_NAME);
  chrome.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes: UPDATE_INTERVAL_HOURS * 60,
    periodInMinutes: UPDATE_INTERVAL_HOURS * 60,
  });
}

export function registerAlarmListeners() {
  chrome.runtime.onInstalled.addListener(async (details) => {
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
    await setupUpdateAlarm();
  });

  chrome.runtime.onStartup.addListener(async () => {
    await initDB();
    const status = await handleGetDataStatus();
    if (status.needsUpdate) {
      await performSDNUpdate();
    }
    await setupUpdateAlarm();
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === UPDATE_ALARM_NAME) {
      await performSDNUpdate();
    }
  });
}
