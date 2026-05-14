/**
 * Compliance history persistence + history modal rendering.
 *
 * Storage key: chrome.storage.local.complianceHistory (array, newest first).
 */

import { CONFIG } from "../../lib/config.js";
import { sanitizeHTML } from "./dom-utils.js";
import { ICONS } from "./icons.js";
import { calculateFinalDecision } from "./checks.js";

const RETENTION_DAYS = CONFIG.limits.dataRetentionDays;
const MAX_ENTRIES = CONFIG.limits.maxHistoryEntries;

export async function purgeOldHistoryEntries() {
  try {
    const storage = await chrome.storage.local.get("complianceHistory");
    const history = storage.complianceHistory || [];
    if (history.length === 0) return 0;

    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const filtered = history.filter((entry) => {
      try {
        return new Date(entry.timestamp).getTime() > cutoff;
      } catch {
        return true;
      }
    });

    const purged = history.length - filtered.length;
    if (purged > 0) {
      await chrome.storage.local.set({ complianceHistory: filtered });
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
    if (!results.finalDecision) {
      results.finalDecision = calculateFinalDecision(results.checks);
    }

    const storage = await chrome.storage.local.get("complianceHistory");
    const history = storage.complianceHistory || [];

    history.unshift({
      id: Date.now(),
      customer: `${results.customer.firstName} ${results.customer.lastName}`,
      vin: results.customer.tradeVin || null,
      timestamp: results.timestamp,
      decision: results.finalDecision?.level || "UNKNOWN",
      checks: {
        ofac: results.checks.ofac?.passed,
        repeatOffender: results.checks.repeatOffender?.passed,
        title: results.checks.title?.passed,
      },
      fullResults: results,
    });

    if (history.length > MAX_ENTRIES) {
      history.length = MAX_ENTRIES;
    }

    await chrome.storage.local.set({ complianceHistory: history });
  } catch (error) {
    console.error("Error saving to history:", error);
  }
}

export async function updateHistoryCount(historyCountEl) {
  if (!historyCountEl) return;
  try {
    const storage = await chrome.storage.local.get("complianceHistory");
    const history = storage.complianceHistory || [];
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
    const storage = await chrome.storage.local.get("complianceHistory");
    const history = storage.complianceHistory || [];

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

        let decisionClass = "status-pass";
        let decisionIcon = ICONS.check;
        if (item.decision === "DENIED") {
          decisionClass = "status-fail";
          decisionIcon = ICONS.x;
        } else if (item.decision === "REVIEW") {
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
          checks.repeatOffender !== undefined
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

        const printBtn = (cls, label) =>
          `<button class="btn-sm ${cls}" data-index="${index}"><span class="icon-inline">${ICONS.printer}</span>${label}</button>`;

        return `
        <div class="history-item" data-index="${index}">
          <div class="history-item-header">
            <span class="history-customer">${sanitizeHTML(item.customer)}</span>
            <span class="history-decision ${decisionClass}">${decisionIcon} ${sanitizeHTML(item.decision)}</span>
          </div>
          <div class="history-meta">
            ${dateStr} at ${timeStr}
            ${item.vin ? ` &middot; VIN: ...${sanitizeHTML(item.vin.slice(-6))}` : " &middot; No Trade-In"}
          </div>
          <div class="history-checks">
            <span title="OFAC Screening"><span class="check-glyph">${ICONS.globe}</span>${ofacStatus}</span>
            <span title="Repeat Offender"><span class="check-glyph">${ICONS.ban}</span>${repeatStatus}</span>
            <span title="Title & Lien"><span class="check-glyph">${ICONS.fileText}</span>${titleStatus}</span>
          </div>
          <div class="history-actions">
            <button class="btn-sm history-view-btn" data-index="${index}"><span class="icon-inline">${ICONS.eye}</span>View &amp; Restore</button>
            ${hasOfac ? printBtn("history-print-ofac", "OFAC") : ""}
            ${hasRepeat ? printBtn("history-print-repeat", "Repeat") : ""}
            ${hasTitle ? printBtn("history-print-title", "Title") : ""}
            ${
              hasOfac || hasRepeat || hasTitle
                ? `<button class="btn-sm history-print-all" data-index="${index}"><span class="icon-inline">${ICONS.printer}</span>Print All</button>`
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

  const doubleConfirmed = confirm(
    "Final confirmation: Delete all history entries permanently?"
  );
  if (!doubleConfirmed) return false;

  await chrome.storage.local.remove("complianceHistory");
  historyListEl.innerHTML =
    '<p class="history-empty">No history entries</p>';
  await updateHistoryCount(historyCountEl);
  return true;
}
