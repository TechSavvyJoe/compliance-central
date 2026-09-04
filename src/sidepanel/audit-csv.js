/**
 * Audit-log CSV export — turns the stored compliance history into a flat CSV
 * for record-keeping / examiner review. The builder (buildAuditCsv) is a pure
 * function so it can be unit-tested; downloadAuditCsv wires it to a browser
 * download. Client-side only — history already lives in chrome.storage.local.
 */

import { historyRowDecision } from "./checks.js";

const HEADERS = [
  "Timestamp",
  "Audit Reference",
  "Customer",
  "Co-Buyer",
  "Trade VIN",
  "Run",
  "Buyer OFAC",
  "Buyer Repeat Offender",
  "Co-Buyer OFAC",
  "Co-Buyer Repeat Offender",
  "Title & Lien",
  "Final Decision",
];

// RFC-4180 quoting: wrap in quotes when the cell contains a comma, quote, CR or
// LF, and double any embedded quotes. Prevents a name with a comma from
// shifting every downstream column (a silent audit-trail corruption).
function csvCell(value) {
  let s = value === null || value === undefined ? "" : String(value);
  // Spreadsheet applications may execute cells beginning with these formula
  // markers. Prefix an apostrophe so exported audit text stays inert.
  if (/^\s*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stateLabel(kind, value) {
  const labels = {
    // Every state lib/history-retention.js can store must have a label here.
    // potential_match, confirmed_match and false_positive were missing, so all
    // three fell through to the "Review" default — the examiner-facing CSV
    // could not tell a blocked deal from a routine one.
    ofac: {
      clear: "Clear",
      match: "Potential match",
      potential_match: "Potential match",
      confirmed_match: "Confirmed match — blocked",
      false_positive: "False positive (reviewed)",
      stale: "Clear, but list not current — review",
      error: "Unavailable",
      review: "Review",
      not_run: "Not run",
    },
    repeat: {
      eligible: "Eligible",
      flagged: "Flagged",
      error: "Unavailable",
      review: "Review",
      na: "N/A",
      not_run: "Not run",
    },
    title: {
      clear: "Clear",
      lien: "Active lien",
      branded: "Branded title",
      review: "Review",
      error: "Unavailable",
      not_run: "Not run",
    },
  };
  return labels[kind]?.[value] || "Review";
}

/**
 * Build the audit CSV text from the stored history array (newest first).
 * @param {Array} history
 * @returns {string} CSV with CRLF line endings (no trailing newline)
 */
export function buildAuditCsv(history) {
  const rows = [HEADERS];
  for (const item of history || []) {
    const checks = item.checks || {};
    rows.push([
      item.timestamp || "",
      item.reference || "",
      item.customerName || "",
      item.coBuyerName || "",
      item.tradeVin || "",
      item.runLabel || item.runType || "Run all checks",
      stateLabel("ofac", checks.ofac),
      stateLabel("repeat", checks.repeatOffender),
      item.hasCoBuyer ? stateLabel("ofac", checks.coBuyerOfac) : "N/A",
      item.hasCoBuyer
        ? stateLabel("repeat", checks.coBuyerRepeatOffender)
        : "N/A",
      stateLabel("title", checks.title),
      historyRowDecision(item),
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Trigger a browser download of the audit CSV. Returns the CSV text. */
export function downloadAuditCsv(history) {
  const csv = buildAuditCsv(history);
  // Prepend a UTF-8 BOM so Excel opens non-ASCII names with correct encoding.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `compliance-audit-log-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return csv;
}
