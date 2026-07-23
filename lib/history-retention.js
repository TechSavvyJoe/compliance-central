/**
 * Privacy-safe compliance audit history.
 *
 * Full customer identity and report payloads stay in chrome.storage.session.
 * Persistent history contains only an anonymous reference, timestamps, typed
 * outcomes, and non-identifying workflow flags.
 */

import { CONFIG } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DECISIONS = new Set(["APPROVED", "DENIED", "REVIEW", "PARTIAL"]);
const OFAC_STATES = new Set(["clear", "match", "stale", "error", "review", "not_run"]);
const REPEAT_STATES = new Set(["eligible", "flagged", "error", "review", "na", "not_run"]);
const TITLE_STATES = new Set(["clear", "lien", "branded", "review", "error", "not_run"]);
const AUDIT_ID_PATTERN = /^(?:run|operation|legacy):[A-Za-z0-9._:-]{1,180}$/;

function timestampMs(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function historyReference(timestamp, id) {
  const time = timestampMs(timestamp) ?? Date.now();
  const date = new Date(time);
  const day = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const suffix = String(Number.isFinite(Number(id)) ? Number(id) : time)
    .replace(/\D/g, "")
    .slice(-6)
    .padStart(6, "0");
  return `CC-${day}-${suffix}`;
}

function historySeedHash(value) {
  // FNV-1a is sufficient here: this is a stable, non-secret deduplication key,
  // not a security boundary. Include the timestamp separately to make
  // accidental fallback collisions vanishingly unlikely.
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function isValidHistoryAuditId(value) {
  return typeof value === "string" && AUDIT_ID_PATTERN.test(value);
}

/**
 * Produce the same anonymous ID in every side panel that observes a run.
 * Current workflows always supply a random runId/operationId. The legacy
 * fallback contains only time and workflow metadata, never customer data.
 */
export function historyAuditId(entry) {
  if (isValidHistoryAuditId(entry?.auditId)) return entry.auditId;

  const runId = String(entry?.runId || "");
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(runId)) return `run:${runId}`;

  const operationId = String(entry?.operationId || "");
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(operationId)) {
    return `operation:${operationId}`;
  }

  const time = timestampMs(entry?.timestamp) ?? Date.now();
  const runType = entry?.runType === "individual" ? "individual" : "full";
  const runLabel = String(entry?.runLabel || "").slice(0, 64);
  const legacyId = Number.isFinite(Number(entry?.id)) ? Number(entry.id) : "";
  return `legacy:${time}:${historySeedHash(`${legacyId}:${runType}:${runLabel}`)}`;
}

function ofacState(result, legacy) {
  if (result?.error || result?.status === "error") return "error";
  if (result?.stale) return "stale";
  if (result?.hasMatch || Number(result?.matchCount) > 0 || result?.matches?.length) {
    return "match";
  }
  if (result?.passed === true || legacy === true) return "clear";
  if (result || legacy === false) return "review";
  return "not_run";
}

function repeatState(result, legacy) {
  if (result?.status === "not_applicable" || legacy === "na") return "na";
  if (result?.error || result?.status === "error") return "error";
  if (result?.status === "eligible" || result?.passed === true || legacy === true) {
    return "eligible";
  }
  if (result?.status === "ineligible" || result?.eligible === false) return "flagged";
  if (result || legacy === false) return "review";
  return "not_run";
}

function titleState(result, legacy) {
  if (result?.error || result?.status === "error") return "error";
  const brand = String(result?.titleBrand || "").trim().toUpperCase();
  const titleStatus = String(result?.titleStatus || "");
  if (/no\s+(?:title\s+)?record/i.test(titleStatus) || brand === "UNKNOWN") {
    return "review";
  }
  if (brand && !["CLEAN", "NONE"].includes(brand)) return "branded";
  if (result?.hasLien) return "lien";
  if (
    result?.passed === true &&
    (brand === "CLEAN" || /^clear$/i.test(titleStatus))
  ) {
    return "clear";
  }
  if (TITLE_STATES.has(legacy)) return legacy;
  if (result || legacy === false || legacy === true) return "review";
  return "not_run";
}

function allowedState(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

/** Strip a current or legacy history entry down to its non-identifying audit data. */
export function minimizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const time = timestampMs(entry.timestamp);
  if (time == null) return null;

  const timestamp = new Date(time).toISOString();
  const legacyResults = entry.fullResults || {};
  const resultsChecks = legacyResults.checks || {};
  const legacyChecks = entry.checks || {};
  const id = Number.isFinite(Number(entry.id)) ? Number(entry.id) : time;
  const hasCoBuyer = Boolean(
    entry.hasCoBuyer ||
      legacyResults.customer?.hasCoBuyer ||
      resultsChecks.coBuyerOfac ||
      resultsChecks.coBuyerRepeatOffender
  );

  const ofac = OFAC_STATES.has(legacyChecks.ofac)
    ? legacyChecks.ofac
    : ofacState(resultsChecks.ofac, legacyChecks.ofac);
  const repeatOffender = REPEAT_STATES.has(legacyChecks.repeatOffender)
    ? legacyChecks.repeatOffender
    : repeatState(resultsChecks.repeatOffender, legacyChecks.repeatOffender);
  const coBuyerOfac = hasCoBuyer
    ? allowedState(
        legacyChecks.coBuyerOfac,
        OFAC_STATES,
        ofacState(resultsChecks.coBuyerOfac, legacyChecks.coBuyerOfac)
      )
    : "not_run";
  const coBuyerRepeatOffender = hasCoBuyer
    ? allowedState(
        legacyChecks.coBuyerRepeatOffender,
        REPEAT_STATES,
        repeatState(
          resultsChecks.coBuyerRepeatOffender,
          legacyChecks.coBuyerRepeatOffender
        )
      )
    : "not_run";
  const title = TITLE_STATES.has(legacyChecks.title)
    ? legacyChecks.title
    : titleState(resultsChecks.title, legacyChecks.title);

  const runType = entry.runType === "individual" ? "individual" : "full";
  const allowedLabels = new Set([
    "Run All Checks",
    "OFAC Only",
    "Repeat Offender",
    "Title/Lien",
  ]);
  const runLabel = allowedLabels.has(entry.runLabel)
    ? entry.runLabel
    : runType === "individual"
      ? "Individual check"
      : "Run All Checks";

  return {
    id,
    auditId: historyAuditId(entry),
    reference: historyReference(timestamp, id),
    timestamp,
    decision: DECISIONS.has(entry.decision) ? entry.decision : "REVIEW",
    runType,
    runLabel,
    hasTrade: Boolean(
      entry.hasTrade || entry.vin || legacyResults.customer?.tradeVin || resultsChecks.title
    ),
    hasCoBuyer,
    checks: {
      ofac,
      repeatOffender,
      coBuyerOfac,
      coBuyerRepeatOffender,
      title,
    },
  };
}

export function retainAuditHistory(
  history,
  {
    now = Date.now(),
    retentionDays = CONFIG.limits.dataRetentionDays,
    maxEntries = CONFIG.limits.maxHistoryEntries,
  } = {}
) {
  const cutoff = now - retentionDays * DAY_MS;
  const seenAuditIds = new Set();
  return (Array.isArray(history) ? history : [])
    .map(minimizeHistoryEntry)
    .filter((entry) => entry && timestampMs(entry.timestamp) > cutoff)
    .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp))
    .filter((entry) => {
      if (seenAuditIds.has(entry.auditId)) return false;
      seenAuditIds.add(entry.auditId);
      return true;
    })
    .slice(0, maxEntries);
}
