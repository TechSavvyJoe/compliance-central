/**
 * Compliance history persistence + history workspace rendering.
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

export function shortHistoryReference(reference) {
  const value = String(reference || "").trim();
  const tail = value.match(/([A-Za-z0-9]{2})$/)?.[1];
  return tail ? `ref ${tail}` : "saved record";
}

export function historyCustomerLabel(item) {
  const customer = item?.savedResults?.customer || {};
  const last = String(customer.lastName || "").trim();
  const given = [customer.firstName, customer.middleName, customer.suffix]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  if (last && given) return `${last}, ${given}`;
  if (last) return last;
  return String(item?.customerName || "").trim();
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
      potential_match: ["review", "Potential match"],
      confirmed_match: ["fail", "Confirmed match"],
      false_positive: ["pass", "False positive"],
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
  return `<span class="hchip ${meta.cls}" title="${sanitizeHTML(fullName)}">${meta.icon}<span class="hchip-label">${sanitizeHTML(label)}</span></span>`;
}

/**
 * True when a saved plate quote was calculated on an earlier calendar day.
 *
 * Michigan prices a registration from the purchase date, so the same vehicle
 * quotes differently on a different day — verified live at $179.00 for today
 * against $349.00 for a later date. A quote carried over from a previous day is
 * therefore not merely old, it can be wrong, and must be recalculated before it
 * reaches a customer.
 */
export function isPlateQuoteStale(quote, now = Date.now()) {
  if (!quote?.calculatedAt) return false;
  const quoted = new Date(quote.calculatedAt);
  if (Number.isNaN(quoted.getTime())) return false;
  const today = new Date(now);
  return (
    quoted.getFullYear() !== today.getFullYear() ||
    quoted.getMonth() !== today.getMonth() ||
    quoted.getDate() !== today.getDate()
  );
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
      runLabel: results.runLabel || "Run all checks",
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

    if (historyCountEl.classList?.contains?.("tab-count")) {
      historyCountEl.textContent = String(history.length);
      historyCountEl.title =
        history.length > todayCount
          ? `${todayCount} today, ${history.length} total`
          : `${todayCount} today`;
      historyCountEl.setAttribute(
        "aria-label",
        `${history.length} saved audit record${history.length === 1 ? "" : "s"}`
      );
    } else {
      historyCountEl.textContent =
        history.length > todayCount
          ? `${todayCount} today, ${history.length} total`
          : `${todayCount} today`;
    }
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
    const summary = `<div class="history-summary">${history.length} local record${
      history.length === 1 ? "" : "s"
    } · retained up to ${CONFIG.limits.dataRetentionDays} days</div>`;

    historyListEl.innerHTML =
      summary +
      shown
        .map((item) => {
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

          // Rows are addressed by audit id, never by position: the list is
          // rendered once from a snapshot, but a background run can save a new
          // record and re-sort storage underneath it. An index would then point
          // at a different customer than the row the salesperson clicked.
          const auditId = sanitizeHTML(item.auditId || "");

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
          const displayCustomerName = historyCustomerLabel(item);
          const primaryLabel = displayCustomerName
            ? sanitizeHTML(displayCustomerName)
            : `Audit ${sanitizeHTML(item.reference)}`;
          const coBuyerText = item.coBuyerName
            ? ` · Co-buyer ${sanitizeHTML(item.coBuyerName)}`
            : "";
          const vehicleText = item.tradeVin
            ? ` · ${sanitizeHTML(item.tradeVin)}`
            : "";
          const runText =
            item.runType === "individual"
              ? ` · ${sanitizeHTML(item.runLabel || "Partial")}`
              : "";

          return `
        <div class="history-item ${decisionItemCls}" data-audit="${auditId}">
          <div class="history-item-header">
            <div class="history-id">
              <span class="history-customer">${primaryLabel}</span>
              <span class="history-meta">
                <span>${dateStr} · ${timeStr} · ${tradeText}</span>
                ${agoBadge}
                <span class="history-meta-trade" title="${sanitizeHTML(item.reference)}">${vehicleText ? vehicleText.slice(3) + " · " : ""}${sanitizeHTML(shortHistoryReference(item.reference))}${coBuyerText}${runText}</span>
              </span>
            </div>
            <span class="history-decision ${dm.cls}">${dm.icon}<span>${dm.label}</span></span>
          </div>
          <div class="history-checks">${chips}</div>
          <div class="history-actions">
            <button class="btn-hist btn-hist-primary history-open-btn" data-audit="${auditId}" title="Restore this customer and the saved results"><span class="btn-hist-ic">${ICONS.play}</span>Open record</button>
            <button class="btn-hist history-print-btn" data-audit="${auditId}" title="Print the saved reports">Print</button>
            <button class="btn-hist history-download-btn" data-audit="${auditId}" title="Download the saved reports as one PDF">PDF</button>
            ${
              isFull
                ? `<button class="btn-hist history-rescreen-btn${aging ? " is-aging" : ""}" data-audit="${auditId}" title="Restore this customer and run the checks again">Re-screen</button>`
                : ""
            }
            <button class="btn-hist btn-hist-danger history-delete-btn" data-audit="${auditId}" title="Delete only this record" aria-label="Delete this record">Delete</button>
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
