/**
 * Print + PDF download for compliance reports.
 *
 * - Print path: iframe print (side-panel safe), with popup fallback.
 * - PDF download path: uses jsPDF (loaded globally from lib/jspdf.umd.min.js).
 *
 * jsPDF is loaded as a global UMD bundle, so we read it off `window.jspdf` lazily.
 */

import { sanitizeHTML, buildSanitizedName } from "./dom-utils.js";
import { registerPdfFonts, PDF_FACE } from "../../lib/pdf-fonts.js";
import { showToast } from "./toast.js";
import {
  formatTitleType,
  cleanLienHolder,
  formatLienStatus,
  titlePresentation,
} from "./title-format.js";
import {
  finalDecisionForResults,
  classifyOfacResult,
  classifyRepeatOffenderResult,
} from "./checks.js";
import { ensureDataUrl, imageDataUrlExtension } from "../../lib/data-url.js";
import {
  createPrintPayload,
  PRINT_COLORS,
  PRINT_METRICS,
  PRINT_TIMEOUT_MS,
  PRINT_PAYLOAD_TTL_MS,
  createPrintJobId,
  htmlContainsImages,
  printRgb,
  reportDocumentCSS,
  schedulePrint,
} from "../../lib/print-html.js";

// DOB-disambiguation confidence labels for the OFAC report (mirrors the card).
const OFAC_CONF_LABEL = {
  high: "DOB match",
  medium: "DOB unknown",
  low: "DOB differs",
};

export const REPORT_KEYS = Object.freeze({
  decision: "decision",
  buyerOfac: "buyer-ofac",
  buyerRepeat: "buyer-repeat",
  title: "title",
  coBuyerOfac: "co-buyer-ofac",
  coBuyerRepeat: "co-buyer-repeat",
});

const REPORT_LABELS = Object.freeze({
  [REPORT_KEYS.decision]: "Overall compliance decision",
  [REPORT_KEYS.buyerOfac]: "Buyer OFAC screening",
  [REPORT_KEYS.buyerRepeat]: "Buyer Repeat Offender",
  [REPORT_KEYS.title]: "Title & Lien",
  [REPORT_KEYS.coBuyerOfac]: "Co-buyer OFAC screening",
  [REPORT_KEYS.coBuyerRepeat]: "Co-buyer Repeat Offender",
});

/**
 * Return the reports that exist for this exact result set, in export order.
 * A failed/unavailable check is still a document: its report states that the
 * source was unavailable instead of silently disappearing from the record.
 */
export function availableReportItems(currentResults) {
  if (!currentResults) return [];
  const checks = currentResults.checks || {};
  const coBuyer = currentResults.customer?.coBuyer;
  const items = [
    {
      key: REPORT_KEYS.decision,
      label: REPORT_LABELS[REPORT_KEYS.decision],
    },
  ];

  if (checks.ofac) {
    items.push({
      key: REPORT_KEYS.buyerOfac,
      label: REPORT_LABELS[REPORT_KEYS.buyerOfac],
    });
  }
  if (checks.repeatOffender) {
    items.push({
      key: REPORT_KEYS.buyerRepeat,
      label: REPORT_LABELS[REPORT_KEYS.buyerRepeat],
    });
  }
  if (checks.title) {
    items.push({ key: REPORT_KEYS.title, label: REPORT_LABELS[REPORT_KEYS.title] });
  }
  if (checks.coBuyerOfac && coBuyer) {
    items.push({
      key: REPORT_KEYS.coBuyerOfac,
      label: REPORT_LABELS[REPORT_KEYS.coBuyerOfac],
    });
  }
  if (checks.coBuyerRepeatOffender && coBuyer) {
    items.push({
      key: REPORT_KEYS.coBuyerRepeat,
      label: REPORT_LABELS[REPORT_KEYS.coBuyerRepeat],
    });
  }
  return items;
}

/** Keep only available, unique report keys. Omitted selection means select all. */
export function normalizeReportSelection(currentResults, selectedKeys) {
  const available = availableReportItems(currentResults).map((item) => item.key);
  if (selectedKeys == null) return available;
  const requested = new Set(Array.from(selectedKeys));
  return available.filter((key) => requested.has(key));
}

/** MDOS portal-style DOB display (already MM/DD/YYYY from the form). */
export function formatDobForMdos(dob) {
  return String(dob || "").trim();
}

/** MDOS portal-style DLN/PID display. */
export function formatDlnForMdos(dln) {
  return String(dln || "")
    .trim()
    .toUpperCase();
}

function optionalReportValue(value) {
  return sanitizeHTML(String(value || "").trim());
}

/**
 * Every printed page closes with the same footer, and the footer closes with
 * the page number. The slot is filled by `numberPrintedPages` once the whole
 * document is assembled, because a page cannot know how many follow it.
 */
const PAGE_COUNT_SLOT = '<span class="page-count" data-page-count></span>';

function pageFooterHTML(inner) {
  return `<div class="portal-footer">${inner}${PAGE_COUNT_SLOT}</div>`;
}

/**
 * Replace each page-count slot with "Page N of M". Chrome resolves neither
 * `counter(page)` nor an `@page` margin box, and every `.page` in these
 * documents is exactly one sheet, so the numbering is written in directly.
 *
 * @param {string} html
 * @returns {string}
 */
export function numberPrintedPages(html) {
  const total = (html.match(/data-page-count/g) || []).length;
  if (total === 0) return html;
  let page = 0;
  return html.replace(new RegExp(PAGE_COUNT_SLOT, "g"), () => {
    page += 1;
    return `<span class="page-count">Page ${page} of ${total}</span>`;
  });
}

function reportDate(value, fallback = "Not recorded") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

export function stateEvidenceDataUrl(result) {
  return ensureDataUrl(result?.screenshotData);
}

/**
 * A valid image alone is not enough to call it state-site evidence.  The
 * response itself must also have reached one of the confirmed terminal states.
 * Keeping this rule in one place prevents an ambiguous backend response from
 * being exported as an authentic Michigan record on one output path but not
 * another.
 */
function verifiedRepeatEvidence(result) {
  const state = classifyRepeatOffenderResult(result).state;
  return (
    Boolean(stateEvidenceDataUrl(result)) &&
    ["eligible", "ineligible"].includes(state)
  );
}

function verifiedTitleEvidence(result) {
  const state = titlePresentation(result).state;
  return (
    Boolean(stateEvidenceDataUrl(result)) &&
    ["clear", "branded", "lien"].includes(state)
  );
}

function evidenceImageHTML(result, label) {
  const screenshot = stateEvidenceDataUrl(result);
  if (!screenshot) {
    return evidenceUnavailableHTML(false);
  }
  return `<section class="page evidence-page state-evidence" data-state-evidence>
    <div class="state-evidence-header">
      <div>
        <h2>${sanitizeHTML(label)} — State-Site Capture</h2>
        <p>Actual webpage captured from <strong>https://dsvsesvc.sos.state.mi.us/</strong> during this check.</p>
      </div>
      <span class="state-evidence-part">1 page</span>
    </div>
    <img data-state-evidence-image src="${screenshot}" alt="${sanitizeHTML(label)}" />
    ${pageFooterHTML(
      "Compliance Central record &middot; Actual Michigan state-site webpage capture"
    )}
  </section>`;
}

function evidenceUnavailableHTML(captureRejected = false) {
  if (captureRejected) {
    return `<div class="evidence-unavailable"><strong>Michigan state-site evidence could not be verified.</strong><br>A captured page was returned, but it could not be matched safely to this result. The information above is an app-generated summary, not a Michigan Department of State webpage or document. Re-run the check before relying on it.</div>`;
  }
  return `<div class="evidence-unavailable"><strong>Actual Michigan state-site screenshot unavailable.</strong><br>This is an app-generated summary, not a Michigan Department of State webpage or document. Re-run the check before relying on it when state-site evidence is required.</div>`;
}

/**
 * Print an HTML document from the side panel.
 *
 * Chrome side panels often swallow iframe/popup print(). Prefer a dedicated
 * extension print-runner tab that calls print() in-document, then fall back.
 *
 * @param {string} html
 * @param {{ waitForImages?: boolean }} [options]
 * @returns {boolean} true if a print attempt was started
 */
export async function printHtmlDocument(html, { waitForImages = false } = {}) {
  if (!html || typeof html !== "string") {
    showToast("Nothing to print.", "info");
    return false;
  }

  const shouldWait = waitForImages || htmlContainsImages(html);

  if (await tryPrintViaRunner(html, shouldWait)) return true;
  if (tryPrintViaIframe(html, shouldWait)) return true;
  return tryPrintViaPopup(html, shouldWait);
}

/**
 * Open an inert tab while the click gesture is still warm, persist the payload,
 * and only then navigate that tab to print-runner.html. This ordering prevents
 * the runner from reading before storage.set() has completed.
 */
async function tryPrintViaRunner(html, waitForImages) {
  if (
    typeof chrome === "undefined" ||
    !chrome.runtime?.getURL ||
    !chrome.storage?.session?.set
  ) {
    return false;
  }

  const id = createPrintJobId();
  let runner;
  try {
    runner = window.open("", "_blank");
  } catch {
    return false;
  }
  if (!runner) return false;

  const storage = chrome.storage.session;
  try {
    await storage.set({
      [id]: createPrintPayload(html, waitForImages),
    });
    if (runner.closed) {
      await storage.remove(id);
      return false;
    }
    runner.location.replace(
      chrome.runtime.getURL(`print-runner.html?id=${encodeURIComponent(id)}`)
    );

    // The runner consumes the value immediately. This timeout is a second
    // bound for tabs that are closed or fail to navigate.
    setTimeout(() => {
      storage.remove(id).catch(() => {});
    }, PRINT_PAYLOAD_TTL_MS);
  } catch {
    try {
      await storage.remove(id);
    } catch {
      // ignore cleanup failure
    }
    try {
      runner.close();
    } catch {
      // ignore
    }
    return false;
  }

  return true;
}

function tryPrintViaIframe(html, waitForImages) {
  let iframe;
  try {
    iframe = document.createElement("iframe");
    iframe.setAttribute("title", "Print preview");
    iframe.setAttribute("aria-hidden", "true");
    // Off-screen but non-trivial size — display:none / 0×0 suppress the dialog.
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:800px;height:1100px;opacity:0;border:0;pointer-events:none;z-index:-1;";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      iframe.remove();
      return false;
    }

    doc.open();
    doc.write(html);
    doc.close();

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        iframe.remove();
      } catch {
        // already removed
      }
    };

    // Ensure the iframe is always removed eventually, even if schedulePrint hangs.
    setTimeout(cleanup, PRINT_TIMEOUT_MS);

    const triggerPrint = () => {
      try {
        win.focus();
        win.print();
      } catch {
        cleanup();
        showToast("Could not open the print dialog.", "warning");
        return;
      }
      win.addEventListener("afterprint", cleanup, { once: true });
    };

    schedulePrint(win, doc, waitForImages, triggerPrint).catch(() => {
      cleanup();
      showToast("Could not open the print dialog.", "warning");
    });
    return true;
  } catch {
    try {
      iframe?.remove();
    } catch {
      // ignore
    }
    return false;
  }
}

function tryPrintViaPopup(html, waitForImages) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Popup blocked. Allow popups for this extension.", "warning");
    return false;
  }

  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  } catch {
    try {
      printWindow.close();
    } catch {
      // ignore
    }
    showToast("Could not prepare the print document.", "error");
    return false;
  }

  const triggerPrint = () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      showToast(
        "Could not open the print dialog. Use File → Print in the report tab.",
        "warning"
      );
    }
  };

  schedulePrint(printWindow, printWindow.document, waitForImages, triggerPrint).catch(
    () => {
      showToast("Could not open the print dialog.", "warning");
    }
  );

  // Soft cleanup only — do not close on side-panel focus (that races the dialog).
  let closed = false;
  const closeWindow = () => {
    if (closed || printWindow.closed) return;
    closed = true;
    try {
      printWindow.close();
    } catch {
      // already closed
    }
  };
  printWindow.addEventListener(
    "afterprint",
    () => {
      setTimeout(closeWindow, 250);
    },
    { once: true }
  );
  setTimeout(closeWindow, PRINT_TIMEOUT_MS);

  return true;
}

function openAndPrint(html, waitForImages = false) {
  printHtmlDocument(html, { waitForImages }).catch((err) => {
    console.error("Print failed:", err);
    showToast("Could not prepare the print document.", "error");
  });
}

// ---------- HTML report templates ----------

export function ofacResultArgs(ofac) {
  const classification = classifyOfacResult(ofac);
  if (classification.state === "unavailable") {
    return {
      state: classification.state,
      variant: "warn",
      title: "RESULT UNAVAILABLE",
      subtitle:
        ofac?.error ||
        ofac?.message ||
        "OFAC screening could not be completed. Re-run the check before proceeding.",
    };
  }
  if (classification.state === "missing") {
    return {
      state: classification.state,
      variant: "neutral",
      title: "NOT RUN",
      subtitle: "OFAC screening has not been completed.",
    };
  }
  if (classification.state === "review") {
    return {
      state: classification.state,
      variant: "warn",
      title: "REVIEW REQUIRED",
      subtitle:
        "The OFAC service returned an unrecognized result. Re-run the check before proceeding.",
    };
  }
  if (classification.state === "stale") {
    return {
      state: classification.state,
      variant: "warn",
      title: "REVIEW REQUIRED",
      subtitle:
        "No potential match was found, but the SDN list could not be refreshed. Re-run when online.",
    };
  }
  if (classification.state === "confirmed_match") {
    return {
      state: classification.state,
      variant: "fail",
      title: "CONFIRMED MATCH",
      subtitle: "The dealership marked this potential match as confirmed.",
    };
  }
  if (classification.state === "potential_match") {
    return {
      state: classification.state,
      variant: "fail",
      title: "POTENTIAL MATCH",
      subtitle: "REVIEW REQUIRED — Potential name match found",
    };
  }
  if (classification.state === "false_positive") {
    return {
      state: classification.state,
      variant: "pass",
      title: "FALSE POSITIVE REVIEWED",
      subtitle: "The dealership reviewed the potential match and marked it as a false positive.",
    };
  }
  return {
    state: classification.state,
    variant: "pass",
    title: "NO MATCH FOUND",
    subtitle: "No potential name match was found at the configured screening threshold.",
  };
}

export function ofacReportHTML({
  customer,
  ofac,
  lastUpdate,
  subjectLabel = "SUBJECT SCREENED",
}) {
  return numberPrintedPages(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Compliance Central OFAC Screening Record</title>
  <style>${reportDocumentCSS()}
  </style>
</head>
<body>
  ${getOfacReportPageHTML({ customer, ofac, lastUpdate, subjectLabel })}
</body>
</html>`);
}

/**
 * The one OFAC record. The standalone print and the deal jacket both draw
 * this page, so the running head, the subject panel, the verdict, and the
 * certification are one design wherever the record turns up. Before this the
 * jacket carried its own copy with different labels, a different meta strip,
 * a footer that sat wherever the text ended, and no certification paragraph.
 */
export function getOfacReportPageHTML({
  customer,
  ofac,
  lastUpdate,
  subjectLabel = "SUBJECT SCREENED",
  screenedAt,
}) {
  const subject = customer || {};
  const timestamp = reportDate(Date.now());
  const screeningDate = reportDate(ofac?.timestamp || screenedAt);
  const outcome = ofacResultArgs(ofac);
  const dlnPid = sanitizeHTML(subject.dlnPid);
  const tradeVin = sanitizeHTML(subject.tradeVin);

  return `<div class="page ofac-page">
  <div class="page-header">
    <div>
      <strong>Screening Date:</strong> ${sanitizeHTML(screeningDate)}<br>
      <strong>Entries Searched:</strong> ${ofac?.entriesSearched?.toLocaleString() || "N/A"}
    </div>
    <div class="center">Compliance Central &mdash; All Reports</div>
    <div class="end">
      <strong>Report Generated:</strong> ${sanitizeHTML(timestamp)}<br>
      <strong>Database Updated:</strong> ${sanitizeHTML(lastUpdate || "Unknown")}
    </div>
  </div>
  <p class="app-notice">App-generated record · Not issued or endorsed by the U.S. Treasury or OFAC</p>
  <h1 class="main-title">Compliance Central OFAC Screening Record</h1>
  <p class="doc-sub">Screening against the U.S. Treasury OFAC SDN list<br><em>User-requested automated name comparison; potential matches require human review.</em></p>
  <div class="subject">
    <h3>${sanitizeHTML(subjectLabel)}</h3>
    <table>
      <tr><td>Full Name:</td><td>${buildSanitizedName(subject)}</td></tr>
      <tr><td>Date of Birth:</td><td>${sanitizeHTML(subject.dob) || "Not Provided"}</td></tr>
      <tr><td>Driver License / PID:</td><td>${dlnPid ? `<span class="ref">${dlnPid}</span>` : "Not Provided"}</td></tr>
      ${tradeVin ? `<tr><td>Trade-In VIN:</td><td><span class="ref">${tradeVin}</span></td></tr>` : ""}
    </table>
  </div>
  <div class="result ${outcome.variant}">
    <h2>${sanitizeHTML(outcome.title)}</h2>
    <p>${sanitizeHTML(outcome.subtitle)}</p>
    ${ofacMatchesHTML(ofac, outcome)}
  </div>
  ${
    ofac?.stale
      ? `<div class="certification is-alert"><p><strong>Data Freshness Notice:</strong> This screening used cached SDN data (last updated ${sanitizeHTML(lastUpdate || "Unknown")}). A live update was unavailable at screening time — re-run this check when back online to screen against the current OFAC SDN list.</p></div>`
      : ""
  }
  <div class="certification">
    <p><strong>Screening record:</strong> This report records an automated name search against the U.S. Treasury OFAC SDN list using Compliance Central's configured similarity threshold. It is not an OFAC determination, legal advice, or a compliance certification. Potential matches require human review; no-match results do not by themselves establish that a party is legally cleared.</p>
  </div>
  ${pageFooterHTML(
    `<p><strong>Data Source:</strong> Official U.S. Treasury OFAC SDN List &middot; auto-refreshed every 24 hours.</p>
    <p>Generated by Compliance Central — Michigan Dealer Compliance Hub.</p>`
  )}
</div>`;
}

export function ofacMatchesHTML(ofac, outcome = ofacResultArgs(ofac)) {
  if (!["potential_match", "confirmed_match"].includes(outcome.state)) return "";
  const matches = Array.isArray(ofac?.matches) ? ofac.matches : [];
  const shownMatches = matches.slice(0, 5);
  const totalMatches = Math.max(
    Number.isFinite(Number(ofac?.matchCount)) ? Number(ofac.matchCount) : 0,
    matches.length
  );
  const omittedMatches = Math.max(0, totalMatches - shownMatches.length);
  if (shownMatches.length === 0) {
    return `<div class="matches"><strong>Potential match details unavailable.</strong><p>The service reported ${totalMatches || "one or more"} potential match(es), but did not return the names in this record. Review the live result or re-run the screening before proceeding.</p></div>`;
  }

  const list = shownMatches
    .map((match) => {
      const score = match?.score === undefined ? "N/A" : sanitizeHTML(match.score);
      const confidence = match?.confidence
        ? OFAC_CONF_LABEL[match.confidence] || ""
        : "";
      const details = [
        `Score: ${score}${score === "N/A" ? "" : "%"}`,
        confidence,
        match?.sdnBirthDate ? `SDN DOB ${sanitizeHTML(match.sdnBirthDate)}` : "",
        match?.type ? `Type: ${sanitizeHTML(match.type)}` : "",
      ].filter(Boolean);
      return `<li><strong>${sanitizeHTML(match?.name || "Name unavailable")}</strong>${details.length ? ` (${details.join(", ")})` : ""}</li>`;
    })
    .join("");
  const omitted = omittedMatches
    ? `<p><em>…and ${omittedMatches} additional potential match(es) are not shown here. Review the complete result before proceeding.</em></p>`
    : "";
  return `<div class="matches"><strong>Potential Matches (${totalMatches}):</strong><ul>${list}</ul>${omitted}</div>`;
}

export function getRepeatReportPageHTML(currentResults, isCoBuyer = false) {
  const c = isCoBuyer ? currentResults.customer?.coBuyer : currentResults.customer;
  if (!c) return "";
  const result = isCoBuyer
    ? currentResults.checks?.coBuyerRepeatOffender
    : currentResults.checks?.repeatOffender;
  const outcome = repeatOffenderResultArgs(result);
  if (verifiedRepeatEvidence(result)) {
    return evidenceImageHTML(result, "Michigan Repeat Offender Check");
  }
  const screenedAt = reportDate(result?.timestamp || currentResults.timestamp);
  const generatedAt = reportDate(Date.now());
  const resultClass = outcome.variant === "pass" ? "eligible-card" : "eligible-card result-review";
  const dlnPid = sanitizeHTML(formatDlnForMdos(c.dlnPid));
  const resultIconPath =
    outcome.variant === "pass"
      ? "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
      : "M11 7h2v6h-2zm0 8h2v2h-2zm1-13C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z";

  return `
    <div class="page repeat-page">
      <div class="page-header">
        <div><strong>Screened:</strong> ${sanitizeHTML(screenedAt)}</div>
        <div class="center">Compliance Central &mdash; All Reports</div>
        <div class="end">
          <strong>Customer:</strong> ${buildSanitizedName(c)}<br>
          <strong>Report generated:</strong> ${sanitizeHTML(generatedAt)}
        </div>
      </div>
      <div class="main-title">Michigan Repeat Offender Check</div>

      <div class="summary-notice">
        <strong>Compliance Central summary</strong>
        <span>App-generated overview of the Michigan Repeat Offender response. It is not a state webpage.</span>
      </div>
      
      <div class="content-box">
        <div class="section-title">Subject screened</div>
        <div class="section-subtitle">Customer details used for this check</div>
        
        <div class="form-grid identity-grid">
          <div class="form-field">
            <div class="form-label">First Name</div>
            <div class="form-value">${sanitizeHTML(c.firstName) || "Not provided"}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Middle Name</div>
            <div class="form-value">${optionalReportValue(c.middleName)}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Last Name</div>
            <div class="form-value">${sanitizeHTML(c.lastName) || "Not provided"}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Suffix</div>
            <div class="form-value">${optionalReportValue(c.suffix)}</div>
          </div>
        </div>
        
        <div class="section-title">Enter the ID Information</div>
        
        <div class="form-grid id-grid">
          <div class="form-field">
            <div class="form-label">Date of Birth</div>
            <div class="form-value">${sanitizeHTML(formatDobForMdos(c.dob)) || "Not provided"}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Enter the DLN or PID Number</div>
            <div class="form-value${dlnPid ? " ref" : ""}">${dlnPid || "Not provided"}</div>
          </div>
        </div>
        
        <div class="results-header">Result returned at ${sanitizeHTML(screenedAt)}</div>
        
        <div class="${resultClass}">
          <svg class="eligible-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${resultIconPath}"/></svg>
          <div class="eligible-text">
            <strong>${sanitizeHTML(outcome.title)}</strong>${sanitizeHTML(outcome.subtitle)}
            <div class="eligible-note">This generated summary is not an MDOS-issued document. State-site evidence was unavailable or could not be verified; re-run the check before relying on this record.</div>
          </div>
        </div>
        ${evidenceUnavailableHTML(Boolean(stateEvidenceDataUrl(result)))}
      </div>
      ${pageFooterHTML(
        "Generated by Compliance Central &middot; Michigan Dealer Compliance Hub"
      )}
    </div>
  `;
}

export function getTitleReportPageHTML(currentResults) {
  const c = currentResults.customer;
  if (!c) return "";
  const title = currentResults.checks?.title || {};
  const outcome = titlePresentation(title);
  if (verifiedTitleEvidence(title)) {
    return evidenceImageHTML(title, "Michigan Title & Lien Check");
  }
  const screenedAt = reportDate(title.timestamp || currentResults.timestamp);
  const generatedAt = reportDate(Date.now());
  const notReturned = "Not returned";
  const vin = sanitizeHTML(c.tradeVin);
  const vinHTML = vin ? `<span class="ref">${vin}</span>` : "Not provided";
  const year = title.year || notReturned;
  const make = title.make || notReturned;
  const model = title.model || notReturned;
  const unladenWeight = title.unladenWeight || notReturned;
  const titleType = formatTitleType(title.titleType) || notReturned;
  const titleIssued = title.titleIssued || notReturned;
  const lienStatus = formatLienStatus(title.lienStatus, title.hasLien);
  const vehicleBrands = title.vehicleBrands && title.vehicleBrands.length > 0
    ? title.vehicleBrands.join(", ")
    : title.titleBrand === "CLEAN"
      ? "No brands returned"
      : notReturned;

  return `
    <div class="page title-page">
      <div class="page-header">
        <div><strong>Screened:</strong> ${sanitizeHTML(screenedAt)}</div>
        <div class="center">Compliance Central &mdash; All Reports</div>
        <div class="end">
          <strong>VIN:</strong> ${vinHTML}<br>
          <strong>Report generated:</strong> ${sanitizeHTML(generatedAt)}
        </div>
      </div>
      <div class="main-title">Michigan Title & Lien Check</div>

      <div class="summary-notice">
        <strong>Compliance Central summary</strong>
        <span>App-generated overview of the Michigan Title &amp; Lien response. It is not a state webpage.</span>
      </div>
      
      <div class="content-box">
        <div class="section-title">Search Results</div>
        
        <div class="vin-search-info">
          Search results for VIN <strong>${vinHTML}</strong> at <strong>${sanitizeHTML(screenedAt)}</strong>
        </div>

        <div class="eligible-card ${outcome.statusKey === "pass" ? "" : "result-review"}">
          <div class="eligible-text"><strong>${sanitizeHTML(outcome.title)}</strong>${sanitizeHTML(outcome.subtitle)}
          <div class="eligible-note">This generated summary is not an MDOS-issued document. State-site evidence was unavailable or could not be verified; re-run the check before relying on this record.</div></div>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Year:</div>
          <div class="detail-value">${sanitizeHTML(year)}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Make:</div>
          <div class="detail-value">${sanitizeHTML(make)}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Model:</div>
          <div class="detail-value">${sanitizeHTML(model)}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Unladen Weight:</div>
          <div class="detail-value">${sanitizeHTML(unladenWeight)}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Title Type:</div>
          <div class="detail-value">${sanitizeHTML(titleType)}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Title Issued:</div>
          <div class="detail-value">${sanitizeHTML(titleIssued)}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Lien Status:</div>
          <div class="detail-value${title.hasLien ? " red" : ""}">${sanitizeHTML(lienStatus)}</div>
        </div>
        
        <div class="brands-section">
          <div class="brands-title">Vehicle Brands</div>
          <div class="brands-text">${sanitizeHTML(vehicleBrands)}</div>
        </div>
        ${evidenceUnavailableHTML(Boolean(stateEvidenceDataUrl(title)))}
      </div>
      ${pageFooterHTML(
        "Generated by Compliance Central &middot; Michigan Dealer Compliance Hub"
      )}
    </div>
  `;
}

function reportRow(label, state, detail, incomplete = false) {
  return { label, state, detail, incomplete };
}

function ofacReportRow(label, result) {
  const outcome = ofacResultArgs(result);
  const labels = {
    clear: "CLEAR",
    match: "POTENTIAL MATCH",
    potential_match: "POTENTIAL MATCH",
    confirmed_match: "CONFIRMED MATCH",
    false_positive: "FALSE POSITIVE REVIEWED",
    stale: "REVIEW REQUIRED",
    unavailable: "UNAVAILABLE",
    missing: "NOT RUN",
    review: "REVIEW REQUIRED",
  };
  return reportRow(
    label,
    labels[outcome.state] || "REVIEW REQUIRED",
    outcome.subtitle,
    ["missing", "unavailable", "review", "stale", "potential_match"].includes(outcome.state)
  );
}

function repeatReportRow(label, result) {
  const classification = classifyRepeatOffenderResult(result);
  const outcome = repeatOffenderResultArgs(result);
  const labels = {
    eligible: "ELIGIBLE",
    ineligible: "NOT ELIGIBLE",
    not_applicable: "NOT APPLICABLE",
    unavailable: "UNAVAILABLE",
    missing: "NOT RUN",
    review: "REVIEW REQUIRED",
  };
  return reportRow(
    label,
    labels[classification.state] || "REVIEW REQUIRED",
    outcome.subtitle,
    ["missing", "unavailable", "review"].includes(classification.state)
  );
}

function titleReportRow(result, hasTrade) {
  if (!hasTrade) {
    return reportRow(
      "Title / Lien",
      "NOT APPLICABLE",
      "No trade-in VIN was provided.",
      false
    );
  }
  if (!result) {
    return reportRow(
      "Title / Lien",
      "NOT RUN",
      "A trade-in VIN was provided, but the Title/Lien check was not completed.",
      true
    );
  }
  if (result.error || result.status === "error") {
    return reportRow(
      "Title / Lien",
      "UNAVAILABLE",
      result.error || "The Title/Lien check could not be completed.",
      true
    );
  }
  const outcome = titlePresentation(result);
  return reportRow(
    "Title / Lien",
    outcome.statusKey === "pass" ? "CLEAR" : "REVIEW REQUIRED",
    outcome.subtitle,
    false
  );
}

/**
 * One typed model drives the combined HTML and PDF summary pages.
 */
export function reportDecisionSummary(currentResults) {
  const customer = currentResults?.customer || {};
  const checks = currentResults?.checks || {};
  const rows = [
    ofacReportRow("Buyer OFAC", checks.ofac),
    repeatReportRow("Buyer Repeat Offender", checks.repeatOffender),
  ];

  if (customer.coBuyer) {
    rows.push(
      ofacReportRow("Co-buyer OFAC", checks.coBuyerOfac),
      repeatReportRow(
        "Co-buyer Repeat Offender",
        checks.coBuyerRepeatOffender
      )
    );
  }

  rows.push(titleReportRow(checks.title, Boolean(customer.tradeVin)));

  const incomplete = rows.filter((row) => row.incomplete);
  // The downgrade this report has always applied now lives in checks.js, so
  // the panel reaches the same verdict from the same record.
  const decision = finalDecisionForResults(currentResults);

  return { decision, rows, incomplete };
}

export function getFinalDecisionReportPageHTML(currentResults) {
  const summary = reportDecisionSummary(currentResults);
  const level = ["APPROVED", "DENIED", "REVIEW"].includes(summary.decision.level)
    ? summary.decision.level
    : "REVIEW";
  const rows = summary.rows
    .map(
      (row) => `<tr>
        <th scope="row">${sanitizeHTML(row.label)}</th>
        <td><strong>${sanitizeHTML(row.state)}</strong></td>
        <td>${sanitizeHTML(row.detail)}</td>
      </tr>`
    )
    .join("");
  const incomplete = summary.incomplete.length
    ? `<div class="incomplete-checks"><h2>Incomplete checks</h2><p>The following checks must be re-run or resolved before relying on this report:</p><ul>${summary.incomplete
        .map(
          (row) =>
            `<li><strong>${sanitizeHTML(row.label)}:</strong> ${sanitizeHTML(row.state)} — ${sanitizeHTML(row.detail)}</li>`
        )
        .join("")}</ul></div>`
    : `<div class="complete-checks"><h2>Incomplete checks</h2><p>None. Every required check returned a recognized result.</p></div>`;

  // The decision page is the cover of the jacket, so it carries the same meta
  // strip as every sheet filed behind it.
  const customer = currentResults?.customer || {};
  return `<div class="page decision-page">
    <div class="page-header">
      <div><strong>Screened:</strong> ${sanitizeHTML(reportDate(currentResults?.timestamp))}</div>
      <div class="center">Compliance Central &mdash; All Reports</div>
      <div class="end">
        <strong>Customer:</strong> ${buildSanitizedName(customer)}<br>
        <strong>Report generated:</strong> ${sanitizeHTML(reportDate(Date.now()))}
      </div>
    </div>
    <div class="main-title">Overall Compliance Decision</div>
    <div class="overall-decision decision-${level.toLowerCase()}">
      <strong>${sanitizeHTML(level === "REVIEW" ? "REVIEW REQUIRED" : level)}</strong>
      <span>${sanitizeHTML(summary.decision.reason)}</span>
    </div>
    <h2 class="check-summary-title">Check summary</h2>
    <table class="check-summary">
      <thead><tr><th>Check</th><th>Outcome</th><th>Meaning</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${incomplete}
    ${pageFooterHTML(
      "Generated by Compliance Central &middot; Review source evidence before completing a transaction."
    )}
  </div>`;
}

export function combinedAllReportHTML(currentResults, selectedKeys) {
  const customer = currentResults?.customer || {};
  const ofac = currentResults?.checks?.ofac;
  const repeatOffender = currentResults?.checks?.repeatOffender;
  const title = currentResults?.checks?.title;
  const cbOfac = currentResults?.checks?.coBuyerOfac;
  const cbRepeat = currentResults?.checks?.coBuyerRepeatOffender;
  const coBuyer = customer.coBuyer;
  const selected = new Set(
    normalizeReportSelection(currentResults, selectedKeys)
  );

  const sections = [];
  if (selected.has(REPORT_KEYS.decision)) {
    sections.push(getFinalDecisionReportPageHTML(currentResults));
  }

  if (ofac && selected.has(REPORT_KEYS.buyerOfac)) {
    sections.push(
      getOfacReportPageHTML({
        customer,
        ofac,
        lastUpdate: ofac.lastUpdate,
        screenedAt: currentResults.timestamp,
      })
    );
  }

  if (cbOfac && coBuyer && selected.has(REPORT_KEYS.coBuyerOfac)) {
    sections.push(
      getOfacReportPageHTML({
        customer: coBuyer,
        ofac: cbOfac,
        lastUpdate: cbOfac.lastUpdate,
        subjectLabel: "CO-BUYER SUBJECT SCREENED",
        screenedAt: currentResults.timestamp,
      })
    );
  }

  if (repeatOffender && selected.has(REPORT_KEYS.buyerRepeat)) {
    sections.push(getRepeatReportPageHTML(currentResults, false));
  }

  if (cbRepeat && coBuyer && selected.has(REPORT_KEYS.coBuyerRepeat)) {
    sections.push(getRepeatReportPageHTML(currentResults, true));
  }

  if (title && selected.has(REPORT_KEYS.title)) {
    sections.push(getTitleReportPageHTML(currentResults));
  }

  return numberPrintedPages(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Compliance Central — All Reports</title>
  <style>${reportDocumentCSS()}
  </style>
</head>
<body>
  ${sections.join("")}
</body>
</html>`);
}

// ---------- Public print functions ----------

export async function printOfacReport(currentResults) {
  if (!currentResults?.checks?.ofac) {
    showToast("No OFAC results available.", "info");
    return;
  }

  // Resolve lastUpdate without awaiting when already present — keeps the click
  // path snappy. Iframe print does not need a retained user gesture.
  const ofac = currentResults.checks.ofac;
  let lastUpdate = ofac.lastUpdate;
  if (!lastUpdate) {
    try {
      const status = await chrome.runtime.sendMessage({ type: "getDataStatus" });
      if (status?.success && status.lastUpdate) {
        lastUpdate = new Date(status.lastUpdate).toLocaleDateString();
      }
    } catch {
      lastUpdate = "Unknown";
    }
  } else {
    try {
      const parsed = new Date(lastUpdate);
      if (!Number.isNaN(parsed.getTime())) {
        lastUpdate = parsed.toLocaleDateString();
      }
    } catch {
      // leave as-is
    }
  }

  openAndPrint(
    ofacReportHTML({
      customer: currentResults.customer,
      ofac,
      lastUpdate,
    })
  );
}

export async function printCoBuyerOfacReport(currentResults) {
  const cbOfac = currentResults?.checks?.coBuyerOfac;
  const coBuyer = currentResults?.customer?.coBuyer;
  if (!cbOfac || !coBuyer) {
    showToast("No Co-Buyer OFAC results available.", "info");
    return;
  }

  let lastUpdate = cbOfac.lastUpdate;
  if (!lastUpdate) {
    try {
      const status = await chrome.runtime.sendMessage({ type: "getDataStatus" });
      if (status?.success && status.lastUpdate) {
        lastUpdate = new Date(status.lastUpdate).toLocaleDateString();
      }
    } catch {
      lastUpdate = "Unknown";
    }
  } else {
    try {
      const parsed = new Date(lastUpdate);
      if (!Number.isNaN(parsed.getTime())) {
        lastUpdate = parsed.toLocaleDateString();
      }
    } catch {
      // leave as-is
    }
  }

  openAndPrint(
    ofacReportHTML({
      customer: coBuyer,
      ofac: cbOfac,
      lastUpdate,
      subjectLabel: "CO-BUYER SUBJECT SCREENED",
    })
  );
}

export function printRepeatScreenshot(currentResults) {
  if (!currentResults?.checks?.repeatOffender) {
    showToast("No Repeat Offender results available.", "info");
    return;
  }
  openAndPrint(repeatReportHTML(currentResults, false));
}

export function printCoBuyerRepeatScreenshot(currentResults) {
  if (!currentResults?.checks?.coBuyerRepeatOffender || !currentResults?.customer?.coBuyer) {
    showToast("No Co-Buyer Repeat Offender results available.", "info");
    return;
  }
  openAndPrint(repeatReportHTML(currentResults, true));
}

export function printTitleScreenshot(currentResults) {
  if (!currentResults?.checks?.title) {
    showToast("No Title/Lien results available.", "info");
    return;
  }
  openAndPrint(titleReportHTML(currentResults));
}

export async function printAllReports(currentResults, selectedKeys) {
  if (!currentResults) {
    showToast("No results to print.", "info");
    return;
  }
  await openReportsPdfForPrint(currentResults, selectedKeys);
}


// ---------- PDF download (jsPDF) ----------
//
// Goal: produce PDFs that visually mirror the print-window HTML reports — same
// official letterhead, same colour palette, same certification footer. All
// drawn programmatically in jsPDF so we avoid html2canvas/html2pdf bloat.

async function loadJsPDF() {
  if (window.jspdf?.jsPDF) {
    registerPdfFonts(window.jspdf.jsPDF);
    return window.jspdf.jsPDF;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("lib/jspdf.umd.min.js");
    script.onload = () => {
      if (window.jspdf?.jsPDF) {
        registerPdfFonts(window.jspdf.jsPDF);
        resolve(window.jspdf.jsPDF);
      } else reject(new Error("jsPDF did not load"));
    };
    script.onerror = () => reject(new Error("Failed to load jsPDF script"));
    document.head.appendChild(script);
  });
}

// The PDF draws from the same ten colours as the print HTML, so a report
// downloaded as a PDF and the same report sent to the printer are one
// document rendered twice rather than two documents that resemble each other.
//
// Every `*Bg` is paper: a status is carried by its rule and its verdict word,
// never by a block of colour a laser printer has to lay down.
const PALETTE = {
  navy: printRgb(PRINT_COLORS.navy),
  gold: printRgb(PRINT_COLORS.gold),
  slate: printRgb(PRINT_COLORS.slate),
  border: printRgb(PRINT_COLORS.line),
  paper: printRgb(PRINT_COLORS.paper),
  cardBg: printRgb(PRINT_COLORS.paper),
  yellowBg: printRgb(PRINT_COLORS.paper),
  yellowBorder: printRgb(PRINT_COLORS.gold),
  successBg: printRgb(PRINT_COLORS.paper),
  successBorder: printRgb(PRINT_COLORS.ok),
  successText: printRgb(PRINT_COLORS.ok),
  dangerBg: printRgb(PRINT_COLORS.paper),
  dangerBorder: printRgb(PRINT_COLORS.alert),
  dangerText: printRgb(PRINT_COLORS.alert),
  warnBg: printRgb(PRINT_COLORS.paper),
  warnBorder: printRgb(PRINT_COLORS.gold),
  warnText: printRgb(PRINT_COLORS.navy),
  neutralBg: printRgb(PRINT_COLORS.paper),
  neutralBorder: printRgb(PRINT_COLORS.slate),
  neutralText: printRgb(PRINT_COLORS.navy),
  body: printRgb(PRINT_COLORS.slate),
  ink: printRgb(PRINT_COLORS.ink),
  alert: printRgb(PRINT_COLORS.alert),
};

// Page geometry, type scale, rule weights and spacing all come from the same
// object the print stylesheet is generated from, so the downloaded PDF and the
// printed sheet cannot drift into two different documents again.
const { type: TYPE, leading: LEADING } = PRINT_METRICS;
const SPACE = PRINT_METRICS;
const RULE = {
  hair: PRINT_METRICS.rule,
  accent: PRINT_METRICS.ruleAccent,
  heavy: PRINT_METRICS.ruleHeavy,
};
const RADIUS = PRINT_METRICS.radius;
/** One line of prose at a given size, matching the stylesheet's leading. */
const lineHeightFor = (size) => size * LEADING.body;

async function createPdfContext(orientation = "portrait") {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: "pt", format: "letter", orientation, putOnlyUsedFonts: true });
  return {
    doc,
    pageWidth: doc.internal.pageSize.getWidth(),
    pageHeight: doc.internal.pageSize.getHeight(),
    // The one @page margin every printed sheet uses, so a downloaded PDF and
    // a printed one stack in the same file with the same edges.
    margin: PRINT_METRICS.margin,
    y: PRINT_METRICS.margin,
    // Page numbers can only be written once the document is complete; each
    // footer records where its own number belongs.
    page: 1,
    pageNumberSlots: {},
  };
}

// Adds a page with an explicit orientation and resyncs the cached page size.
// All current reports are portrait; this keeps page sizing correct if a
// section ever opts into a different orientation.
function addPageWithOrientation(ctx, orientation = "portrait") {
  ctx.doc.addPage("letter", orientation);
  ctx.pageWidth = ctx.doc.internal.pageSize.getWidth();
  ctx.pageHeight = ctx.doc.internal.pageSize.getHeight();
  ctx.y = ctx.margin;
  ctx.page = (ctx.page || 1) + 1;
}

function setFill(doc, rgb) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setDraw(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }
function setText(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

function ensureSpace(ctx, needed) {
  if (ctx.y + needed > ctx.pageHeight - ctx.margin) {
    ctx.doc.addPage();
    ctx.y = ctx.margin;
    ctx.page = (ctx.page || 1) + 1;
  }
}

function writeText(ctx, text, opts = {}) {
  const {
    fontSize = TYPE.body,
    bold = false,
    italic: _italic = false, // accepted for callers; no italic cut ships
    color = PALETTE.ink,
    align = "left",
    lineHeight = LEADING.body,
    maxWidth,
  } = opts;
  const { doc, pageWidth, margin } = ctx;
  doc.setFontSize(fontSize);
  // The printed HTML reserves Bricolage Grotesque for the masthead and the
  // verdict word; the same threshold applies here, so a downloaded page is set
  // in the same two faces as the printed one. Archivo ships upright only, so
  // italic falls back to the regular.
  doc.setFont(
    bold && fontSize >= TYPE.verdict ? PDF_FACE.display : PDF_FACE.body,
    bold ? "bold" : "normal"
  );
  setText(doc, color);

  const width = maxWidth || pageWidth - margin * 2;
  const lines = doc.splitTextToSize(String(text), width);
  for (const line of lines) {
    ensureSpace(ctx, fontSize * lineHeight);
    const x =
      align === "center"
        ? pageWidth / 2
        : align === "right"
        ? pageWidth - margin
        : margin;
    doc.text(line, x, ctx.y + fontSize, { align });
    ctx.y += fontSize * lineHeight;
  }
}

/** The running head's centre cell, identical on every printed sheet. */
const RUNNING_HEAD = "COMPLIANCE CENTRAL — ALL REPORTS";

/**
 * A `label value` pair drawn the way `.page-header strong` reads on paper: the
 * label bold in ink, the value beside it in slate.
 *
 * Each half is measured in the face it is drawn in. Measuring the label in the
 * regular weight after drawing it bold used to place the value on top of the
 * colon, so the OFAC header read "Report Generated9/2/2026".
 */
function metaLabelWidth(doc, label) {
  doc.setFont(PDF_FACE.body, "bold");
  return doc.getTextWidth(`${label}:`) + TYPE.caption * 0.35;
}

/**
 * Wrap a running-head value the way inline text wraps: the first line shares
 * the row with its label, and any continuation takes the whole cell. Wrapping
 * every line to the short measure pushed a timestamp onto three lines.
 */
function metaLines(doc, label, value, width) {
  const labelWidth = metaLabelWidth(doc, label);
  doc.setFont(PDF_FACE.body, "normal");
  const [first = "", ...rest] = doc.splitTextToSize(
    String(value ?? "—"),
    Math.max(24, width - labelWidth)
  );
  return [first, ...doc.splitTextToSize(rest.join(" "), width)].filter(
    (line) => line !== ""
  );
}

function drawLabelledMeta(doc, { label, value, x, y, align = "left", width, lineHeight }) {
  const lines = metaLines(doc, label, value, width);

  const labelWidth = metaLabelWidth(doc, label);
  lines.forEach((line, n) => {
    const lineY = y + n * lineHeight;
    const lineWidth = doc.getTextWidth(line);
    const valueX = align === "right" ? x - lineWidth : x + labelWidth;
    if (n === 0) {
      doc.setFont(PDF_FACE.body, "bold");
      setText(doc, PALETTE.ink);
      doc.text(`${label}:`, align === "right" ? valueX - labelWidth : x, lineY);
      doc.setFont(PDF_FACE.body, "normal");
    }
    setText(doc, PALETTE.slate);
    doc.text(line, valueX, lineY);
  });
  return lines.length;
}

/**
 * The running head: who / what / when in the same three cells on every sheet,
 * closed by a hairline. Mirrors `.page-header` — equal sides around a centred
 * document name, so a stack of these can be flipped through from one spot.
 *
 * The centre cell takes the width it needs and the two sides share what is
 * left, wrapping inside it, so a long timestamp can never run into the
 * document name the way it would at a fixed position.
 */
function drawPageHeader(ctx, { left = [], right = [] } = {}) {
  const { doc, pageWidth, margin } = ctx;
  const lineHeight = TYPE.caption * 1.35;

  doc.setFontSize(TYPE.caption);
  doc.setFont(PDF_FACE.body, "bold");
  const centreWidth =
    doc.getTextWidth(RUNNING_HEAD) + RUNNING_HEAD.length * TYPE.caption * 0.06;
  const sideWidth = Math.max(
    72,
    (pageWidth - margin * 2 - centreWidth) / 2 - SPACE.s3
  );

  // Lay the sides out first: how tall the strip is depends on what wrapped.
  const measure = (items) => {
    doc.setFontSize(TYPE.caption);
    return items.reduce((rows, item) => {
      doc.setFont(PDF_FACE.body, "bold");
      const labelWidth = doc.getTextWidth(`${item.label}:`) + TYPE.caption * 0.35;
      doc.setFont(PDF_FACE.body, "normal");
      return (
        rows +
        doc.splitTextToSize(String(item.value ?? "—"), Math.max(24, sideWidth - labelWidth))
          .length
      );
    }, 0);
  };
  const rows = Math.max(measure(left), measure(right), 1);
  const height = rows * lineHeight + SPACE.s2;
  ensureSpace(ctx, height + SPACE.s4);

  const firstBaseline = ctx.y + TYPE.caption;
  let row = 0;
  for (const item of left) {
    row += drawLabelledMeta(doc, {
      ...item,
      x: margin,
      y: firstBaseline + row * lineHeight,
      width: sideWidth,
      lineHeight,
    });
  }
  row = 0;
  for (const item of right) {
    row += drawLabelledMeta(doc, {
      ...item,
      x: pageWidth - margin,
      y: firstBaseline + row * lineHeight,
      align: "right",
      width: sideWidth,
      lineHeight,
    });
  }

  doc.setFont(PDF_FACE.body, "bold");
  doc.setFontSize(TYPE.caption);
  setText(doc, PALETTE.navy);
  doc.text(RUNNING_HEAD, pageWidth / 2, firstBaseline, {
    align: "center",
    charSpace: TYPE.caption * 0.06,
  });

  const ruleY = ctx.y + height;
  setDraw(doc, PALETTE.border);
  doc.setLineWidth(RULE.hair);
  doc.line(margin, ruleY, pageWidth - margin, ruleY);
  ctx.y = ruleY + SPACE.s4;
}

/**
 * The one place a printed page shouts: the not-a-government-document notice.
 * Mirrors `.app-notice` — alert red, uppercase, tracked, above the masthead
 * rather than inside a frame, so the record can never pass for letterhead.
 */
function drawAppNotice(ctx, text) {
  const { doc, margin } = ctx;
  ensureSpace(ctx, lineHeightFor(TYPE.caption) + SPACE.s3);
  doc.setFont(PDF_FACE.body, "bold");
  doc.setFontSize(TYPE.caption);
  setText(doc, PALETTE.alert);
  doc.text(String(text), margin, ctx.y + TYPE.caption, {
    charSpace: TYPE.caption * 0.09,
  });
  ctx.y += lineHeightFor(TYPE.caption) + SPACE.s3;
}

/**
 * The shared masthead: document title in the display face, a heavy navy rule,
 * and the single gold hairline flush beneath it. Identical in geometry to
 * `.main-title` in the print stylesheet, down to the rule weights.
 */
function drawMasthead(ctx, title) {
  const { doc, pageWidth, margin } = ctx;
  const right = pageWidth - margin;
  const titleHeight = TYPE.masthead * LEADING.display;
  ensureSpace(ctx, titleHeight + SPACE.s2 + RULE.heavy + RULE.accent + SPACE.s4);

  doc.setFont(PDF_FACE.display, "bold");
  doc.setFontSize(TYPE.masthead);
  setText(doc, PALETTE.navy);
  doc.text(String(title), margin, ctx.y + TYPE.masthead);

  // The rule is stroked on its centre line, so half of it sits below `ruleY`;
  // the gold accent starts there, leaving no paper gap between the two.
  const ruleY = ctx.y + titleHeight + SPACE.s2 + RULE.heavy / 2;
  setDraw(doc, PALETTE.navy);
  doc.setLineWidth(RULE.heavy);
  doc.line(margin, ruleY, right, ruleY);
  setFill(doc, PALETTE.gold);
  doc.rect(margin, ruleY + RULE.heavy / 2, right - margin, RULE.accent, "F");

  ctx.y = ruleY + RULE.heavy / 2 + RULE.accent + SPACE.s4;
}

/** `.doc-sub`: what this record is, in slate, directly under the masthead. */
function drawDocSubtitle(ctx, lines) {
  const { doc, pageWidth, margin } = ctx;
  doc.setFont(PDF_FACE.body, "normal");
  doc.setFontSize(TYPE.body);
  setText(doc, PALETTE.slate);
  for (const text of lines.filter(Boolean)) {
    for (const line of doc.splitTextToSize(String(text), pageWidth - margin * 2)) {
      ensureSpace(ctx, lineHeightFor(TYPE.body));
      doc.text(line, margin, ctx.y + TYPE.body);
      ctx.y += lineHeightFor(TYPE.body);
    }
  }
  ctx.y += SPACE.s3;
}

/**
 * The OFAC record header: running head, the non-government notice, the
 * masthead, and the two lines saying what was screened against what.
 */
function drawOfacRecordHeader(ctx, opts = {}) {
  const {
    eyebrow = "APP-GENERATED RECORD · NOT ISSUED OR ENDORSED BY THE U.S. TREASURY OR OFAC",
    title = "Compliance Central OFAC Screening Record",
    subtitle = [
      "Screening against the U.S. Treasury OFAC SDN list",
      "User-requested automated name comparison; potential matches require human review.",
    ],
    meta = [],
  } = opts;

  drawPageHeader(ctx, {
    left: meta.filter((item) => item.side !== "right"),
    right: meta.filter((item) => item.side === "right"),
  });
  drawAppNotice(ctx, eyebrow);
  drawMasthead(ctx, title);
  drawDocSubtitle(ctx, subtitle);
}

/**
 * Header for the non-OFAC reports (decision summary, Repeat Offender, Title &
 * Lien): the same running head and masthead the HTML pages wear, in the same
 * order — `.page-header`, then `.main-title`.
 */
function drawCheckHeader(ctx, opts) {
  const { title, meta = [], metaRight = [] } = opts;
  drawPageHeader(ctx, {
    left: meta.filter((item) => item && item.value),
    right: metaRight.filter((item) => item && item.value),
  });
  drawMasthead(ctx, title);
}

/**
 * The subject panel, mirroring `.subject` in the print stylesheet: a hairline
 * card, a navy section heading, then label/value rows separated by hairlines.
 * The label is the lighter element and the value carries the weight — the
 * download used to have that the wrong way round, so the two renderings of one
 * record emphasised different things.
 */
function drawSubjectBox(ctx, opts) {
  const { title = "SUBJECT SCREENED", rows = [] } = opts;
  const { doc, pageWidth, margin } = ctx;

  const padding = SPACE.s4;
  const innerWidth = pageWidth - margin * 2 - padding * 2;
  const labelWidth = innerWidth * 0.3;
  const rowLineHeight = lineHeightFor(TYPE.body);
  const valueWidth = innerWidth - labelWidth;
  doc.setFont(PDF_FACE.body, "bold");
  doc.setFontSize(TYPE.body);
  const preparedRows = rows.map((row) => {
    const value = String(row.value ?? "").trim() || "—";
    const lines = doc.splitTextToSize(value, valueWidth);
    return {
      ...row,
      lines: lines.length > 0 ? lines : ["—"],
      height: lines.length * rowLineHeight + SPACE.s2 * 2,
    };
  });
  const headerHeight = TYPE.body * LEADING.display + SPACE.s2;
  const rowsHeight = preparedRows.reduce((sum, row) => sum + row.height, 0);
  const totalH = padding * 2 + headerHeight + rowsHeight;
  ensureSpace(ctx, totalH + SPACE.s3);

  setFill(doc, PALETTE.cardBg);
  setDraw(doc, PALETTE.border);
  doc.setLineWidth(RULE.hair);
  doc.roundedRect(margin, ctx.y, pageWidth - margin * 2, totalH, RADIUS, RADIUS, "FD");

  doc.setFont(PDF_FACE.body, "bold");
  doc.setFontSize(TYPE.body);
  setText(doc, PALETTE.navy);
  doc.text(title, margin + padding, ctx.y + padding + TYPE.body, {
    charSpace: TYPE.body * 0.09,
  });

  let rowTop = ctx.y + padding + headerHeight;
  for (const row of preparedRows) {
    const baseline = rowTop + SPACE.s2 + TYPE.body;
    doc.setFont(PDF_FACE.body, "normal");
    doc.setFontSize(TYPE.body);
    setText(doc, PALETTE.slate);
    doc.text(`${row.label}:`, margin + padding, baseline);

    doc.setFont(PDF_FACE.body, "bold");
    setText(doc, PALETTE.ink);
    let valueY = baseline;
    for (const line of row.lines) {
      // A reference is read one glyph at a time. The PDF has no monospaced
      // cut, so the tracking stands in for what `.ref` does in the HTML.
      doc.text(line, margin + padding + labelWidth, valueY, {
        charSpace: row.reference ? 0.5 : 0,
      });
      valueY += rowLineHeight;
    }

    rowTop += row.height;
    if (row !== preparedRows.at(-1)) {
      setDraw(doc, PALETTE.border);
      doc.setLineWidth(RULE.hair);
      doc.line(margin + padding, rowTop, pageWidth - margin - padding, rowTop);
    }
  }

  ctx.y += totalH + SPACE.s4;
}

function drawResultBox(ctx, opts) {
  const { variant = "pass", title, subtitle, extraLines = [] } = opts;
  const { doc, pageWidth, margin } = ctx;

  const palettes = {
    pass: {
      bg: PALETTE.successBg,
      border: PALETTE.successBorder,
      text: PALETTE.successText,
    },
    fail: {
      bg: PALETTE.dangerBg,
      border: PALETTE.dangerBorder,
      text: PALETTE.dangerText,
    },
    warn: {
      bg: PALETTE.warnBg,
      border: PALETTE.warnBorder,
      text: PALETTE.warnText,
    },
    neutral: {
      bg: PALETTE.neutralBg,
      border: PALETTE.neutralBorder,
      text: PALETTE.neutralText,
    },
  };
  const palette = palettes[variant] || palettes.warn;

  // Mirrors `.result` in the print stylesheet: paper ground, a status bar
  // down the left edge in the one heavy rule weight, the verdict word set in
  // the display face at the verdict size, and every sentence below it in ink.
  // A page-wide tint of colour buys nothing on paper except toner.
  const padding = SPACE.s4;
  const barWidth = RULE.heavy;
  const textLeft = margin + barWidth + padding;
  const innerWidth = pageWidth - margin * 2 - barWidth - padding * 2;
  doc.setFont(PDF_FACE.display, "bold");
  doc.setFontSize(TYPE.verdict);
  const titleLines = doc.splitTextToSize(String(title || "RESULT"), innerWidth);
  doc.setFont(PDF_FACE.body, "normal");
  doc.setFontSize(TYPE.body);
  const subtitleLines = subtitle
    ? doc.splitTextToSize(String(subtitle), innerWidth)
    : [];
  const preparedExtraLines = extraLines.flatMap((line) =>
    doc.splitTextToSize(String(line), innerWidth)
  );
  const titleLineHeight = TYPE.verdict * LEADING.display;
  const bodyLineHeight = lineHeightFor(TYPE.body);
  const titleH = titleLines.length * titleLineHeight;
  const subH = subtitleLines.length
    ? SPACE.s1 + subtitleLines.length * bodyLineHeight
    : 0;
  // The match list is separated from the verdict by one hairline, exactly as
  // `.matches` is in the HTML.
  const extraH = preparedExtraLines.length
    ? SPACE.s3 * 2 + preparedExtraLines.length * bodyLineHeight
    : 0;
  const totalH = padding * 2 + titleH + subH + extraH;
  ensureSpace(ctx, totalH + SPACE.s3);

  setFill(doc, palette.bg);
  setDraw(doc, PALETTE.border);
  doc.setLineWidth(RULE.hair);
  doc.roundedRect(margin, ctx.y, pageWidth - margin * 2, totalH, RADIUS, RADIUS, "FD");
  setFill(doc, palette.border);
  doc.rect(margin, ctx.y, barWidth, totalH, "F");

  doc.setFont(PDF_FACE.display, "bold");
  doc.setFontSize(TYPE.verdict);
  setText(doc, palette.text);
  let textY = ctx.y + padding + TYPE.verdict;
  for (const line of titleLines) {
    doc.text(line, textLeft, textY);
    textY += titleLineHeight;
  }

  if (subtitleLines.length) {
    doc.setFont(PDF_FACE.body, "normal");
    doc.setFontSize(TYPE.body);
    setText(doc, PALETTE.ink);
    textY += SPACE.s1;
    for (const line of subtitleLines) {
      doc.text(line, textLeft, textY);
      textY += bodyLineHeight;
    }
  }

  if (preparedExtraLines.length) {
    const ruleY = textY - TYPE.body + SPACE.s3;
    setDraw(doc, PALETTE.border);
    doc.setLineWidth(RULE.hair);
    doc.line(textLeft, ruleY, pageWidth - margin - padding, ruleY);
    doc.setFont(PDF_FACE.body, "normal");
    doc.setFontSize(TYPE.body);
    setText(doc, PALETTE.ink);
    textY += SPACE.s3 * 2;
    for (const line of preparedExtraLines) {
      doc.text(line, textLeft, textY);
      textY += bodyLineHeight;
    }
  }

  ctx.y += totalH + SPACE.s4;
}

/**
 * The certification paragraph, mirroring `.certification`: a slate bar, no
 * heading, and the bold lead-in running into the sentence. Gold is rationed to
 * the masthead accent and to a result that still needs a human, so a standing
 * disclaimer must not wear it.
 */
function drawScreeningRecord(ctx, text, leadIn = "Screening record:") {
  const { doc, pageWidth, margin } = ctx;
  const padding = SPACE.s4;
  const barWidth = RULE.heavy;
  const lineHeight = lineHeightFor(TYPE.body);
  const textLeft = margin + barWidth + padding;
  const innerWidth = pageWidth - margin * 2 - barWidth - padding * 2;
  doc.setFontSize(TYPE.body);
  doc.setFont(PDF_FACE.body, "bold");
  const leadWidth = doc.getTextWidth(`${leadIn} `);
  doc.setFont(PDF_FACE.body, "normal");
  // The first line starts after the bold lead-in, so it is measured short.
  const [firstLine = "", ...restText] = doc.splitTextToSize(
    String(text),
    innerWidth - leadWidth
  );
  const lines = [
    firstLine,
    ...doc.splitTextToSize(restText.join(" "), innerWidth),
  ].filter((line) => line !== "");
  const totalH = padding * 2 + lines.length * lineHeight;
  ensureSpace(ctx, totalH + SPACE.s3);

  setFill(doc, PALETTE.cardBg);
  setDraw(doc, PALETTE.border);
  doc.setLineWidth(RULE.hair);
  doc.roundedRect(margin, ctx.y, pageWidth - margin * 2, totalH, RADIUS, RADIUS, "FD");
  setFill(doc, PALETTE.neutralBorder);
  doc.rect(margin, ctx.y, barWidth, totalH, "F");

  let ly = ctx.y + padding + TYPE.body;
  setText(doc, PALETTE.ink);
  lines.forEach((line, index) => {
    if (index === 0) {
      doc.setFont(PDF_FACE.body, "bold");
      doc.text(leadIn, textLeft, ly);
      doc.setFont(PDF_FACE.body, "normal");
      doc.text(line, textLeft + leadWidth, ly);
    } else {
      doc.text(line, textLeft, ly);
    }
    ly += lineHeight;
  });

  ctx.y += totalH + SPACE.s4;
}

/**
 * A bordered notice card with a coloured left rule — `.evidence-unavailable`
 * and `.incomplete-checks` in the print stylesheet. The download used to set
 * these as bare running text, so the one thing on the page that qualifies the
 * result read as an afterthought.
 */
function drawNoticeCard(ctx, { lead, body, accent = PALETTE.yellowBorder }) {
  const { doc, pageWidth, margin } = ctx;
  const padding = SPACE.s4;
  const barWidth = RULE.heavy;
  const lineHeight = lineHeightFor(TYPE.body);
  const textLeft = margin + barWidth + padding;
  const innerWidth = pageWidth - margin * 2 - barWidth - padding * 2;

  doc.setFontSize(TYPE.body);
  doc.setFont(PDF_FACE.body, "bold");
  const leadLines = doc.splitTextToSize(String(lead), innerWidth);
  doc.setFont(PDF_FACE.body, "normal");
  const bodyLines = body ? doc.splitTextToSize(String(body), innerWidth) : [];
  const totalH = padding * 2 + (leadLines.length + bodyLines.length) * lineHeight;
  ensureSpace(ctx, totalH + SPACE.s3);

  setFill(doc, PALETTE.cardBg);
  setDraw(doc, PALETTE.border);
  doc.setLineWidth(RULE.hair);
  doc.roundedRect(margin, ctx.y, pageWidth - margin * 2, totalH, RADIUS, RADIUS, "FD");
  setFill(doc, accent);
  doc.rect(margin, ctx.y, barWidth, totalH, "F");

  let ly = ctx.y + padding + TYPE.body;
  doc.setFont(PDF_FACE.body, "bold");
  setText(doc, PALETTE.ink);
  for (const line of leadLines) {
    doc.text(line, textLeft, ly);
    ly += lineHeight;
  }
  doc.setFont(PDF_FACE.body, "normal");
  for (const line of bodyLines) {
    doc.text(line, textLeft, ly);
    ly += lineHeight;
  }

  ctx.y += totalH + SPACE.s4;
}

/**
 * The page footer, pinned to the bottom of the sheet exactly as
 * `.portal-footer` is: a hairline, centred caption lines, and a reserved last
 * line for the page number, which is stamped once the document is complete.
 */
function drawFooter(ctx, lines) {
  const { doc, pageWidth, pageHeight, margin } = ctx;
  const lineHeight = lineHeightFor(TYPE.caption);
  // One extra line for "Page N of M", which closes the footer on every sheet.
  const height = SPACE.s3 + (lines.length + 1) * lineHeight;
  const ruleY = pageHeight - margin - height;
  setDraw(doc, PALETTE.border);
  doc.setLineWidth(RULE.hair);
  doc.line(margin, ruleY, pageWidth - margin, ruleY);

  doc.setFont(PDF_FACE.body, "normal");
  doc.setFontSize(TYPE.caption);
  setText(doc, PALETTE.slate);
  let ly = ruleY + SPACE.s3 + TYPE.caption;
  for (const line of lines) {
    doc.text(line, pageWidth / 2, ly, { align: "center" });
    ly += lineHeight;
  }
  if (ctx.pageNumberSlots) ctx.pageNumberSlots[ctx.page || 1] = ly;
}

/**
 * Write "Page N of M" into every footer once the page count is known. Called
 * after the last section so the totals are final.
 */
function stampPageNumbers(ctx) {
  const { doc, pageWidth, pageHeight, margin } = ctx;
  const total = doc.getNumberOfPages?.() ?? ctx.page ?? 1;
  const slots = ctx.pageNumberSlots || {};
  const fallbackY = pageHeight - margin - lineHeightFor(TYPE.caption) + TYPE.caption;
  for (let page = 1; page <= total; page++) {
    doc.setPage?.(page);
    doc.setFont(PDF_FACE.body, "normal");
    doc.setFontSize(TYPE.caption);
    setText(doc, PALETTE.slate);
    doc.text(`Page ${page} of ${total}`, pageWidth / 2, slots[page] ?? fallbackY, {
      align: "center",
      charSpace: TYPE.caption * 0.06,
    });
  }
  doc.setPage?.(total);
}

function drawScreenshotPage(ctx, dataUrl, opts = {}) {
  if (!dataUrl) return;
  const { doc, pageWidth, pageHeight, margin } = ctx;
  const imageMargin = Number.isFinite(opts.margin) ? opts.margin : margin;
  const usableW = pageWidth - imageMargin * 2;
  // A footer is one hairline, its lines, and the page number that closes it.
  const footerHeight = SPACE.s3 + 2 * lineHeightFor(TYPE.caption);
  const bottom = Number.isFinite(opts.bottom)
    ? opts.bottom
    : pageHeight - margin - (opts.reserveFooter ? footerHeight : 0);
  const maxH = bottom - ctx.y;

  try {
    const imgProps = doc.getImageProperties(dataUrl);
    const ratio = imgProps.height / imgProps.width;
    let renderW = usableW;
    let renderH = renderW * ratio;
    if (renderH > maxH) {
      renderH = maxH;
      renderW = renderH / ratio;
    }
    const formatByExtension = {
      jpg: "JPEG",
      png: "PNG",
      webp: "WEBP",
    };
    const format = formatByExtension[imageDataUrlExtension(dataUrl)] || "PNG";
    setDraw(doc, PALETTE.border);
    doc.setLineWidth(0.5);
    const x = imageMargin + (usableW - renderW) / 2;
    doc.addImage(
      dataUrl,
      format,
      x,
      ctx.y,
      renderW,
      renderH,
      opts.alias,
      "FAST"
    );
    doc.rect(x, ctx.y, renderW, renderH);
    ctx.y += renderH + 10;
  } catch (err) {
    console.error("PDF image error:", err);
    writeText(ctx, "Screenshot could not be embedded.", {
      fontSize: 9,
      color: PALETTE.alert,
    });
  }
}

// ---------- Shared assembly helpers ----------

async function getSdnLastUpdate(ofac) {
  const lastUpdate = ofac?.lastUpdate;
  if (lastUpdate) {
    try {
      const d = new Date(lastUpdate);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
    } catch {
      // fallthrough
    }
    return lastUpdate;
  }
  try {
    const status = await chrome.runtime.sendMessage({ type: "getDataStatus" });
    if (status?.success && status.lastUpdate) {
      return new Date(status.lastUpdate).toLocaleDateString();
    }
  } catch {
    // ignore
  }
  return "Unknown";
}

function safeFileName(parts) {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function safeFilePart(parts, fallback = "Record") {
  return safeFileName(parts) || fallback;
}

/** Stable user-visible names for the two bulk download formats. */
export function combinedPdfFileName(currentResults, timestamp = Date.now()) {
  const customer = currentResults?.customer || {};
  return `Compliance_${safeFilePart([
    customer.firstName,
    customer.lastName,
  ])}_${timestamp}.pdf`;
}

export function separatePdfsZipFileName(currentResults, timestamp = Date.now()) {
  const customer = currentResults?.customer || {};
  return `Compliance_PDFs_${safeFilePart([
    customer.firstName,
    customer.lastName,
  ])}_${timestamp}.zip`;
}

function nowStamp() {
  return new Date().toLocaleString();
}

// The footers say exactly what the printed sheets say. The download used to
// promise the SDN list was "auto-refreshed daily" while the printed page said
// "every 24 hours" — one document cannot describe its own source two ways.
const STANDARD_FOOTER = [
  "Data Source: Official U.S. Treasury OFAC SDN List · auto-refreshed every 24 hours.",
  "Generated by Compliance Central — Michigan Dealer Compliance Hub.",
];

/** Only a page that really carries the capture may claim to be one. */
const MDOS_CAPTURE_FOOTER = [
  "Actual page captured from https://dsvsesvc.sos.state.mi.us/ · Framed by Compliance Central.",
];

/** The app-generated summary that stands in when no capture was returned. */
const MDOS_SUMMARY_FOOTER = [
  "Generated by Compliance Central · Michigan Dealer Compliance Hub",
];

// ---------- OFAC PDF section ----------

async function drawOfacSection(ctx, customer, ofac, opts = {}) {
  const lastUpdate = await getSdnLastUpdate(ofac);
  const outcome = ofacResultArgs(ofac);
  const entries = ofac.entriesSearched
    ? ofac.entriesSearched.toLocaleString()
    : "N/A";
  const shownMatches = ofac.matches || [];
  const totalMatches = Math.max(Number(ofac.matchCount) || 0, shownMatches.length);
  const omittedMatches = Math.max(0, totalMatches - shownMatches.length);

  drawOfacRecordHeader(ctx, {
    meta: [
      { label: "Screening Date", value: reportDate(ofac.timestamp) },
      { label: "Entries Searched", value: entries },
      { label: "Report Generated", value: nowStamp(), side: "right" },
      { label: "Database Updated", value: lastUpdate, side: "right" },
    ],
  });

  const rows = [
    { label: "Full Name", value: subjectFullName(customer) },
    { label: "Date of Birth", value: customer.dob },
    { label: "Driver License / PID", value: customer.dlnPid, reference: true },
  ];
  if (customer.tradeVin) {
    rows.push({ label: "Trade-In VIN", value: customer.tradeVin, reference: true });
  }
  drawSubjectBox(ctx, {
    title: opts.subjectLabel || "SUBJECT SCREENED",
    rows,
  });

  drawResultBox(ctx, {
    variant: outcome.variant,
    title: outcome.title,
    subtitle: outcome.subtitle,
    extraLines:
      ["potential_match", "confirmed_match"].includes(outcome.state) && shownMatches.length
        ? [
            ...shownMatches
              .slice(0, 5)
              .map((m) => {
                const conf = m.confidence
                  ? `   ·   ${OFAC_CONF_LABEL[m.confidence] || ""}`
                  : "";
                const dob = m.sdnBirthDate ? `   ·   SDN DOB ${m.sdnBirthDate}` : "";
                return `${m.name} — Score ${m.score}%${conf}${dob}   ·   Type ${m.type}`;
              }),
            ...(omittedMatches > 0
              ? [
                  `…and ${omittedMatches} additional potential match(es) were not shown in this summary.`,
                ]
              : []),
          ]
        : [],
  });

  if (ofac.stale) {
    drawNoticeCard(ctx, {
      lead: "Data Freshness Notice:",
      body: `This screening used cached SDN data last updated ${lastUpdate}${
        ofac.dataAgeHours != null ? ` (about ${ofac.dataAgeHours} hours ago)` : ""
      }. A live update was unavailable at screening time — re-run this check when back online to screen against the current OFAC SDN list.`,
      accent: PALETTE.dangerBorder,
    });
  }

  drawScreeningRecord(
    ctx,
    "This report records an automated name search against the U.S. Treasury OFAC SDN list using Compliance Central's configured similarity threshold. It is not an OFAC determination, legal advice, or a compliance certification. Potential matches require human review; no-match results do not by themselves establish that a party is legally cleared."
  );

  drawFooter(ctx, STANDARD_FOOTER);
}

function subjectFullName(customer) {
  if (!customer) return "—";
  // jsPDF draws plain text (no HTML context), so use the raw name directly —
  // round-tripping through HTML entities mangled names containing & < > etc.
  const parts = [
    customer.firstName,
    customer.middleName,
    customer.lastName,
    customer.suffix,
  ]
    .map((p) => (p || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

// ---------- MDOS screenshot sections (Repeat Offender, Title) ----------

// One self-contained page: header + subject + result box + (screenshot if the
// portal returned one, else an honest note) + footer. The screenshot scales to
// the remaining space (drawScreenshotPage), so each check stays on ONE page.
function drawMdosResultSection(ctx, opts) {
  const { title, meta = [], metaRight = [], subject, result, screenshot } = opts;
  drawCheckHeader(ctx, { title, meta, metaRight });
  // The same standing notice the printed page leads with, so neither rendering
  // can be mistaken for a state webpage.
  drawNoticeCard(ctx, {
    lead: "Compliance Central summary",
    body: `App-generated overview of the ${title} response. It is not a state webpage.`,
    accent: PALETTE.neutralBorder,
  });
  if (subject) drawSubjectBox(ctx, subject);
  if (result) drawResultBox(ctx, result);

  const safeShot = screenshot ? ensureDataUrl(screenshot) : null;
  if (safeShot) {
    writeText(ctx, "ACTUAL MICHIGAN STATE-SITE SCREENSHOT", {
      fontSize: TYPE.caption,
      bold: true,
      color: PALETTE.slate,
    });
    writeText(ctx, "Captured from https://dsvsesvc.sos.state.mi.us/", {
      fontSize: TYPE.caption,
      color: PALETTE.slate,
    });
    ctx.y += SPACE.s1;
    drawScreenshotPage(ctx, safeShot, { reserveFooter: true });
    drawFooter(ctx, MDOS_CAPTURE_FOOTER);
    return;
  }

  drawNoticeCard(ctx, {
    lead: "ACTUAL MICHIGAN STATE-SITE SCREENSHOT UNAVAILABLE",
    body: "The result above is an app-generated summary, not a Michigan Department of State webpage or document. Re-run the check before relying on it when state-site evidence is required.",
  });
  // This page carries no capture, so it must not close with a footer claiming
  // one was captured — the download used to contradict its own notice.
  drawFooter(ctx, MDOS_SUMMARY_FOOTER);
}

// Renders an MDOS/SOS check as the ACTUAL captured portal page: a slim
// provenance header (who / what / when), then the real screenshot filling the
// page, then a source footer. This is the digital equivalent of opening the
// portal and printing it — we do NOT rebuild the result with our own boxes.
// (Reconstruction is reserved for OFAC, which has no portal page to capture.)
function drawPortalCapture(ctx, opts) {
  const { title, metaLine, screenshot, footerLines = MDOS_CAPTURE_FOOTER } = opts;
  const { doc, pageWidth, pageHeight, margin } = ctx;
  // The capture is someone else's page, so it is given more of the sheet than
  // the text margin allows — the same relationship `.state-evidence img` has
  // to its own sheet, where it may run the full content width.
  const evidenceMargin = 26;
  const right = pageWidth - evidenceMargin;
  ctx.y = 24;

  // The same masthead every other sheet wears: title in the display face, the
  // heavy navy rule, and the one gold hairline flush beneath it.
  doc.setFont(PDF_FACE.display, "bold");
  doc.setFontSize(TYPE.masthead);
  setText(doc, PALETTE.navy);
  doc.text(`${title} — State-Site Capture`, evidenceMargin, ctx.y + TYPE.masthead);

  doc.setFont(PDF_FACE.body, "normal");
  doc.setFontSize(TYPE.caption);
  setText(doc, PALETTE.slate);
  doc.text(
    "ACTUAL MICHIGAN STATE-SITE CAPTURE · ONE-PAGE RECORD",
    right,
    ctx.y + TYPE.masthead,
    { align: "right" }
  );
  ctx.y += TYPE.masthead * LEADING.display;

  if (metaLine) {
    const lines = doc.splitTextToSize(
      String(metaLine),
      pageWidth - evidenceMargin * 2
    );
    for (const line of lines.slice(0, 2)) {
      doc.text(line, evidenceMargin, ctx.y + TYPE.caption);
      ctx.y += lineHeightFor(TYPE.caption);
    }
  }

  const ruleY = ctx.y + SPACE.s2 + RULE.heavy / 2;
  setDraw(doc, PALETTE.navy);
  doc.setLineWidth(RULE.heavy);
  doc.line(evidenceMargin, ruleY, right, ruleY);
  setFill(doc, PALETTE.gold);
  doc.rect(evidenceMargin, ruleY + RULE.heavy / 2, right - evidenceMargin, RULE.accent, "F");
  ctx.y = ruleY + RULE.heavy / 2 + RULE.accent + SPACE.s4;

  // Leave the footer band clear, so the capture and its provenance line never
  // overlap — the same room `.page` reserves with its bottom padding.
  const footerHeight = SPACE.s3 + (footerLines.length + 1) * lineHeightFor(TYPE.caption);
  drawScreenshotPage(ctx, screenshot, {
    margin: evidenceMargin,
    bottom: pageHeight - margin - footerHeight - SPACE.s3,
    alias: `mdos-${String(title).replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
  });

  // A quiet provenance footer keeps the record honest without making it look
  // like an app-designed substitute for the state webpage.
  drawFooter(ctx, footerLines);
}

/** A combined-report section that renders the actual Repeat Offender portal
 * capture when a screenshot exists, else a labeled summary. */
export function repeatSection(ro, person, title, subjectLabel) {
  const screenshot = stateEvidenceDataUrl(ro);
  const verifiedScreenshot = verifiedRepeatEvidence(ro) ? screenshot : null;
  if (verifiedScreenshot) {
    return {
      orientation: "portrait",
      render: (ctx) =>
        drawPortalCapture(ctx, {
          title,
          metaLine: `Customer: ${subjectFullName(person)}   ·   DLN/PID: ${person?.dlnPid || "—"}   ·   Captured: ${reportDate(ro?.timestamp)}`,
          screenshot: verifiedScreenshot,
        }),
    };
  }
  return {
    orientation: "portrait",
    render: (ctx) =>
      drawMdosResultSection(ctx, {
        title,
        meta: [{ label: "Screened", value: reportDate(ro?.timestamp) }],
        metaRight: [
          { label: "Customer", value: subjectFullName(person) },
          { label: "Report generated", value: nowStamp() },
        ],
        subject: {
          title: subjectLabel,
          rows: [
            { label: "Full Name", value: subjectFullName(person) },
            { label: "Date of Birth", value: person?.dob },
            { label: "Driver License / PID", value: person?.dlnPid, reference: true },
          ],
        },
        result: repeatOffenderResultArgs(ro),
        screenshot: verifiedScreenshot,
      }),
  };
}

/** A combined-report section that renders the actual Title & Lien portal
 * capture when a screenshot exists, else a labeled summary. */
export function titleSection(t, customer) {
  const vin = customer?.tradeVin || "N/A";
  const vehicle = [t?.year, t?.make, t?.model].filter(Boolean).join(" ");
  const screenshot = stateEvidenceDataUrl(t);
  const verifiedScreenshot = verifiedTitleEvidence(t) ? screenshot : null;
  if (verifiedScreenshot) {
    return {
      orientation: "portrait",
      render: (ctx) =>
        drawPortalCapture(ctx, {
          title: "Michigan Title & Lien Check",
          metaLine: `VIN: ${vin}${vehicle ? "   ·   " + vehicle : ""}   ·   Captured: ${reportDate(t?.timestamp)}`,
          screenshot: verifiedScreenshot,
        }),
    };
  }
  return {
    orientation: "portrait",
    render: (ctx) =>
      drawMdosResultSection(ctx, {
        title: "Michigan Title & Lien Check",
        meta: [{ label: "Screened", value: reportDate(t?.timestamp) }],
        metaRight: [
          { label: "VIN", value: vin },
          { label: "Report generated", value: nowStamp() },
        ],
        subject: { title: "TRADE-IN VEHICLE", rows: titleSubjectRows(t, vin) },
        result: titleResultArgs(t),
        screenshot: verifiedScreenshot,
      }),
  };
}

/** Result-box args for a Repeat Offender check (eligible/ineligible). */
export function repeatOffenderResultArgs(ro) {
  const classification = classifyRepeatOffenderResult(ro);
  if (classification.state === "not_applicable") {
    return {
      variant: "neutral",
      title: "NOT APPLICABLE",
      subtitle: "Michigan Repeat Offender screening applies only to Michigan licenses and state IDs.",
    };
  }
  if (classification.state === "unavailable") {
    return {
      variant: "warn",
      title: "RESULT UNAVAILABLE",
      subtitle: ro?.error || ro?.message || "The state-site check could not be completed.",
    };
  }
  if (classification.state === "missing") {
    return {
      variant: "neutral",
      title: "NOT RUN",
      subtitle: "The Michigan Repeat Offender check has not been completed.",
    };
  }
  if (classification.state === "review") {
    return {
      variant: "warn",
      title: "REVIEW REQUIRED",
      subtitle:
        ro?.message ||
        ro?.rawText ||
        "The state-site response was unrecognized or contradictory and was not confirmed eligible.",
    };
  }
  return {
    variant: classification.state === "eligible" ? "pass" : "fail",
    title: classification.state === "eligible" ? "ELIGIBLE" : "NOT ELIGIBLE",
    subtitle: classification.state === "eligible"
      ? "No repeat-offender or ex parte records found — eligible to purchase."
      : ro?.message ||
        ro?.rawText ||
        "Repeat-offender or ex parte record found — review before proceeding.",
  };
}

/** Result-box args for a Title/Lien check (clear / branded / lien). */
export function titleResultArgs(t) {
  const presentation = titlePresentation(t);
  return {
    variant: presentation.statusKey === "pass" ? "pass" : "warn",
    title: presentation.title,
    subtitle: presentation.subtitle,
  };
}

/** Subject rows for a title PDF from the check details. */
function titleSubjectRows(t, vin) {
  const rows = [{ label: "VIN", value: vin, reference: true }];
  const vehicle = [t?.year, t?.make, t?.model].filter(Boolean).join(" ");
  if (vehicle) rows.push({ label: "Vehicle", value: vehicle });
  if (t?.titleStatus) rows.push({ label: "Title Status", value: t.titleStatus });
  const ttype = formatTitleType(t?.titleType);
  if (ttype) rows.push({ label: "Title Type", value: ttype });
  if (t?.titleIssued) rows.push({ label: "Title Issued", value: t.titleIssued });
  rows.push({
    label: "Lien",
    value: formatLienStatus(t?.lienStatus, t?.hasLien),
  });
  const holder = cleanLienHolder(t?.lienHolder);
  if (t?.hasLien && holder) rows.push({ label: "Lienholder", value: holder });
  return rows;
}

/**
 * A section heading, mirroring `h2` in the print stylesheet: body size, bold,
 * navy, uppercase and tracked, with space above and below doing the work a
 * size jump would otherwise do. It keeps with the block it introduces.
 */
function drawSectionHeading(ctx, text) {
  const { doc, margin } = ctx;
  ensureSpace(ctx, SPACE.s5 + lineHeightFor(TYPE.body) + SPACE.s2 + SPACE.s5);
  ctx.y += SPACE.s5;
  doc.setFont(PDF_FACE.body, "bold");
  doc.setFontSize(TYPE.body);
  setText(doc, PALETTE.navy);
  doc.text(String(text), margin, ctx.y + TYPE.body, {
    charSpace: TYPE.body * 0.09,
  });
  ctx.y += lineHeightFor(TYPE.body) + SPACE.s2;
}

/**
 * The check-summary table, mirroring `.check-summary`: column heads in caption
 * slate over a heavy navy rule, then rows closed by hairlines. The download
 * used to set the same information as a flowing list, so the one page a
 * manager actually reads had no columns to scan down.
 */
function drawSummaryTable(ctx, { columns, rows }) {
  const { doc, pageWidth, margin } = ctx;
  const width = pageWidth - margin * 2;
  const widths = [width * 0.29, width * 0.22, width * 0.49];
  const x = [margin, margin + widths[0], margin + widths[0] + widths[1]];
  const lineHeight = lineHeightFor(TYPE.body);

  ensureSpace(ctx, lineHeightFor(TYPE.caption) + SPACE.s2 + RULE.heavy + lineHeight * 2);
  doc.setFont(PDF_FACE.body, "bold");
  doc.setFontSize(TYPE.caption);
  setText(doc, PALETTE.slate);
  columns.forEach((label, i) =>
    doc.text(label, x[i], ctx.y + TYPE.caption, { charSpace: TYPE.caption * 0.09 })
  );
  ctx.y += lineHeightFor(TYPE.caption) + SPACE.s2;
  setDraw(doc, PALETTE.navy);
  doc.setLineWidth(RULE.heavy);
  doc.line(margin, ctx.y, pageWidth - margin, ctx.y);
  ctx.y += RULE.heavy / 2;

  doc.setFontSize(TYPE.body);
  for (const row of rows) {
    const cells = [
      { text: row.label, font: "bold", color: PALETTE.ink, width: widths[0] },
      { text: row.state, font: "bold", color: row.incomplete ? PALETTE.alert : PALETTE.ink, width: widths[1] },
      { text: row.detail, font: "normal", color: PALETTE.slate, width: widths[2] },
    ].map((cell) => {
      doc.setFont(PDF_FACE.body, cell.font);
      return { ...cell, lines: doc.splitTextToSize(String(cell.text), cell.width - SPACE.s3) };
    });
    const height = Math.max(...cells.map((cell) => cell.lines.length)) * lineHeight + SPACE.s2 * 2;
    ensureSpace(ctx, height);

    cells.forEach((cell, i) => {
      doc.setFont(PDF_FACE.body, cell.font);
      setText(doc, cell.color);
      cell.lines.forEach((line, n) =>
        doc.text(line, x[i], ctx.y + SPACE.s2 + TYPE.body + n * lineHeight)
      );
    });
    ctx.y += height;
    setDraw(doc, PALETTE.border);
    doc.setLineWidth(RULE.hair);
    doc.line(margin, ctx.y, pageWidth - margin, ctx.y);
  }
  ctx.y += SPACE.s2;
}

/** First page of a combined PDF: final decision plus every expected check. */
export function finalDecisionSection(currentResults) {
  const summary = reportDecisionSummary(currentResults);
  const decisionVariant =
    summary.decision.level === "APPROVED"
      ? "pass"
      : summary.decision.level === "DENIED"
        ? "fail"
        : "warn";
  const customer = currentResults?.customer || {};

  return {
    orientation: "portrait",
    render: (ctx) => {
      drawCheckHeader(ctx, {
        title: "Overall Compliance Decision",
        meta: [{ label: "Screened", value: reportDate(currentResults?.timestamp) }],
        metaRight: [
          { label: "Customer", value: subjectFullName(customer) },
          { label: "Report generated", value: nowStamp() },
        ],
      });
      drawResultBox(ctx, {
        variant: decisionVariant,
        title:
          summary.decision.level === "REVIEW"
            ? "REVIEW REQUIRED"
            : summary.decision.level,
        subtitle: summary.decision.reason,
      });

      drawSectionHeading(ctx, "CHECK SUMMARY");
      drawSummaryTable(ctx, {
        columns: ["CHECK", "OUTCOME", "MEANING"],
        rows: summary.rows,
      });

      drawSectionHeading(ctx, "INCOMPLETE CHECKS");
      if (summary.incomplete.length > 0) {
        drawNoticeCard(ctx, {
          lead: "The following checks must be re-run or resolved before relying on this report:",
          body: summary.incomplete
            .map((row) => `${row.label}: ${row.state} — ${row.detail}`)
            .join("  "),
        });
      } else {
        drawNoticeCard(ctx, {
          lead: "None. Every required check returned a recognized result.",
          accent: PALETTE.successBorder,
        });
      }
      drawFooter(ctx, [
        "Generated by Compliance Central · Review source evidence before completing a transaction.",
      ]);
    },
  };
}

// ---------- Public downloaders ----------

/** Download the actual captured SOS result page as one readable letter page. */
export async function downloadSosOfficialEvidencePDF(quote) {
  const image = ensureDataUrl(quote?.officialPageImage);
  if (!image) {
    showToast("The official SOS page capture is unavailable. Calculate again.", "info");
    return false;
  }
  let ctx;
  try {
    // The capture is a full state web page, which is taller than it is wide, so
    // portrait matches both the source and every other report this app prints.
    ctx = await createPdfContext("portrait");
  } catch (err) {
    console.error("jsPDF load error:", err);
    showToast("Could not load the PDF library. Try Print SOS instead.", "error");
    return false;
  }

  const { doc, pageWidth, pageHeight } = ctx;
  const margin = 24;
  doc.setTextColor(...PALETTE.navy);
  doc.setFont(PDF_FACE.body, "bold");
  doc.setFontSize(14);
  doc.text("Michigan SOS Registration Fee Calculation", margin, 28);
  doc.setFont(PDF_FACE.body, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PALETTE.slate);
  doc.text(
    "Actual official state-site result page captured during the calculation",
    margin,
    39
  );
  doc.setDrawColor(...PALETTE.navy);
  doc.setLineWidth(2);
  doc.line(margin, 46, pageWidth - margin, 46);

  const props = doc.getImageProperties(image);
  const availableWidth = pageWidth - margin * 2;
  const availableHeight = pageHeight - 78;
  const ratio = Math.min(
    availableWidth / props.width,
    availableHeight / props.height
  );
  const width = props.width * ratio;
  const height = props.height * ratio;
  const x = (pageWidth - width) / 2;
  const y = 52 + (availableHeight - height) / 2;
  doc.addImage(image, imageDataUrlExtension(image), x, y, width, height);

  doc.setFontSize(7);
  doc.setTextColor(...PALETTE.slate);
  doc.text("Source: dsvsesvc.sos.state.mi.us", margin, pageHeight - 10);
  doc.text(
    "Verify before final paperwork",
    pageWidth - margin,
    pageHeight - 10,
    { align: "right" }
  );
  doc.save(`Michigan_SOS_Fee_Calculation_${Date.now()}.pdf`);
  return true;
}

export async function downloadOfacReportPDF(currentResults) {
  if (!currentResults?.checks?.ofac) {
    showToast("No OFAC results to download.", "info");
    return;
  }
  let ctx;
  try {
    ctx = await createPdfContext();
  } catch (err) {
    console.error("jsPDF load error:", err);
    showToast("Could not load PDF library. Try the Print button instead.", "error");
    return;
  }
  await drawOfacSection(ctx, currentResults.customer, currentResults.checks.ofac);
  stampPageNumbers(ctx);
  ctx.doc.save(
    `OFAC_${safeFileName([
      currentResults.customer?.firstName,
      currentResults.customer?.lastName,
    ])}_${Date.now()}.pdf`
  );
}

export async function downloadCoBuyerOfacReportPDF(currentResults) {
  const cbOfac = currentResults?.checks?.coBuyerOfac;
  const coBuyer = currentResults?.customer?.coBuyer;
  if (!cbOfac || !coBuyer) {
    showToast("No Co-Buyer OFAC results to download.", "info");
    return;
  }
  let ctx;
  try {
    ctx = await createPdfContext();
  } catch (err) {
    console.error("jsPDF load error:", err);
    showToast("Could not load PDF library. Try the Print button instead.", "error");
    return;
  }
  await drawOfacSection(ctx, coBuyer, cbOfac, {
    subjectLabel: "CO-BUYER SUBJECT SCREENED",
  });
  stampPageNumbers(ctx);
  ctx.doc.save(
    `OFAC_CoBuyer_${safeFileName([
      coBuyer.firstName,
      coBuyer.lastName,
    ])}_${Date.now()}.pdf`
  );
}

export async function downloadRepeatOffenderPDF(currentResults) {
  const ro = currentResults?.checks?.repeatOffender;
  if (!ro || ro.error || ro.status === "error" || ro.status === "not_applicable") {
    showToast("No completed Repeat Offender result to download.", "info");
    return;
  }
  const c = currentResults.customer;
  const fileName = `RepeatOffender_${safeFileName([c?.firstName, c?.lastName])}_${Date.now()}.pdf`;
  const section = repeatSection(ro, c, "Michigan Repeat Offender Check", "SUBJECT SCREENED");

  let ctx;
  try {
    ctx = await createPdfContext(section.orientation);
  } catch (err) {
    console.error("jsPDF load error:", err);
    showToast("Could not load PDF library. Try the Print button instead.", "error");
    return;
  }
  await section.render(ctx);
  stampPageNumbers(ctx);
  ctx.doc.save(fileName);
}

export async function downloadCoBuyerRepeatOffenderPDF(currentResults) {
  const ro = currentResults?.checks?.coBuyerRepeatOffender;
  const co = currentResults?.customer?.coBuyer;
  if (!co || !ro || ro.error || ro.status === "error" || ro.status === "not_applicable") {
    showToast("No completed Co-Buyer Repeat Offender result to download.", "info");
    return;
  }
  const fileName = `RepeatOffender_CoBuyer_${safeFileName([co.firstName, co.lastName])}_${Date.now()}.pdf`;
  const section = repeatSection(
    ro,
    co,
    "Michigan Repeat Offender Check (Co-Buyer)",
    "CO-BUYER SCREENED"
  );

  let ctx;
  try {
    ctx = await createPdfContext(section.orientation);
  } catch (err) {
    console.error("jsPDF load error:", err);
    showToast("Could not load PDF library. Try the Print button instead.", "error");
    return;
  }
  await section.render(ctx);
  stampPageNumbers(ctx);
  ctx.doc.save(fileName);
}

export async function downloadTitleReportPDF(currentResults) {
  const title = currentResults?.checks?.title;
  if (!title || title.error) {
    showToast("No completed Title/Lien result to download.", "info");
    return;
  }
  const vin = currentResults.customer?.tradeVin || "N/A";
  const fileName = `Title_${safeFileName([vin])}_${Date.now()}.pdf`;
  const section = titleSection(title, currentResults.customer);

  let ctx;
  try {
    ctx = await createPdfContext(section.orientation);
  } catch (err) {
    console.error("jsPDF load error:", err);
    showToast("Could not load PDF library. Try the Print button instead.", "error");
    return;
  }
  await section.render(ctx);
  stampPageNumbers(ctx);
  ctx.doc.save(fileName);
}

/**
 * One ordered manifest drives combined download, separate downloads, and print.
 * Keeping the section object intact also guarantees each action uses the same
 * jsPDF renderer and therefore the same letter-size geometry.
 */
export function reportPdfEntries(
  currentResults,
  selectedKeys,
  timestamp = Date.now()
) {
  const customer = currentResults?.customer || {};
  const checks = currentResults?.checks || {};
  const coBuyer = customer.coBuyer;
  const buyerName = safeFilePart([customer.firstName, customer.lastName]);
  const coBuyerName = safeFilePart([coBuyer?.firstName, coBuyer?.lastName]);
  const factories = {
    [REPORT_KEYS.decision]: () => ({
      fileName: `Compliance_Decision_${buyerName}_${timestamp}.pdf`,
      section: finalDecisionSection(currentResults),
    }),
    [REPORT_KEYS.buyerOfac]: () => ({
      fileName: `OFAC_${buyerName}_${timestamp}.pdf`,
      section: {
        orientation: "portrait",
        render: (ctx) => drawOfacSection(ctx, customer, checks.ofac),
      },
    }),
    [REPORT_KEYS.buyerRepeat]: () => ({
      fileName: `RepeatOffender_${buyerName}_${timestamp}.pdf`,
      section: repeatSection(
        checks.repeatOffender,
        customer,
        "Michigan Repeat Offender Check",
        "SUBJECT SCREENED"
      ),
    }),
    [REPORT_KEYS.title]: () => ({
      fileName: `Title_${safeFilePart([customer.tradeVin || "N-A"])}_${timestamp}.pdf`,
      section: titleSection(checks.title, customer),
    }),
    [REPORT_KEYS.coBuyerOfac]: () => ({
      fileName: `OFAC_CoBuyer_${coBuyerName}_${timestamp}.pdf`,
      section: {
        orientation: "portrait",
        render: (ctx) =>
          drawOfacSection(ctx, coBuyer, checks.coBuyerOfac, {
            subjectLabel: "CO-BUYER SUBJECT SCREENED",
          }),
      },
    }),
    [REPORT_KEYS.coBuyerRepeat]: () => ({
      fileName: `RepeatOffender_CoBuyer_${coBuyerName}_${timestamp}.pdf`,
      section: repeatSection(
        checks.coBuyerRepeatOffender,
        coBuyer,
        "Michigan Repeat Offender Check (Co-Buyer)",
        "CO-BUYER SCREENED"
      ),
    }),
  };

  return normalizeReportSelection(currentResults, selectedKeys).map((key) => {
    const entry = factories[key]();
    return { key, label: REPORT_LABELS[key], ...entry };
  });
}

export function combinedPdfSections(currentResults, selectedKeys) {
  return reportPdfEntries(currentResults, selectedKeys).map(
    (entry) => entry.section
  );
}

async function renderPdfSections(sections) {
  const ctx = await createPdfContext(sections[0].orientation);
  for (let i = 0; i < sections.length; i++) {
    if (i > 0) addPageWithOrientation(ctx, sections[i].orientation);
    await sections[i].render(ctx);
  }
  // "Page N of M" can only be written once the document knows how long it is.
  stampPageNumbers(ctx);
  return ctx;
}

let zipCrcTable;

function crc32(bytes) {
  if (!zipCrcTable) {
    zipCrcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let value = i;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      zipCrcTable[i] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = zipCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipTimestamp(value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime())
    ? value
    : new Date();
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
  };
}

/** Build a standards-compatible, uncompressed ZIP without another dependency. */
export function buildStoredZipArchive(files, modifiedAt = new Date()) {
  const encoder = new TextEncoder();
  const timestamp = zipTimestamp(modifiedAt);
  let localSize = 0;
  let centralSize = 0;
  const entries = files.map((file) => {
    const name = encoder.encode(String(file.name));
    const data = file.data instanceof Uint8Array
      ? file.data
      : new Uint8Array(file.data);
    const entry = {
      name,
      data,
      crc: crc32(data),
      localOffset: localSize,
    };
    localSize += 30 + name.length + data.length;
    centralSize += 46 + name.length;
    return entry;
  });

  const archive = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(archive.buffer);
  let offset = 0;
  const u16 = (value) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };

  for (const entry of entries) {
    u32(0x04034b50);
    u16(20);
    u16(0x0800);
    u16(0);
    u16(timestamp.time);
    u16(timestamp.date);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0);
    archive.set(entry.name, offset);
    offset += entry.name.length;
    archive.set(entry.data, offset);
    offset += entry.data.length;
  }

  const centralOffset = offset;
  for (const entry of entries) {
    u32(0x02014b50);
    u16(20);
    u16(20);
    u16(0x0800);
    u16(0);
    u16(timestamp.time);
    u16(timestamp.date);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(entry.localOffset);
    archive.set(entry.name, offset);
    offset += entry.name.length;
  }

  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(offset - centralOffset);
  u32(centralOffset);
  u16(0);
  return archive;
}

function downloadBlob(blob, fileName) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 40 * 1000);
}

async function openReportsPdfForPrint(currentResults, selectedKeys) {
  const entries = reportPdfEntries(currentResults, selectedKeys);
  if (!entries.length) {
    showToast("Select at least one document to print.", "info");
    return;
  }

  // Reserve the tab synchronously while the click gesture is still active.
  let printWindow;
  try {
    printWindow = window.open("", "_blank");
  } catch {
    printWindow = null;
  }
  if (!printWindow) {
    showToast("Could not open print preview. Allow pop-ups and try again.", "warning");
    return;
  }

  try {
    printWindow.document.title = "Preparing Compliance Central print preview";
    printWindow.document.body.textContent = "Preparing the selected PDF documents…";
    const ctx = await renderPdfSections(entries.map((entry) => entry.section));
    // jsPDF's OpenAction makes Chrome's PDF viewer open the print dialog. Even
    // if a viewer ignores it, the exact generated PDF remains open for ⌘P/Ctrl+P.
    ctx.doc.autoPrint?.({ variant: "non-conform" });
    const blobUrl = URL.createObjectURL(ctx.doc.output("blob"));
    printWindow.location.replace(blobUrl);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
  } catch (err) {
    console.error("PDF print error:", err);
    try {
      printWindow.close();
    } catch {
      // ignore
    }
    showToast("Could not prepare the PDF print preview.", "error");
  }
}

/**
 * Combined "Download PDF" — every check that ran, stitched into one PDF
 * with the same official styling as the per-check downloads.
 */
export async function downloadAllReportsPDF(currentResults, selectedKeys) {
  if (!currentResults) {
    showToast("No results to download.", "info");
    return;
  }

  // Build the section list. OFAC renders its official letterhead; the MDOS/SOS
  // checks render the actual portal capture (the page the dealer would print).
  // All pages are portrait.
  const sections = combinedPdfSections(currentResults, selectedKeys);

  if (!sections.length) {
    showToast("Select at least one document to download.", "info");
    return;
  }

  let ctx;
  try {
    ctx = await renderPdfSections(sections);
  } catch (err) {
    console.error("jsPDF load error:", err);
    showToast("Could not load PDF library. Try the Print button instead.", "error");
    return;
  }

  ctx.doc.save(combinedPdfFileName(currentResults));
}

/** Download each selected document as its own PDF file. */
export async function downloadAllReportPDFs(currentResults, selectedKeys) {
  if (!currentResults) {
    showToast("No results to download.", "info");
    return;
  }
  const timestamp = Date.now();
  const entries = reportPdfEntries(currentResults, selectedKeys, timestamp);
  if (!entries.length) {
    showToast("Select at least one document to download.", "info");
    return;
  }

  try {
    if (entries.length === 1) {
      const ctx = await renderPdfSections([entries[0].section]);
      ctx.doc.save(entries[0].fileName);
      return;
    }
    const files = [];
    for (const entry of entries) {
      const ctx = await renderPdfSections([entry.section]);
      files.push({
        name: entry.fileName,
        data: new Uint8Array(ctx.doc.output("arraybuffer")),
      });
    }
    const archive = buildStoredZipArchive(files);
    const archiveName = separatePdfsZipFileName(currentResults, timestamp);
    downloadBlob(new Blob([archive], { type: "application/zip" }), archiveName);
    showToast(`${entries.length} PDFs downloaded in one ZIP file.`, "success");
  } catch (err) {
    console.error("PDF download error:", err);
    showToast("One or more PDFs could not be downloaded.", "error");
  }
}


export function repeatReportHTML(currentResults, isCoBuyer = false) {
  const c = isCoBuyer ? currentResults.customer?.coBuyer : currentResults.customer;
  if (!c) return "";
  return numberPrintedPages(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Michigan Repeat Offender Check</title>
  <style>${reportDocumentCSS()}
  </style>
</head>
<body>
  ${getRepeatReportPageHTML(currentResults, isCoBuyer)}
</body>
</html>`);
}

export function titleReportHTML(currentResults) {
  const c = currentResults.customer;
  if (!c) return "";
  return numberPrintedPages(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Michigan Title & Lien Check</title>
  <style>${reportDocumentCSS()}
  </style>
</head>
<body>
  ${getTitleReportPageHTML(currentResults)}
</body>
</html>`);
}
