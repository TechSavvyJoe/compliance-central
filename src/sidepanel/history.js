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

const HISTORY_DASH = '<span class="hchip-dash" aria-hidden="true">–</span>';

// Decision pill styling/label, keyed off the stored decision level.
function decisionMeta(decision) {
  switch (decision) {
    case "DENIED":
      return { cls: "dec-denied", icon: ICONS.x, label: "Denied" };
    case "REVIEW":
      return { cls: "dec-review", icon: ICONS.alertTriangle, label: "Review" };
    case "PARTIAL":
      return { cls: "dec-review", icon: ICONS.alertTriangle, label: "Partial" };
    default:
      return { cls: "dec-approved", icon: ICONS.check, label: "Approved" };
  }
}

// Map a stored per-check value to a chip state.
//   true -> pass, false -> failState, "na" -> na, undefined -> none (not run)
function checkState(value, failState = "fail") {
  if (value === "na") return "na";
  if (value === undefined) return "none";
  return value ? "pass" : failState;
}

function statusChip(label, fullName, state) {
  const meta = {
    pass: { cls: "hchip-pass", icon: ICONS.check },
    fail: { cls: "hchip-fail", icon: ICONS.x },
    review: { cls: "hchip-review", icon: ICONS.alertTriangle },
    na: { cls: "hchip-na", icon: HISTORY_DASH },
    none: { cls: "hchip-none", icon: HISTORY_DASH },
  }[state] || { cls: "hchip-none", icon: HISTORY_DASH };
  return `<span class="hchip ${meta.cls}" title="${fullName}">${meta.icon}<span class="hchip-label">${label}</span></span>`;
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

    const shown = history.slice(0, MAX_ENTRIES);
    const summary = `<div class="history-summary">${history.length} record${
      history.length === 1 ? "" : "s"
    } · newest first</div>`;

    historyListEl.innerHTML =
      summary +
      shown
        .map((item, index) => {
          const date = new Date(item.timestamp);
          const timeStr = date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          const dateStr = date.toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          const days = daysSince(item.timestamp);
          const isFull = item.runType !== "individual" && !!item.fullResults?.customer;
          const aging = isFull && days != null && days >= RESCREEN_DAYS;
          const agoBadge =
            days != null
              ? `<span class="history-age${aging ? " is-aging" : ""}"${
                  aging
                    ? ' title="Screened over a week ago — re-screen before delivery"'
                    : ""
                }>${agoLabel(days)}</span>`
              : "";

          const dm = decisionMeta(item.decision);
          const decisionItemCls = `decision-${dm.cls.replace("dec-", "")}`;

          const checks = item.checks || {};
          const chips =
            statusChip("OFAC", "OFAC sanctions screening", checkState(checks.ofac)) +
            statusChip(
              "Repeat",
              "Michigan Repeat Offender check",
              checkState(checks.repeatOffender)
            ) +
            statusChip(
              "Title",
              "Title & lien check",
              checkState(checks.title, "review")
            );

          const tradeText = item.vin
            ? `VIN …${sanitizeHTML(item.vin.slice(-6))}`
            : "No trade-in";
          const runText =
            item.runType === "individual"
              ? ` · ${sanitizeHTML(item.runLabel || "Partial")}`
              : "";

          const full = item.fullResults;
          const hasOfac = !!full?.checks?.ofac;
          const hasRepeat = !!full?.checks?.repeatOffender?.screenshotData;
          const hasTitle = !!full?.checks?.title?.screenshotData;
          const hasReports = hasOfac || hasRepeat || hasTitle;

          // One tidy row per report: label + print + PDF (icon buttons).
          const repRow = (label, present, printCls, dlCls, extraCls = "") =>
            present
              ? `<div class="rep-row ${extraCls}">
                   <span class="rep-name">${label}</span>
                   <span class="rep-btns">
                     <button class="btn-rep ${printCls}" data-index="${index}" title="Print ${label}" aria-label="Print ${label}">${ICONS.printer}</button>
                     <button class="btn-rep ${dlCls}" data-index="${index}" title="Download ${label} PDF" aria-label="Download ${label} PDF">${ICONS.download}</button>
                   </span>
                 </div>`
              : "";

          const reports = hasReports
            ? `<details class="history-reports">
                 <summary class="history-reports-toggle">
                   <span class="reports-summary-icon">${ICONS.fileText}</span>
                   Reports
                   <span class="rep-chevron">${ICONS.chevron}</span>
                 </summary>
                 <div class="history-reports-panel">
                   ${repRow(
                     "Full deal jacket",
                     true,
                     "history-print-all",
                     "history-download-all",
                     "rep-row-all"
                   )}
                   ${repRow("OFAC", hasOfac, "history-print-ofac", "history-download-ofac")}
                   ${repRow("Repeat Offender", hasRepeat, "history-print-repeat", "history-download-repeat")}
                   ${repRow("Title & Lien", hasTitle, "history-print-title", "history-download-title")}
                 </div>
               </details>`
            : "";

          return `
        <div class="history-item ${decisionItemCls}" data-index="${index}">
          <div class="history-item-header">
            <div class="history-id">
              <span class="history-customer">${sanitizeHTML(item.customer)}</span>
              <span class="history-meta">
                <span>${dateStr} · ${timeStr}</span>
                ${agoBadge}
                <span class="history-meta-trade">${tradeText}${runText}</span>
              </span>
            </div>
            <span class="history-decision ${dm.cls}">${dm.icon}<span>${dm.label}</span></span>
          </div>
          <div class="history-checks">${chips}</div>
          <div class="history-actions">
            <button class="btn-hist btn-hist-primary history-view-btn" data-index="${index}" title="View &amp; restore this deal to the form"><span class="btn-hist-ic">${ICONS.eye}</span>View &amp; Restore</button>
            ${
              isFull
                ? `<button class="btn-hist history-rescreen-btn${aging ? " is-aging" : ""}" data-index="${index}" title="Re-screen against the latest data"><span class="btn-hist-ic">${ICONS.play}</span>Re-screen</button>`
                : ""
            }
          </div>
          ${reports}
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
