/**
 * Local dealership compliance history.
 *
 * History is a device-local working record for dealership staff. It retains
 * the submitted customer fields and completed result payload needed to reopen
 * a deal, re-run checks, and reproduce its reports. Credential-like fields are
 * always removed before storage and every record remains time/quantity bound.
 */

import { CONFIG } from "./config.js";
import { problemTitleBrands } from "./title-brands.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DECISIONS = new Set(["APPROVED", "DENIED", "REVIEW", "PARTIAL"]);
const OFAC_STATES = new Set([
  "clear",
  "match",
  "potential_match",
  "confirmed_match",
  "false_positive",
  "stale",
  "error",
  "review",
  "not_run",
]);
const REPEAT_STATES = new Set(["eligible", "flagged", "error", "review", "na", "not_run"]);
const TITLE_STATES = new Set(["clear", "lien", "branded", "review", "error", "not_run"]);
const AUDIT_ID_PATTERN = /^(?:run|operation|legacy):[A-Za-z0-9._:-]{1,180}$/;

function timestampMs(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.min(parsed, Date.now()) : null;
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
  // A match outranks staleness. Ordered the other way, a confirmed match found
  // against a cached list recorded as merely "stale" — the deal was DENIED on
  // screen while the permanent record said the list was out of date.
  if (result?.passed === false) {
    if (result.disposition === "confirmed_match") return "confirmed_match";
    if (result.disposition === "false_positive") return "false_positive";
    if (result?.hasMatch || Number(result?.matchCount) > 0 || result?.matches?.length) {
      return "potential_match";
    }
  }
  if (result?.stale) return "stale";
  if (result?.passed === true || legacy === true) return "clear";
  if (result || legacy === false) return "review";
  return "not_run";
}

function repeatState(result, legacy) {
  if (result?.status === "not_applicable" || legacy === "na") return "na";
  if (result?.error || result?.status === "error") return "error";
  // Both signals must agree, exactly as classifyRepeatOffenderResult requires.
  // With OR, a contradictory response (status "eligible" alongside
  // passed:false) recorded as a clean pass in the audit trail while the report
  // printed REVIEW REQUIRED — the one surface that must never soften a
  // contradiction was the one that did.
  if (result) {
    if (result.status === "eligible" && result.passed !== false) return "eligible";
  } else if (legacy === true) {
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
  // Both brand lists, exactly as the decision reads them. Keyed off titleBrand
  // alone, a salvage entry in vehicleBrands beside a clear title status was
  // recorded as "Clear" in the examiner-facing CSV while the deal itself said
  // REVIEW.
  if (problemTitleBrands(result).length > 0) return "branded";
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

function displayName(person) {
  if (!person || typeof person !== "object") return "";
  return [
    person.firstName || person.first,
    person.middleName || person.middle,
    person.lastName || person.last,
    person.suffix,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 180);
}

function storedDisplayName(value) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 180);
}

function storedVin(value) {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, "")
    .slice(0, 17);
  return normalized.length === 17 ? normalized : "";
}

const PRIVATE_KEY_PATTERN = /(?:password|credential|cookie|authorization|authToken|accessToken|refreshToken|apiKey|secret)/i;
const MAX_SCREENSHOT_CHARS = 12 * 1024 * 1024;

function storedSnapshot(value, depth = 0, key = "") {
  if (depth > 8 || PRIVATE_KEY_PATTERN.test(key)) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const max = /(?:screenshot|image|dataUrl)/i.test(key)
      ? MAX_SCREENSHOT_CHARS
      : 20000;
    return value.slice(0, max);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => storedSnapshot(item, depth + 1, key))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;

  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const sanitized = storedSnapshot(childValue, depth + 1, childKey);
    if (sanitized !== undefined) output[childKey] = sanitized;
  }
  return output;
}

/** Normalize a current or legacy entry into the bounded local working-record model. */
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
  const customerName =
    storedDisplayName(entry.customerName) || displayName(legacyResults.customer);
  const coBuyerName = hasCoBuyer
    ? storedDisplayName(entry.coBuyerName) ||
      displayName(legacyResults.customer?.coBuyer)
    : "";
  const tradeVin = storedVin(
    entry.tradeVin || entry.vin || legacyResults.customer?.tradeVin
  );
  const savedResults = storedSnapshot(entry.savedResults || entry.fullResults);

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
    "Run all checks",
    "Run All Checks", // label written by releases before sentence case; keep old records valid
    "OFAC Only",
    "Repeat Offender",
    "Title/Lien",
  ]);
  const runLabel = allowedLabels.has(entry.runLabel)
    ? entry.runLabel
    : runType === "individual"
      ? "Individual check"
      : "Run all checks";

  return {
    id,
    auditId: historyAuditId(entry),
    reference: historyReference(timestamp, id),
    timestamp,
    decision: DECISIONS.has(entry.decision) ? entry.decision : "REVIEW",
    runType,
    runLabel,
    customerName,
    coBuyerName,
    tradeVin,
    savedResults: savedResults && typeof savedResults === "object"
      ? savedResults
      : null,
    hasTrade: Boolean(
      entry.hasTrade || tradeVin || resultsChecks.title
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
