/**
 * Audit-log CSV export — turns the stored compliance history into a flat CSV
 * for record-keeping / examiner review. The builder (buildAuditCsv) is a pure
 * function so it can be unit-tested; downloadAuditCsv wires it to a browser
 * download. Client-side only — history already lives in chrome.storage.local.
 */

const HEADERS = [
  "Timestamp",
  "Customer",
  "Date of Birth",
  "Trade VIN",
  "Run",
  "OFAC",
  "Repeat Offender",
  "Title & Lien",
  "Final Decision",
];

// RFC-4180 quoting: wrap in quotes when the cell contains a comma, quote, CR or
// LF, and double any embedded quotes. Prevents a name with a comma from
// shifting every downstream column (a silent audit-trail corruption).
function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function checkLabel(value, trueLabel, falseLabel) {
  if (value === "na") return "N/A";
  if (value === true) return trueLabel;
  if (value === false) return falseLabel;
  return "—"; // not run
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
    const dob = item.fullResults?.customer?.dob || "";
    rows.push([
      item.timestamp || "",
      item.customer || "",
      dob,
      item.vin || "",
      item.runLabel || item.runType || "Run All Checks",
      checkLabel(checks.ofac, "Clear", "Match"),
      checkLabel(checks.repeatOffender, "Eligible", "Flagged"),
      checkLabel(checks.title, "Clear", "Review"),
      item.decision || "",
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
