/**
 * History persistence for Repeat Offender checks.
 *
 * The richer "complianceHistory" feed (full results from "Run All Checks")
 * is written from the sidepanel side. This file maintains the legacy
 * per-check "searchHistory" feed kept by the worker.
 */

import { STORAGE_KEYS } from "../../lib/storage-keys.js";

const MAX_LEGACY_HISTORY = 6;

export async function addToRepeatOffenderHistory(searchData, result) {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.searchHistory);
    const history = data[STORAGE_KEYS.searchHistory] || [];

    history.unshift({
      id: Date.now(),
      name: `${searchData.firstName} ${searchData.lastName}`,
      firstName: searchData.firstName,
      middleName: searchData.middleName || "",
      lastName: searchData.lastName,
      suffix: searchData.suffix || "",
      dob: searchData.dob,
      dlnPid: searchData.dlnPid,
      status: result.status,
      timestamp: result.timestamp || new Date().toISOString(),
      rawText: result.rawText,
      hasScreenshot: false,
    });

    if (history.length > MAX_LEGACY_HISTORY) {
      history.length = MAX_LEGACY_HISTORY;
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.searchHistory]: history });
  } catch (err) {
    console.error("Failed to save Repeat Offender history:", err);
  }
}
