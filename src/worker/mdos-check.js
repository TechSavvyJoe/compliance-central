/**
 * MDOS (Michigan Department of State) checks.
 *
 * Backend-only: the Fly.io API runs Puppeteer against the MDOS portal and
 * returns structured results plus a screenshot. The local-tab fallback was
 * removed in v1.2.0.
 */

import {
  backendRepeatOffenderCheck,
  backendTitleCheck,
} from "../../lib/api-client.js";
import { setBadgeForStatus } from "./badge.js";
import { addToRepeatOffenderHistory } from "./history.js";

export async function handleRepeatOffenderCheck(searchData) {
  const result = await backendRepeatOffenderCheck(searchData);

  if (!result.success) {
    return result;
  }

  const screenshotKey =
    searchData.screenshotStorageKey || "repeatOffenderScreenshot";

  if (result.result.screenshotData) {
    await chrome.storage.local.set({
      [screenshotKey]: result.result.screenshotData,
      lastResult: result.result,
    });
  } else {
    await chrome.storage.local.set({ lastResult: result.result });
  }

  await setBadgeForStatus(result.result.status);
  await addToRepeatOffenderHistory(searchData, result.result);

  return result;
}

export async function handleTitleCheck(data) {
  const result = await backendTitleCheck(data);

  if (!result.success) {
    return result;
  }

  if (result.result.screenshotData) {
    await chrome.storage.local.set({
      titleScreenshot: result.result.screenshotData,
    });
  }

  return result;
}
