/**
 * Shared Title/Lien formatting so the result card, the final-decision banner,
 * and the PDF/print reports describe a title the SAME way. Centralizing this
 * fixes a class of bugs where one surface (decision banner) showed
 * "Trade lien: Unknown" while another (the card) showed the real lien status.
 */

// A lienholder name is only shown if it looks like a real party — guards
// against the MDOS page exposing a header/status word instead of a name, and
// guarantees we never render "Unknown"/"Yes"/a status string as a holder.
const NON_NAME = /^(information|status|none|n\/?a|unknown|active lien|no|yes|holder|lienholder|lien holder|secured party)$/i;

// Strip surrounding whitespace and punctuation (esp. a trailing colon left when
// the source captured a label/header line like "Lienholder Information:").
function trimNoise(value) {
  return String(value || "")
    .replace(/^[\s:.,;–—-]+|[\s:.,;–—-]+$/g, "")
    .trim();
}

export function cleanLienHolder(value) {
  // Trim first, then take only the first column — MDOS tabular rows can append
  // a second label (e.g. "ACME BANK    Address: ...") into the captured line.
  const v = trimNoise(String(value || "").trim().split(/\s{2,}/)[0]);
  if (!v || v.length < 2 || v.length > 80) return "";
  if (!/[a-z]/i.test(v)) return ""; // must contain a letter
  if (NON_NAME.test(v)) return ""; // a header/status word, not a real party
  return v;
}

// Present a lien status string, rejecting junk header/affirmative tokens
// (e.g. a captured "Information" or a bare "Yes") in favor of clear copy.
export function formatLienStatus(status, hasLien) {
  const s = trimNoise(status);
  if (!s || /^unknown$/i.test(s) || NON_NAME.test(s) || /^(yes|active)$/i.test(s)) {
    return hasLien ? "Active lien" : "No active liens";
  }
  return s;
}

// Normalize the MDOS "Title Type" into a clear Paper vs Electronic (digital)
// label. Returns "" when the type is unknown/absent.
export function formatTitleType(titleType) {
  const t = String(titleType || "").trim();
  if (!t || /^unknown$/i.test(t)) return "";
  if (/electronic|\belt\b|e-?title/i.test(t)) return "Electronic (digital e-title)";
  if (/paper/i.test(t)) return "Paper";
  return t;
}

// One-line lien/payoff summary for the decision banner. NEVER shows "Unknown".
export function lienSummary(title) {
  if (!title?.hasLien) return "";
  const holder = cleanLienHolder(title.lienHolder);
  return holder
    ? `Lienholder: ${holder} — payoff required before sale.`
    : "Active lien on the trade — obtain payoff / lien release before sale.";
}
