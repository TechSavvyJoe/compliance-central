/**
 * Compliance history persistence + history modal rendering.
 *
 * Storage key: chrome.storage.local.complianceHistory (array, newest first).
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import {
  historyAuditId,
  minimizeHistoryEntry,
} from "../../lib/history-retention.js";
import { sanitizeHTML } from "./dom-utils.js";
import { ICONS } from "./icons.js";
import { calculateFinalDecision } from "./checks.js";

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
export function decisionMeta(decision) {
  switch (decision) {
    case "APPROVED":
      return { cls: "dec-approved", icon: ICONS.check, label: "Approved" };
    case "DENIED":
      return { cls: "dec-denied", icon: ICONS.x, label: "Denied" };
    case "REVIEW":
      return { cls: "dec-review", icon: ICONS.alertTriangle, label: "Review" };
    case "PARTIAL":
      return { cls: "dec-review", icon: ICONS.alertTriangle, label: "Partial" };
    default:
      return { cls: "dec-review", icon: ICONS.alertTriangle, label: "Unknown" };
  }
}

export function auditStateMeta(kind, value) {
  const maps = {
    ofac: {
      clear: ["pass", "Clear"],
      match: ["fail", "Potential match"],
      stale: ["review", "Stale data"],
      error: ["review", "Unavailable"],
      review: ["review", "Review"],
      not_run: ["none", "Not run"],
    },
    repeat: {
      eligible: ["pass", "Eligible"],
      flagged: ["fail", "Flagged"],
      error: ["review", "Unavailable"],
      review: ["review", "Review"],
      na: ["na", "N/A"],
      not_run: ["none", "Not run"],
    },
    title: {
      clear: ["pass", "Clear"],
      lien: ["review", "Lien"],
      branded: ["review", "Branded"],
      review: ["review", "Review"],
      error: ["review", "Unavailable"],
      not_run: ["none", "Not run"],
    },
  };
  const [state, label] = maps[kind]?.[value] || ["review", "Review"];
  return { state, label };
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
    const result = await chrome.runtime.sendMessage({
      type: "PURGE_HISTORY",
    });
    if (!result?.success) {
      throw new Error(result?.error || "History retention failed");
    }
    return result.purged;
  } catch (error) {
    console.error("Error purging history:", error);
    return 0;
  }
}

export async function saveToHistory(results, { shouldSave = () => true } = {}) {
  try {
    if (!shouldSave()) return false;
    const finalDecision = historyDecision(results);

    const checks = results.checks || {};
    const parsedTimestamp = new Date(results.timestamp).getTime();
    const id = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();
    const auditId = historyAuditId(results);
    const entry = minimizeHistoryEntry({
      id,
      auditId,
      timestamp: results.timestamp,
      decision: finalDecision.level,
      runType: results.runType || "full",
      runLabel: results.runLabel || "Run All Checks",
      hasTrade: Boolean(results.customer?.tradeVin || checks.title),
      hasCoBuyer: Boolean(results.customer?.hasCoBuyer),
      fullResults: { ...results, finalDecision },
    });
    if (!entry) return false;
    if (!shouldSave()) return false;
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_HISTORY_ENTRY",
      data: { entry },
    });
    if (!response?.success || !response.saved) return false;

    if (!shouldSave()) {
      const removal = await chrome.runtime.sendMessage({
        type: "REMOVE_HISTORY_ENTRY",
        data: { auditId },
      });
      if (!removal?.success) {
        throw new Error(removal?.error || "Cancelled history cleanup failed");
      }
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error saving to history:", error);
    return false;
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
        '<div class="history-empty"><strong>No saved checks yet</strong><span>Run a compliance check to create the first history record.</span></div>';
      return;
    }

    const shown = history.slice(0, MAX_ENTRIES);
    const summary = `<div class="history-summary">${history.length} audit record${
      history.length === 1 ? "" : "s"
    } · no customer identity saved</div>`;

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
          const isFull = item.runType !== "individual";
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
          const ofacMeta = auditStateMeta("ofac", checks.ofac);
          const repeatMeta = auditStateMeta("repeat", checks.repeatOffender);
          const titleMeta = auditStateMeta("title", checks.title);
          let chips =
            statusChip(
              `OFAC: ${ofacMeta.label}`,
              "Buyer OFAC SDN name screening",
              ofacMeta.state
            ) +
            statusChip(
              `Repeat: ${repeatMeta.label}`,
              "Buyer Michigan Repeat Offender check",
              repeatMeta.state
            ) +
            statusChip(
              `Title: ${titleMeta.label}`,
              "Title and lien check",
              titleMeta.state
            );
          if (item.hasCoBuyer) {
            const cbOfac = auditStateMeta("ofac", checks.coBuyerOfac);
            const cbRepeat = auditStateMeta(
              "repeat",
              checks.coBuyerRepeatOffender
            );
            chips +=
              statusChip(
                `Co-buyer OFAC: ${cbOfac.label}`,
                "Co-buyer OFAC SDN name screening",
                cbOfac.state
              ) +
              statusChip(
                `Co-buyer Repeat: ${cbRepeat.label}`,
                "Co-buyer Michigan Repeat Offender check",
                cbRepeat.state
              );
          }

          const tradeText = item.hasTrade ? "Trade-in included" : "No trade-in";
          const runText =
            item.runType === "individual"
              ? ` · ${sanitizeHTML(item.runLabel || "Partial")}`
              : "";

          return `
        <div class="history-item ${decisionItemCls}" data-index="${index}">
          <div class="history-item-header">
            <div class="history-id">
              <span class="history-customer">Audit ${sanitizeHTML(item.reference)}</span>
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
            <button class="btn-hist btn-hist-primary history-new-btn" data-index="${index}" title="Start a new screening"><span class="btn-hist-ic">${ICONS.play}</span>Start new screening</button>
          </div>
        </div>`;
        })
        .join("");
  } catch (error) {
    console.error("Error populating history:", error);
    historyListEl.innerHTML =
      '<div class="history-empty history-empty-error"><strong>History could not load</strong><span>Close History and try again. Your saved records have not been cleared.</span></div>';
  }
}

export async function clearAllHistory(historyListEl, historyCountEl) {
  const confirmed = confirm(
    "Are you sure you want to clear ALL compliance history?\n\nThis action cannot be undone."
  );
  if (!confirmed) return false;

  try {
    const result = await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
    if (!result?.success) return false;
  } catch (error) {
    console.error("Error clearing history:", error);
    return false;
  }
  historyListEl.innerHTML =
    '<div class="history-empty"><strong>History cleared</strong><span>New compliance checks will appear here.</span></div>';
  await updateHistoryCount(historyCountEl);
  return true;
}
