/**
 * Compliance history persistence + history modal rendering.
 *
 * Storage key: chrome.storage.local.complianceHistory (array, newest first).
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { sanitizeHTML } from "./dom-utils.js";
import { ICONS } from "./icons.js";
import { calculateFinalDecision } from "./checks.js";

const RETENTION_DAYS = CONFIG.limits.dataRetentionDays;
const MAX_ENTRIES = CONFIG.limits.maxHistoryEntries;
const RESCREEN_DAYS = CONFIG.reminders?.rescreenDays ?? 7;

// Whole days between `timestamp` and now; null if the timestamp is unparseable.
export function daysSince(timestamp, now = Date.now()) {
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / (24 * 60 * 60 * 1000));
}

function agoLabel(days) {
  if (days == null) return "";
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/**
 * Full-run deals (not partial/individual checks) screened at least `days` ago.
 * Used to remind the user to re-screen before delivery. Returns newest first.
 */
export function findAgingDeals(history, days = RESCREEN_DAYS, now = Date.now()) {
  return (history || []).filter((item) => {
    if (item.runType === "individual") return false;
    const d = daysSince(item.timestamp, now);
    return d != null && d >= days;
  });
}

export async function purgeOldHistoryEntries() {
  try {
    const storage = await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
    const history = storage[STORAGE_KEYS.complianceHistory] || [];
    if (history.length === 0) return 0;

    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const filtered = history.filter((entry) => {
      const t = new Date(entry.timestamp).getTime();
      if (Number.isNaN(t)) return false; // drop entries with corrupt timestamps
      return t > cutoff;
    });

    const purged = history.length - filtered.length;
    if (purged > 0) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.complianceHistory]: filtered,
      });
    }
    return purged;
  } catch (error) {
    console.error("Error purging history:", error);
    return 0;
  }
}

export async function saveToHistory(results) {
  try {
    await purgeOldHistoryEntries();
    const finalDecision = historyDecision(results);

    const storage = await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
    const history = storage[STORAGE_KEYS.complianceHistory] || [];
    const checks = results.checks || {};
    const archivedResults = archiveResultsForHistory({
      ...results,
      finalDecision,
    });

    history.unshift({
      id: Date.now(),
      customer: `${results.customer.firstName} ${results.customer.lastName}`,
      vin: results.customer.tradeVin || null,
      timestamp: results.timestamp,
      decision: finalDecision.level,
      runType: results.runType || "full",
      runLabel: results.runLabel || "Run All Checks",
      checks: {
        ofac: checks.ofac?.passed,
        repeatOffender:
          checks.repeatOffender?.status === "not_applicable"
            ? "na"
            : checks.repeatOffender?.passed,
        title: checks.title?.passed,
      },
      fullResults: archivedResults,
    });

    if (history.length > MAX_ENTRIES) {
      history.length = MAX_ENTRIES;
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.complianceHistory]: history,
    });
  } catch (error) {
    console.error("Error saving to history:", error);
  }
}

function historyDecision(results) {
  if (results.runType === "individual") {
    return {
      approved: false,
      level: "PARTIAL",
      reason: `${results.runLabel || "Individual check"} completed`,
    };
  }

  if (results.finalDecision) return results.finalDecision;
  return calculateFinalDecision(results.checks || {});
}

export function archiveResultsForHistory(results) {
  return {
    ...results,
    runType: results.runType || "full",
    runLabel: results.runLabel || "Run All Checks",
    checks: results.checks || {},
  };
}

export async function updateHistoryCount(historyCountEl) {
  if (!historyCountEl) return;
  try {
    const storage = await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
    const history = storage[STORAGE_KEYS.complianceHistory] || [];
    const today = new Date().toDateString();
    const todayCount = history.filter((item) => {
      try {
        return new Date(item.timestamp).toDateString() === today;
      } catch {
        return false;
      }
    }).length;

    historyCountEl.textContent =
      history.length > todayCount
        ? `${todayCount} today, ${history.length} total`
        : `${todayCount} today`;
  } catch (error) {
    console.error("Error updating history count:", error);
  }
}

export async function populateHistoryModal(historyListEl) {
  try {
    const storage = await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
    const history = storage[STORAGE_KEYS.complianceHistory] || [];

    if (history.length === 0) {
      historyListEl.innerHTML =
        '<p class="history-empty">No compliance checks yet</p>';
      return;
    }

    historyListEl.innerHTML = history
      .slice(0, MAX_ENTRIES)
      .map((item, index) => {
        const date = new Date(item.timestamp);
        const timeStr = date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const dateStr = date.toLocaleDateString();
        const days = daysSince(item.timestamp);
        const aging = item.runType !== "individual" && days != null && days >= RESCREEN_DAYS;
        const agoBadge =
          days != null
            ? `<span class="history-age${aging ? " is-aging" : ""}"${
                aging
                  ? ' title="Screened over a week ago — re-screen before delivery"'
                  : ""
              }>${agoLabel(days)}</span>`
            : "";

        let decisionClass = "status-pass";
        let decisionIcon = ICONS.check;
        if (item.decision === "DENIED") {
          decisionClass = "status-fail";
          decisionIcon = ICONS.x;
        } else if (item.decision === "REVIEW" || item.decision === "PARTIAL") {
          decisionClass = "status-warning";
          decisionIcon = ICONS.alertTriangle;
        }

        const checks = item.checks || {};
        const ofacStatus =
          checks.ofac !== undefined
            ? checks.ofac
              ? `<span class="icon-success">${ICONS.check}</span>`
              : `<span class="icon-danger">${ICONS.x}</span>`
            : "—";
        const repeatStatus =
          checks.repeatOffender === "na"
            ? `<span class="icon-muted" title="Not applicable — out-of-state ID">N/A</span>`
            : checks.repeatOffender !== undefined
              ? checks.repeatOffender
                ? `<span class="icon-success">${ICONS.check}</span>`
                : `<span class="icon-danger">${ICONS.x}</span>`
              : "—";
        const titleStatus =
          checks.title !== undefined
            ? checks.title
              ? `<span class="icon-success">${ICONS.check}</span>`
              : `<span class="icon-warning">${ICONS.alertTriangle}</span>`
            : "—";

        const full = item.fullResults;
        const hasOfac = !!full?.checks?.ofac;
        const hasRepeat = !!full?.checks?.repeatOffender?.screenshotData;
        const hasTitle = !!full?.checks?.title?.screenshotData;

        const actionBtn = (cls, label, icon) =>
          `<button class="btn-sm ${cls}" data-index="${index}"><span class="icon-inline">${icon}</span>${label}</button>`;
        const printBtn = (cls, label) => actionBtn(cls, label, ICONS.printer);
        const downloadBtn = (cls, label) => actionBtn(cls, label, ICONS.download);

        return `
        <div class="history-item" data-index="${index}">
          <div class="history-item-header">
            <span class="history-customer">${sanitizeHTML(item.customer)}</span>
            <span class="history-decision ${decisionClass}">${decisionIcon} ${sanitizeHTML(item.decision)}</span>
          </div>
          <div class="history-meta">
            ${dateStr} at ${timeStr} ${agoBadge}
            ${item.runType === "individual" ? ` &middot; ${sanitizeHTML(item.runLabel || "Partial")}` : ""}
            ${item.vin ? ` &middot; VIN: ...${sanitizeHTML(item.vin.slice(-6))}` : " &middot; No Trade-In"}
          </div>
          <div class="history-checks">
            <span title="OFAC Screening"><span class="check-glyph">${ICONS.globe}</span>${ofacStatus}</span>
            <span title="Repeat Offender"><span class="check-glyph">${ICONS.ban}</span>${repeatStatus}</span>
            <span title="Title & Lien"><span class="check-glyph">${ICONS.fileText}</span>${titleStatus}</span>
          </div>
          <div class="history-actions">
            <button class="btn-sm history-view-btn" data-index="${index}"><span class="icon-inline">${ICONS.eye}</span>View &amp; Restore</button>
            ${
              item.runType !== "individual" && full?.customer
                ? `<button class="btn-sm history-rescreen-btn${aging ? " is-aging" : ""}" data-index="${index}"><span class="icon-inline">${ICONS.play}</span>Re-screen</button>`
                : ""
            }
            ${hasOfac ? printBtn("history-print-ofac", "Print OFAC") : ""}
            ${hasOfac ? downloadBtn("history-download-ofac", "OFAC PDF") : ""}
            ${hasRepeat ? printBtn("history-print-repeat", "Print Repeat") : ""}
            ${hasRepeat ? downloadBtn("history-download-repeat", "Repeat PDF") : ""}
            ${hasTitle ? printBtn("history-print-title", "Print Title") : ""}
            ${hasTitle ? downloadBtn("history-download-title", "Title PDF") : ""}
            ${
              hasOfac || hasRepeat || hasTitle
                ? `<button class="btn-sm history-print-all" data-index="${index}"><span class="icon-inline">${ICONS.printer}</span>Print All</button>`
                : ""
            }
            ${
              hasOfac || hasRepeat || hasTitle
                ? `<button class="btn-sm history-download-all" data-index="${index}"><span class="icon-inline">${ICONS.download}</span>All PDF</button>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("");
  } catch (error) {
    console.error("Error populating history:", error);
    historyListEl.innerHTML = '<p class="history-empty">Error loading history</p>';
  }
}

export async function clearAllHistory(historyListEl, historyCountEl) {
  const confirmed = confirm(
    "Are you sure you want to clear ALL compliance history?\n\nThis action cannot be undone."
  );
  if (!confirmed) return false;

  await chrome.storage.local.remove(STORAGE_KEYS.complianceHistory);
  historyListEl.innerHTML =
    '<p class="history-empty">No history entries</p>';
  await updateHistoryCount(historyCountEl);
  return true;
}
