/**
 * Single authority for persistent compliance-history mutations.
 *
 * Multiple side panels can observe the same completed run. Chrome local
 * storage has no compare-and-swap primitive, so every append/remove/purge/clear
 * is serialized here in the MV3 service worker and deduplicated by auditId.
 */

import {
  isValidHistoryAuditId,
  minimizeHistoryEntry,
  retainAuditHistory,
} from "../../lib/history-retention.js";
import { STORAGE_KEYS } from "../../lib/storage-keys.js";

export const HISTORY_MESSAGES = Object.freeze({
  append: "SAVE_HISTORY_ENTRY",
  remove: "REMOVE_HISTORY_ENTRY",
  purge: "PURGE_HISTORY",
  clear: "CLEAR_HISTORY",
});

const ENTRY_KEYS = new Set([
  "id",
  "auditId",
  "reference",
  "timestamp",
  "decision",
  "runType",
  "runLabel",
  "hasTrade",
  "hasCoBuyer",
  "checks",
]);
const CHECK_KEYS = new Set([
  "ofac",
  "repeatOffender",
  "coBuyerOfac",
  "coBuyerRepeatOffender",
  "title",
]);
const DECISIONS = new Set(["APPROVED", "DENIED", "REVIEW", "PARTIAL"]);
const OFAC_STATES = new Set(["clear", "match", "stale", "error", "review", "not_run"]);
const REPEAT_STATES = new Set(["eligible", "flagged", "error", "review", "na", "not_run"]);
const TITLE_STATES = new Set(["clear", "lien", "branded", "review", "error", "not_run"]);

let historyMutationTail = Promise.resolve();

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isAnonymousHistoryEntry(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, ENTRY_KEYS)) return false;
  if (!Number.isFinite(value.id)) return false;
  if (!isValidHistoryAuditId(value.auditId)) return false;
  if (!/^CC-\d{8}-\d{6}$/.test(value.reference)) return false;
  if (!Number.isFinite(new Date(value.timestamp).getTime())) return false;
  if (!DECISIONS.has(value.decision)) return false;
  if (!["full", "individual"].includes(value.runType)) return false;
  if (typeof value.runLabel !== "string" || value.runLabel.length > 32) {
    return false;
  }
  if (typeof value.hasTrade !== "boolean" || typeof value.hasCoBuyer !== "boolean") {
    return false;
  }
  if (!isRecord(value.checks) || !hasOnlyKeys(value.checks, CHECK_KEYS)) {
    return false;
  }
  return (
    OFAC_STATES.has(value.checks.ofac) &&
    REPEAT_STATES.has(value.checks.repeatOffender) &&
    OFAC_STATES.has(value.checks.coBuyerOfac) &&
    REPEAT_STATES.has(value.checks.coBuyerRepeatOffender) &&
    TITLE_STATES.has(value.checks.title)
  );
}

export function validateHistoryMessage(type, data) {
  switch (type) {
    case HISTORY_MESSAGES.append:
      return isRecord(data) && isAnonymousHistoryEntry(data.entry);
    case HISTORY_MESSAGES.remove:
      return isRecord(data) && isValidHistoryAuditId(data.auditId);
    case HISTORY_MESSAGES.purge:
    case HISTORY_MESSAGES.clear:
      return data === undefined || data === null;
    default:
      return false;
  }
}

function enqueueHistoryMutation(mutation) {
  const operation = historyMutationTail.then(mutation);
  // Keep the queue usable after a quota/runtime failure while returning the
  // original rejection to the caller that needs to show a save warning.
  historyMutationTail = operation.catch(() => undefined);
  return operation;
}

async function readHistory() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
  return Array.isArray(stored[STORAGE_KEYS.complianceHistory])
    ? stored[STORAGE_KEYS.complianceHistory]
    : [];
}

async function writeHistoryIfChanged(original, next) {
  if (JSON.stringify(original) === JSON.stringify(next)) return;
  await chrome.storage.local.set({
    [STORAGE_KEYS.complianceHistory]: next,
  });
}

async function isCancelledAudit(auditId) {
  if (!chrome.storage.session?.get) return false;

  if (auditId.startsWith("run:")) {
    const runId = auditId.slice("run:".length);
    const state = await chrome.storage.session.get(STORAGE_KEYS.cancelledRunId);
    return state[STORAGE_KEYS.cancelledRunId] === runId;
  }
  if (auditId.startsWith("operation:")) {
    const operationId = auditId.slice("operation:".length);
    const state = await chrome.storage.session.get(
      STORAGE_KEYS.cancelledIndividualOperationId
    );
    return (
      state[STORAGE_KEYS.cancelledIndividualOperationId] === operationId
    );
  }
  return false;
}

export function appendHistoryEntry(candidate) {
  if (!isAnonymousHistoryEntry(candidate)) {
    return Promise.resolve({
      success: false,
      saved: false,
      error: "Invalid anonymous history entry",
    });
  }

  const entry = minimizeHistoryEntry(candidate);
  return enqueueHistoryMutation(async () => {
    if (await isCancelledAudit(entry.auditId)) {
      return {
        success: true,
        saved: false,
        cancelled: true,
        auditId: entry.auditId,
      };
    }

    const original = await readHistory();
    const before = retainAuditHistory(original);
    const duplicate = before.some((item) => item.auditId === entry.auditId);
    const next = retainAuditHistory([entry, ...original]);

    // A cancellation can arrive while local storage is being read.
    if (await isCancelledAudit(entry.auditId)) {
      return {
        success: true,
        saved: false,
        cancelled: true,
        auditId: entry.auditId,
      };
    }

    await writeHistoryIfChanged(original, next);

    // If cancellation landed during the write, remove the just-written entry
    // before acknowledging the save.
    if (await isCancelledAudit(entry.auditId)) {
      const latest = await readHistory();
      const withoutCancelled = retainAuditHistory(latest).filter(
        (item) => item.auditId !== entry.auditId
      );
      await writeHistoryIfChanged(latest, withoutCancelled);
      return {
        success: true,
        saved: false,
        cancelled: true,
        auditId: entry.auditId,
      };
    }

    return {
      success: true,
      saved: next.some((item) => item.auditId === entry.auditId),
      duplicate,
      auditId: entry.auditId,
    };
  });
}

export function removeHistoryEntry(auditId) {
  if (!isValidHistoryAuditId(auditId)) {
    return Promise.resolve({
      success: false,
      removed: false,
      error: "Invalid history audit ID",
    });
  }

  return enqueueHistoryMutation(async () => {
    const original = await readHistory();
    const retained = retainAuditHistory(original);
    const next = retained.filter((item) => item.auditId !== auditId);
    await writeHistoryIfChanged(original, next);
    return {
      success: true,
      removed: next.length !== retained.length,
      auditId,
    };
  });
}

export function purgeHistory(now = Date.now()) {
  return enqueueHistoryMutation(async () => {
    const original = await readHistory();
    const retained = retainAuditHistory(original, { now });
    const migrated = JSON.stringify(original) !== JSON.stringify(retained);
    await writeHistoryIfChanged(original, retained);
    return {
      success: true,
      purged: Math.max(0, original.length - retained.length),
      migrated,
      retained: retained.length,
    };
  });
}

export function clearHistory() {
  return enqueueHistoryMutation(async () => {
    await chrome.storage.local.remove([
      STORAGE_KEYS.complianceHistory,
      STORAGE_KEYS.searchHistory,
    ]);
    return { success: true, cleared: true };
  });
}

export function handleHistoryMessage(type, data) {
  switch (type) {
    case HISTORY_MESSAGES.append:
      return appendHistoryEntry(data.entry);
    case HISTORY_MESSAGES.remove:
      return removeHistoryEntry(data.auditId);
    case HISTORY_MESSAGES.purge:
      return purgeHistory();
    case HISTORY_MESSAGES.clear:
      return clearHistory();
    default:
      return Promise.resolve({
        success: false,
        error: `Unknown history message type: ${type}`,
      });
  }
}
