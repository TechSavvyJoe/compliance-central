/**
 * OFAC SDN screening logic.
 */

import { downloadAndParseSDN, needsUpdate } from "../../ofac/data.js";
import { searchSDNEntries } from "../../ofac/search.js";
import {
  initDB,
  storeSDNEntries,
  clearSDNEntries,
  saveSetting,
  getSetting,
  getSDNCount,
  getAllSDNEntries,
} from "../../ofac/storage.js";
import { CONFIG } from "../../lib/config.js";

const OFAC_THRESHOLD = CONFIG.ofac.defaultThreshold;
const MAX_MATCHES = CONFIG.limits.maxOfacMatches;

export async function handleOfacCheck(data) {
  try {
    await initDB();

    let entries = await getAllSDNEntries();

    if (entries.length === 0) {
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
    };

    const matches = searchSDNEntries(searchName, entries, OFAC_THRESHOLD);

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
        })),
        entriesSearched: entries.length,
        lastUpdate: (await getSetting("lastUpdate")) || "Unknown",
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
    const entryCount =
      (await getSetting("entryCount")) || (await getSDNCount());
    const updateStatus = await getSetting("updateStatus");
    const lastError = await getSetting("lastError");

    return {
      success: true,
      lastUpdate,
      publishDate,
      entryCount,
      updateStatus,
      lastError,
      needsUpdate: needsUpdate(lastUpdate) || entryCount === 0,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function handleGetSDNEntries() {
  try {
    await initDB();
    const entries = await getAllSDNEntries();
    return { success: true, entries };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function performSDNUpdate() {
  try {
    await saveSetting("updateStatus", "downloading");
    await saveSetting("lastError", null);

    const result = await downloadAndParseSDN();

    await clearSDNEntries();
    await storeSDNEntries(result.entries);

    await saveSetting("lastUpdate", result.downloadedAt);
    await saveSetting("publishDate", result.publishDate);
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
