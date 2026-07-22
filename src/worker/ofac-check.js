/**
 * OFAC SDN screening logic.
 */

import { downloadAndParseSDN, needsUpdate } from "../../ofac/data.js";
import { searchSDNEntries } from "../../ofac/search.js";
import {
  initDB,
  replaceSDNEntries,
  saveSetting,
  getSetting,
  getSDNCount,
  getAllSDNEntries,
} from "../../ofac/storage.js";
import { CONFIG } from "../../lib/config.js";

const OFAC_THRESHOLD = CONFIG.ofac.defaultThreshold;
const MAX_MATCHES = CONFIG.limits.maxOfacMatches;

// A legitimate OFAC SDN list has many thousands of entries. Anything below this
// floor means the download was a maintenance/error page, a truncated body, or a
// changed schema — we refuse it rather than overwrite the last good list.
const MIN_VALID_SDN_ENTRIES = 1000;

// Hours-old of the cached SDN data, or null if never updated / unparseable.
function dataAgeHours(lastUpdate) {
  if (!lastUpdate) return null;
  const t = new Date(lastUpdate).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 3600000));
}

export async function handleOfacCheck(data) {
  try {
    await initDB();

    // Always screen against the freshest available SDN data. If the cached
    // copy is missing OR older than the 24h refresh window, pull the latest
    // from the official OFAC SDN dataset BEFORE searching. (This runs in
    // parallel with the MDOS portal checks, so it rarely adds wall-clock time.)
    // If the refresh fails but a cached copy exists, we still screen against it
    // and flag the result as stale so the user knows the data wasn't current.
    let entries = await getAllSDNEntries();
    const lastUpdateBefore = await getSetting("lastUpdate");
    const dataSourceBefore = await getSetting("dataSource");
    const staleBefore = needsUpdate(lastUpdateBefore);
    const sourceChanged = dataSourceBefore !== CONFIG.ofac.sourceId;

    if (entries.length === 0 || staleBefore || sourceChanged) {
      await performSDNUpdate();
      entries = await getAllSDNEntries();
    }

    if (entries.length === 0) {
      return {
        success: false,
        error: "Could not load SDN database. Please check internet connection.",
      };
    }

    const searchName = {
      firstName: data.firstName || "",
      middleName: data.middleName || "",
      lastName: data.lastName || "",
      // Threaded through for DOB disambiguation (display-only confidence).
      dob: data.dob || "",
    };

    const matches = searchSDNEntries(searchName, entries, OFAC_THRESHOLD);

    // Freshness is based on when this device last retrieved the official feed,
    // not Publish_Date. OFAC publishes a new date when the list changes rather
    // than regenerating an unchanged file daily, so an older publication date
    // can still be the current official list.
    const rawLastUpdate = await getSetting("lastUpdate");
    const rawPublishDate = await getSetting("publishDate");
    const rawDataSource = await getSetting("dataSource");
    const stale =
      needsUpdate(rawLastUpdate) || rawDataSource !== CONFIG.ofac.sourceId;

    return {
      success: true,
      result: {
        hasMatch: matches.length > 0,
        matchCount: matches.length,
        matches: matches.slice(0, MAX_MATCHES).map((m) => ({
          name: m.matchedName,
          score: m.score,
          type: m.entry.type,
          program: m.entry.program,
          country: m.entry.country,
          confidence: m.confidence,
          sdnBirthDate: m.sdnBirthDate,
        })),
        entriesSearched: entries.length,
        lastUpdate: rawLastUpdate || "Unknown",
        downloadedAt: rawLastUpdate || "Unknown",
        publishDate: rawPublishDate || "Unknown",
        dataSource: rawDataSource || "Unknown",
        stale,
        dataAgeHours: dataAgeHours(rawLastUpdate),
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error("OFAC check error:", error);
    return { success: false, error: error.message };
  }
}

export async function handleGetDataStatus() {
  try {
    await initDB();
    const lastUpdate = await getSetting("lastUpdate");
    const publishDate = await getSetting("publishDate");
    const dataSource = await getSetting("dataSource");
    const entryCount = await getSDNCount();
    const updateStatus = await getSetting("updateStatus");
    const lastError = await getSetting("lastError");

    return {
      success: true,
      lastUpdate,
      downloadedAt: lastUpdate,
      publishDate,
      dataSource,
      entryCount,
      updateStatus,
      lastError,
      needsUpdate:
        needsUpdate(lastUpdate) ||
        dataSource !== CONFIG.ofac.sourceId ||
        entryCount === 0,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

let sdnUpdatePromise = null;

// Single-flight guard. The buyer and optional co-buyer OFAC checks run in
// parallel and may both find the data stale on the same run; without this they
// would launch duplicate downloads and racing DB writes. Concurrent callers
// (and the install/startup/alarm triggers) share one in-flight update.
export function performSDNUpdate() {
  if (sdnUpdatePromise) return sdnUpdatePromise;
  sdnUpdatePromise = runSDNUpdate().finally(() => {
    sdnUpdatePromise = null;
  });
  return sdnUpdatePromise;
}

async function runSDNUpdate() {
  try {
    await saveSetting("updateStatus", "downloading");
    await saveSetting("lastError", null);

    const result = await downloadAndParseSDN();

    // Guard against a 200-OK maintenance page, a truncated body, or a changed
    // CSV schema that parses to too few rows. Overwriting the good list with a
    // near-empty one would silently PASS real SDN subjects on a compliance
    // report, so we refuse the update and keep the previous list + timestamp
    // (the data is then treated as stale, never as empty/clean).
    const previousCount =
      (await getSetting("entryCount")) || (await getSDNCount()) || 0;
    const floor =
      previousCount > 0
        ? Math.max(MIN_VALID_SDN_ENTRIES, Math.floor(previousCount * 0.5))
        : MIN_VALID_SDN_ENTRIES;
    if (!result || result.count < floor) {
      throw new Error(
        `SDN update rejected: parsed ${
          result?.count ?? 0
        } entries (expected at least ${floor}). Keeping the previous list.`
      );
    }

    // Atomic clear+store: a failure here rolls back and preserves the old list.
    await replaceSDNEntries(result.entries);

    await saveSetting("lastUpdate", result.downloadedAt);
    await saveSetting("publishDate", result.publishDate);
    await saveSetting("dataSource", CONFIG.ofac.sourceId);
    await saveSetting("entryCount", result.count);
    await saveSetting("updateStatus", "complete");

    return { success: true, updated: true, count: result.count };
  } catch (error) {
    console.error("Failed to update SDN data:", error);
    await saveSetting("updateStatus", "error");
    await saveSetting("lastError", error.message);
    return { success: false, error: error.message };
  }
}
