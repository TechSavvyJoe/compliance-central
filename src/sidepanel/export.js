/**
 * Print + PDF download for compliance reports.
 *
 * - Print path: iframe print (side-panel safe), with popup fallback.
 * - PDF download path: uses jsPDF (loaded globally from lib/jspdf.umd.min.js).
 *
 * jsPDF is loaded as a global UMD bundle, so we read it off `window.jspdf` lazily.
 */

import { sanitizeHTML, buildSanitizedName } from "./dom-utils.js";
import { showToast } from "./toast.js";
import {
  formatTitleType,
  cleanLienHolder,
  formatLienStatus,
  titlePresentation,
} from "./title-format.js";
import {
  calculateFinalDecision,
  classifyOfacResult,
  classifyRepeatOffenderResult,
} from "./checks.js";
import { ensureDataUrl } from "../../lib/data-url.js";
import {
  createPrintPayload,
  PRINT_TIMEOUT_MS,
  PRINT_PAYLOAD_TTL_MS,
  createPrintJobId,
  htmlContainsImages,
  schedulePrint,
} from "../../lib/print-html.js";

// DOB-disambiguation confidence labels for the OFAC report (mirrors the card).
const OFAC_CONF_LABEL = {
  high: "DOB match",
  medium: "DOB unknown",
  low: "DOB differs",
};

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

function reportDate(value, fallback = "Not recorded") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

export function stateEvidenceDataUrl(result) {
  return ensureDataUrl(result?.screenshotData);
}

function evidenceImageHTML(result, label) {
  const screenshot = stateEvidenceDataUrl(result);
  if (!screenshot) {
    return `<div class="evidence-unavailable"><strong>Actual Michigan state-site screenshot unavailable.</strong><br>This is an app-generated summary, not a Michigan Department of State webpage or document. Re-run the check before relying on it when state-site evidence is required.</div>`;
  }
  return `<section class="state-evidence">
    <h2>Actual Michigan state-site screenshot</h2>
    <p>Captured directly from <strong>https://dsvsesvc.sos.state.mi.us/</strong> during this check. The image below is the state webpage, not a recreated mockup.</p>
    <img src="${screenshot}" alt="${sanitizeHTML(label)}" />
  </section>`;
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
    showToast("Could not prepare the print document.", "error");
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
      setTimeout(cleanup, PRINT_TIMEOUT_MS);
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
  if (classification.state === "match") {
    return {
      state: classification.state,
      variant: "fail",
      title: "POTENTIAL MATCH",
      subtitle: "REVIEW REQUIRED — Potential name match found",
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
  const timestamp = reportDate(Date.now());
  const screeningDate = reportDate(ofac?.timestamp);
  const outcome = ofacResultArgs(ofac);
  const shownMatches = ofac?.matches || [];
  const totalMatches = Math.max(Number(ofac?.matchCount) || 0, shownMatches.length);
  const omittedMatches = Math.max(0, totalMatches - shownMatches.length);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Compliance Central OFAC Screening Record</title>
  <style>
    @page { margin: 0.5in; }
    body { font-family: Arial, Helvetica, sans-serif; max-width: 800px; margin: 0 auto; padding: 30px; }
    .header { border: 1px solid #cbd5e1; border-left: 6px solid #1e3a5f; padding: 22px; margin-bottom: 25px; background: #f8fafc; }
    .header-title { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 15px; margin-bottom: 15px; }
    .app-notice { color: #7c2d12; margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .header h1 { color: #1e3a5f; margin: 0; font-size: 22px; }
    .header h2 { color: #334155; margin: 8px 0 0; font-size: 15px; }
    .header-subtitle { color: #64748b; font-size: 13px; margin: 8px 0 0; font-style: italic; }
    .header-info { display: flex; justify-content: space-between; font-size: 12px; color: #374151; }
    .result { padding: 30px; margin: 25px 0; border-radius: 8px; text-align: center; }
    .result.pass { background: linear-gradient(to bottom, #d1fae5, #a7f3d0); border: 3px solid #10b981; }
    .result.fail { background: linear-gradient(to bottom, #fee2e2, #fecaca); border: 3px solid #ef4444; }
    .result.warn { background: #fffbeb; border: 3px solid #f59e0b; }
    .result.neutral { background: #f8fafc; border: 3px solid #94a3b8; }
    .result h2 { margin: 0; font-size: 36px; }
    .result.pass h2 { color: #065f46; }
    .result.fail h2 { color: #991b1b; }
    .result.warn h2 { color: #92400e; }
    .result.neutral h2 { color: #334155; }
    .result p { margin: 15px 0 0; font-size: 16px; }
    .subject { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0; }
    .subject h3 { margin: 0 0 15px; color: #1e3a5f; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; }
    .subject table { width: 100%; font-size: 13px; border-collapse: collapse; }
    .subject td { padding: 5px 0; }
    .subject td:first-child { width: 30%; }
    .certification { background: #fefce8; padding: 15px; border-radius: 6px; margin: 25px 0; border: 1px solid #fde047; font-size: 12px; color: #713f12; }
    .footer { color: #64748b; font-size: 10px; text-align: center; margin-top: 30px; border-top: 2px solid #e2e8f0; padding-top: 15px; }
    .matches { margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.7); border-radius: 6px; text-align: left; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <p class="app-notice">App-generated record · Not issued or endorsed by the U.S. Treasury or OFAC</p>
      <h1>Compliance Central OFAC Screening Record</h1>
      <h2>Screening against the U.S. Treasury OFAC SDN list</h2>
      <p class="header-subtitle">User-requested automated name comparison; potential matches require human review.</p>
    </div>
    <div class="header-info">
      <div>
        <p><strong>Report Generated:</strong> ${timestamp}</p>
        <p><strong>Screening Date:</strong> ${screeningDate}</p>
      </div>
      <div style="text-align: right;">
        <p><strong>Database Updated:</strong> ${sanitizeHTML(lastUpdate || "Unknown")}</p>
        <p><strong>Entries Searched:</strong> ${ofac.entriesSearched?.toLocaleString() || "N/A"}</p>
      </div>
    </div>
  </div>
  <div class="subject">
    <h3>${sanitizeHTML(subjectLabel)}</h3>
    <table>
      <tr><td><strong>Full Name:</strong></td><td>${buildSanitizedName(customer)}</td></tr>
      <tr><td><strong>Date of Birth:</strong></td><td>${sanitizeHTML(customer.dob) || "Not Provided"}</td></tr>
      <tr><td><strong>Driver License / PID:</strong></td><td>${sanitizeHTML(customer.dlnPid) || "Not Provided"}</td></tr>
      ${customer.tradeVin ? `<tr><td><strong>Trade-In VIN:</strong></td><td>${sanitizeHTML(customer.tradeVin)}</td></tr>` : ""}
    </table>
  </div>
  <div class="result ${outcome.variant}">
    <h2>${sanitizeHTML(outcome.title)}</h2>
    <p>${sanitizeHTML(outcome.subtitle)}</p>
    ${
      outcome.state === "match" && shownMatches.length > 0
        ? `<div class="matches"><strong>Potential Matches (${totalMatches}):</strong><ul>${shownMatches
            .slice(0, 5)
            .map(
              (m) =>
                `<li>${sanitizeHTML(m.name)} (Score: ${sanitizeHTML(m.score)}%${
                  m.confidence ? `, ${OFAC_CONF_LABEL[m.confidence] || ""}` : ""
                }${
                  m.sdnBirthDate ? `, SDN DOB ${sanitizeHTML(m.sdnBirthDate)}` : ""
                }, Type: ${sanitizeHTML(m.type)})</li>`
            )
            .join("")}</ul>${
            omittedMatches > 0
              ? `<p><em>…and ${omittedMatches} additional potential match(es) were not shown in this summary — review the complete result before proceeding.</em></p>`
              : ""
          }</div>`
        : ""
    }
  </div>
  ${
    ofac.stale
      ? `<div class="certification" style="background:#fef2f2;border-color:#fca5a5;color:#991b1b;"><p><strong>Data Freshness Notice:</strong> This screening used cached SDN data (last updated ${sanitizeHTML(lastUpdate || "Unknown")}). A live update was unavailable at screening time — re-run this check when back online to screen against the current OFAC SDN list.</p></div>`
      : ""
  }
  <div class="certification">
    <p><strong>Screening record:</strong> This report records an automated name search against the U.S. Treasury OFAC SDN list using Compliance Central's configured similarity threshold. It is not an OFAC determination, legal advice, or a compliance certification. Potential matches require human review; no-match results do not by themselves establish that a party is legally cleared.</p>
  </div>
  <div class="footer">
    <p><strong>Data Source:</strong> Official U.S. Treasury OFAC SDN List &middot; auto-refreshed every 24 hours.</p>
    <p>Generated by Compliance Central — Michigan Dealer Compliance Hub.</p>
  </div>
</body>
</html>`;
}

export function getRepeatReportPageHTML(currentResults, isCoBuyer = false) {
  const c = isCoBuyer ? currentResults.customer?.coBuyer : currentResults.customer;
  if (!c) return "";
  const result = isCoBuyer
    ? currentResults.checks?.coBuyerRepeatOffender
    : currentResults.checks?.repeatOffender;
  const outcome = repeatOffenderResultArgs(result);
  const screenedAt = reportDate(result?.timestamp || currentResults.timestamp);
  const generatedAt = reportDate(Date.now());
  const resultClass = outcome.variant === "pass" ? "eligible-card" : "eligible-card result-review";
  const resultIconPath =
    outcome.variant === "pass"
      ? "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
      : "M11 7h2v6h-2zm0 8h2v2h-2zm1-13C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z";

  return `
    <div class="page repeat-page">
      <div class="page-header">
        <div><strong>Screened:</strong> ${sanitizeHTML(screenedAt)}</div>
        <div style="font-weight: 600;">Compliance Central &mdash; All Reports</div>
        <div style="text-align: right;">
          <strong>Customer:</strong> ${buildSanitizedName(c)}<br>
          <strong>Report generated:</strong> ${sanitizeHTML(generatedAt)}
        </div>
      </div>
      <div class="main-title">Michigan Repeat Offender Check</div>
      <hr style="border: none; border-top: 2px solid #1e3a5f; margin-bottom: 20px; margin-top: -8px;">
      
      <div class="summary-notice">
        <strong>Compliance Central summary</strong>
        <span>App-generated overview of the Michigan Repeat Offender response. It is not a state webpage.</span>
      </div>
      
      <div class="content-box">
        <div class="section-title">Subject screened</div>
        <div class="section-subtitle">Customer details used for this check</div>
        
        <div class="form-grid">
          <div class="form-field">
            <div class="form-label">First Name</div>
            <div class="form-value">${sanitizeHTML(c.firstName) || "Not provided"}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Middle Name</div>
            <div class="form-value">${sanitizeHTML(c.middleName) || "Not provided"}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Last Name</div>
            <div class="form-value">${sanitizeHTML(c.lastName) || "Not provided"}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Suffix</div>
            <div class="form-value">${sanitizeHTML(c.suffix) || "Not provided"}</div>
          </div>
        </div>
        
        <div class="section-subtitle" style="margin-top: 20px; margin-bottom: 15px;">Enter the ID Information</div>
        
        <div class="form-grid" style="align-items: end;">
          <div class="form-field" style="grid-column: span 2;">
            <div class="form-label">Date of Birth</div>
            <div class="form-value">${sanitizeHTML(formatDobForMdos(c.dob)) || "Not provided"}</div>
          </div>
          <div class="form-field" style="grid-column: span 2;">
            <div class="form-label">Enter the DLN or PID Number</div>
            <div class="form-value">${sanitizeHTML(formatDlnForMdos(c.dlnPid)) || "Not provided"}</div>
          </div>
        </div>
        
        <div class="results-header">Result returned at ${sanitizeHTML(screenedAt)}</div>
        
        <div class="${resultClass}">
          <svg class="eligible-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${resultIconPath}"/></svg>
          <div class="eligible-text">
            <strong>${sanitizeHTML(outcome.title)}</strong><br>${sanitizeHTML(outcome.subtitle)}
            <div class="eligible-note">This generated summary is not an MDOS-issued document. Use the captured state-site evidence below as the source response.</div>
          </div>
        </div>
      </div>
      ${evidenceImageHTML(result, "Actual Michigan Repeat Offender state-site response")}
      
      <div class="portal-footer">
        Generated by Compliance Central &middot; Michigan Dealer Compliance Hub
      </div>
    </div>
  `;
}

export function getTitleReportPageHTML(currentResults) {
  const c = currentResults.customer;
  if (!c) return "";
  const title = currentResults.checks?.title || {};
  const outcome = titlePresentation(title);
  const screenedAt = reportDate(title.timestamp || currentResults.timestamp);
  const generatedAt = reportDate(Date.now());
  const notReturned = "Not returned";
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
        <div style="font-weight: 600;">Compliance Central &mdash; All Reports</div>
        <div style="text-align: right;">
          <strong>VIN:</strong> ${sanitizeHTML(c.tradeVin) || "Not provided"}<br>
          <strong>Report generated:</strong> ${sanitizeHTML(generatedAt)}
        </div>
      </div>
      <div class="main-title">Michigan Title & Lien Check</div>
      <hr style="border: none; border-top: 2px solid #1e3a5f; margin-bottom: 20px; margin-top: -8px;">
      
      <div class="summary-notice">
        <strong>Compliance Central summary</strong>
        <span>App-generated overview of the Michigan Title &amp; Lien response. It is not a state webpage.</span>
      </div>
      
      <div class="content-box">
        <div class="section-title">Search Results</div>
        
        <div class="vin-search-info">
          Search results for VIN <strong>${sanitizeHTML(c.tradeVin) || "Not provided"}</strong> at <strong>${sanitizeHTML(screenedAt)}</strong>
        </div>

        <div class="eligible-card ${outcome.statusKey === "pass" ? "" : "result-review"}">
          <div class="eligible-text"><strong>${sanitizeHTML(outcome.title)}</strong><br>${sanitizeHTML(outcome.subtitle)}
          <div class="eligible-note">This generated summary is not an MDOS-issued document. Use the captured state-site evidence below as the source response.</div></div>
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
      </div>
      ${evidenceImageHTML(title, "Actual Michigan Title and Lien state-site response")}
      
      <div class="portal-footer">
        Generated by Compliance Central &middot; Michigan Dealer Compliance Hub
      </div>
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
    stale: "REVIEW REQUIRED",
    unavailable: "UNAVAILABLE",
    missing: "NOT RUN",
    review: "REVIEW REQUIRED",
  };
  return reportRow(
    label,
    labels[outcome.state] || "REVIEW REQUIRED",
    outcome.subtitle,
    ["missing", "unavailable", "review", "stale"].includes(outcome.state)
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
  const calculated = calculateFinalDecision(checks);
  const decision =
    incomplete.length > 0 && calculated.level === "APPROVED"
      ? {
          approved: false,
          level: "REVIEW",
          reason:
            "One or more required checks are incomplete - review and re-run them before proceeding",
        }
      : calculated;

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

  return `<div class="page decision-page">
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
    <div class="portal-footer">Generated by Compliance Central &middot; Review source evidence before completing a transaction.</div>
  </div>`;
}

export function combinedAllReportHTML(currentResults) {
  const customer = currentResults.customer || {};
  const timestamp = reportDate(Date.now());
  const ofac = currentResults.checks?.ofac;
  const repeatOffender = currentResults.checks?.repeatOffender;
  const title = currentResults.checks?.title;
  const cbOfac = currentResults.checks?.coBuyerOfac;
  const cbRepeat = currentResults.checks?.coBuyerRepeatOffender;
  const coBuyer = customer.coBuyer;

  const sections = [getFinalDecisionReportPageHTML(currentResults)];

  const ofacBlock = (subjectHTML, ofacResult, label) => {
    const outcome = ofacResultArgs(ofacResult);
    return `
    <div class="page ofac-page">
      <div class="ofac-header">
        <p class="app-record-notice">App-generated record · Not issued or endorsed by the U.S. Treasury or OFAC</p>
        <h1>Compliance Central OFAC Screening Record</h1>
        <h2>Screening against the U.S. Treasury OFAC SDN list</h2>
        <p class="subtitle">User-requested automated name comparison; potential matches require human review.</p>
      </div>
      <div class="ofac-meta">
        <div><strong>Report Generated:</strong> ${sanitizeHTML(timestamp)}<br><strong>Screening Date:</strong> ${sanitizeHTML(reportDate(ofacResult.timestamp || currentResults.timestamp))}</div>
        <div style="text-align: right;"><strong>Database Updated:</strong> ${sanitizeHTML(ofacResult.lastUpdate || "N/A")}<br><strong>Entries Searched:</strong> ${ofacResult.entriesSearched?.toLocaleString() || "N/A"}</div>
      </div>
      <div class="subject-box">
        <h3>${sanitizeHTML(label)}</h3>
        ${subjectHTML}
      </div>
      <div class="result-box ${outcome.variant}">
        <h2>${sanitizeHTML(outcome.title)}</h2>
        <p>${sanitizeHTML(outcome.subtitle)}</p>
      </div>
      <div class="footer">Compliance Central — OFAC Screening Report</div>
    </div>`;
  };

  if (ofac) {
    sections.push(
      ofacBlock(
        `<p><strong>Name:</strong> ${buildSanitizedName(customer)}</p>
         <p><strong>DOB:</strong> ${sanitizeHTML(customer?.dob) || "Not Provided"}</p>
         <p><strong>DLN/PID:</strong> ${sanitizeHTML(customer?.dlnPid) || "Not Provided"}</p>
         ${customer?.tradeVin ? `<p><strong>Trade VIN:</strong> ${sanitizeHTML(customer.tradeVin)}</p>` : ""}`,
        ofac,
        "SUBJECT SCREENED"
      )
    );
  }

  if (cbOfac && coBuyer) {
    sections.push(
      ofacBlock(
        `<p><strong>Name:</strong> ${sanitizeHTML(coBuyer.firstName || "")} ${sanitizeHTML(coBuyer.middleName || "")} ${sanitizeHTML(coBuyer.lastName || "")}${coBuyer.suffix ? " " + sanitizeHTML(coBuyer.suffix) : ""}</p>
         <p><strong>DOB:</strong> ${sanitizeHTML(coBuyer.dob || "Not Provided")}</p>
         <p><strong>DLN/PID:</strong> ${sanitizeHTML(coBuyer.dlnPid || "Not Provided")}</p>`,
        cbOfac,
        "CO-BUYER SUBJECT SCREENED"
      )
    );
  }

  if (repeatOffender) {
    sections.push(getRepeatReportPageHTML(currentResults, false));
  }

  if (cbRepeat && coBuyer) {
    sections.push(getRepeatReportPageHTML(currentResults, true));
  }

  if (title) {
    sections.push(getTitleReportPageHTML(currentResults));
  }

  return `<!DOCTYPE html>
<html>
<head>
  <title>Compliance Central — All Reports</title>
  <style>
    @page { size: portrait; margin: 0.5in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 20px; color: #333; background: #fff; }
    .page { page-break-after: always; min-height: 90vh; position: relative; }
    .page:last-child { page-break-after: auto; }
    .header { border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    .header h2 { color: #1e3a5f; font-size: 18px; margin: 0; }
    .ofac-header { text-align: center; border: 1px solid #cbd5e1; border-left: 6px solid #1e3a5f; background: #f8fafc; padding: 15px; margin-bottom: 20px; }
    .ofac-header .app-record-notice { color: #7c2d12; margin: 0 0 8px; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .ofac-header h1 { font-size: 20px; margin: 0 0 5px; color: #1e3a5f; }
    .ofac-header h2 { font-size: 14px; margin: 0 0 5px; color: #334155; }
    .ofac-header .subtitle { font-size: 12px; color: #666; font-style: italic; }
    .ofac-meta { display: flex; justify-content: space-between; font-size: 10px; color: #555; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
    .subject-box { background: #f8f9fa; border: 1px solid #ddd; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    .subject-box h3 { font-size: 12px; margin: 0 0 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
    .subject-box p { margin: 5px 0; font-size: 14px; }
    .result-box { text-align: center; padding: 20px; border: 2px solid; border-radius: 8px; margin: 30px 0; }
    .result-box.passed { border-color: #28a745; background: #f0fff4; color: #28a745; }
    .result-box.failed { border-color: #dc3545; background: #fff5f5; color: #dc3545; }
    .result-box.pass { border-color: #28a745; background: #f0fff4; color: #166534; }
    .result-box.fail { border-color: #dc3545; background: #fff5f5; color: #991b1b; }
    .result-box.warn { border-color: #f59e0b; background: #fffbeb; color: #92400e; }
    .result-box.neutral { border-color: #94a3b8; background: #f8fafc; color: #334155; }
    .result-box h2 { font-size: 24px; margin: 0 0 10px; }
    .overall-decision { border: 3px solid; border-radius: 8px; padding: 22px; margin: 24px 0; text-align: center; }
    .overall-decision strong { display: block; font-size: 28px; margin-bottom: 8px; }
    .overall-decision span { display: block; font-size: 13px; }
    .decision-approved { border-color: #10b981; background: #ecfdf5; color: #065f46; }
    .decision-denied { border-color: #ef4444; background: #fef2f2; color: #991b1b; }
    .decision-review { border-color: #f59e0b; background: #fffbeb; color: #92400e; }
    .check-summary-title { color: #1e3a5f; font-size: 16px; margin: 24px 0 8px; }
    .check-summary { width: 100%; border-collapse: collapse; font-size: 11px; }
    .check-summary th, .check-summary td { border: 1px solid #cbd5e1; padding: 9px; text-align: left; vertical-align: top; }
    .check-summary thead th { background: #e2e8f0; color: #1e293b; }
    .incomplete-checks, .complete-checks { margin-top: 22px; padding: 14px; border-radius: 6px; }
    .incomplete-checks { border: 1px solid #f59e0b; background: #fffbeb; color: #78350f; }
    .complete-checks { border: 1px solid #86efac; background: #f0fdf4; color: #166534; }
    .incomplete-checks h2, .complete-checks h2 { font-size: 14px; margin-bottom: 6px; }
    .incomplete-checks p, .complete-checks p, .incomplete-checks li { font-size: 11px; line-height: 1.5; }
    .incomplete-checks ul { margin: 8px 0 0 18px; }
    .screenshot-container { text-align: center; margin-top: 20px; }
    .screenshot-container img { max-width: 100%; max-height: 65vh; border: 1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .footer { position: absolute; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; color: #999; border-top: 1px solid #eee; padding-top: 10px; }
    .header-info { font-size: 10px; text-align: right; }
    .header-info p { margin: 2px 0; }

    .page-header { display: flex; justify-content: space-between; font-size: 10px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 15px; }
    .main-title { color: #1e3a5f; font-size: 20px; font-weight: 700; margin-bottom: 15px; font-family: Arial, Helvetica, sans-serif; }
    .summary-notice { padding: 13px 16px; border: 1px solid #cbd5e1; border-left: 4px solid #1e3a5f; border-radius: 6px; background: #f8fafc; margin-bottom: 14px; font-size: 11px; color: #475569; }
    .summary-notice strong { display: block; margin-bottom: 4px; color: #1e3a5f; font-size: 13px; }
    .content-box { border: 1px solid #e5e7eb; padding: 24px; background: #fff; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .section-title { font-size: 16px; font-weight: bold; color: #111827; margin-top: 0; margin-bottom: 4px; }
    .section-subtitle { font-size: 11px; color: #6b7280; margin-bottom: 20px; }
    .form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
    .form-field { display: flex; flex-direction: column; }
    .form-label { font-size: 10px; color: #4b5563; margin-bottom: 4px; font-weight: 600; }
    .form-value { background: #f9fafb; border: 1px solid #d1d5db; padding: 8px 12px; border-radius: 4px; font-size: 13px; font-weight: bold; text-transform: uppercase; height: 18px; line-height: 18px; }
    .results-header { font-size: 12px; font-weight: bold; color: #374151; margin-top: 25px; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    .eligible-card { border: 1px solid #ceead6; background: #e6f4ea; border-radius: 6px; padding: 16px; display: flex; gap: 12px; align-items: flex-start; color: #137333; margin-top: 15px; }
    .eligible-icon { width: 20px; height: 20px; fill: currentColor; flex-shrink: 0; margin-top: 2px; }
    .eligible-text { font-size: 12px; line-height: 1.5; font-weight: 500; }
    .eligible-text strong { font-weight: 700; }
    .eligible-note { font-size: 10px; color: #5f6368; margin-top: 6px; font-weight: normal; }
    .eligible-card.result-review { border-color: #f59e0b; background: #fffbeb; color: #92400e; }
    .state-evidence { margin-top: 22px; padding-top: 12px; break-inside: avoid; break-before: page; page-break-before: always; }
    .state-evidence h2 { color: #1e3a5f; font-size: 15px; margin-bottom: 4px; }
    .state-evidence p { color: #555; font-size: 10px; margin-bottom: 10px; }
    .state-evidence img { display: block; width: 100%; max-height: 78vh; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; }
    .evidence-unavailable { margin-top: 22px; padding: 14px; border: 1px solid #f59e0b; background: #fffbeb; color: #78350f; border-radius: 6px; font-size: 11px; line-height: 1.5; }
    .btn-search { background: #137078; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; text-align: center; }
    .portal-footer { text-align: center; font-size: 10px; color: #6b7280; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 15px; }
    .copyright { font-size: 9px; color: #9ca3af; margin-top: 5px; }
    .vin-search-info { border-left: 3px solid #137078; padding-left: 10px; font-size: 11px; color: #374151; margin-bottom: 20px; font-weight: 500; }
    .vin-search-info strong { color: #111827; }
    .eligible-card { border: 1px solid #ceead6; background: #e6f4ea; border-radius: 6px; padding: 16px; color: #137333; margin: 15px 0 20px; }
    .eligible-card.result-review { border-color: #f59e0b; background: #fffbeb; color: #92400e; }
    .eligible-text { font-size: 12px; line-height: 1.5; font-weight: 500; }
    .eligible-note { font-size: 10px; color: #5f6368; margin-top: 6px; font-weight: normal; }
    .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
    .detail-label { width: 180px; font-weight: 600; color: #4b5563; }
    .detail-value { color: #111827; font-weight: 500; }
    .detail-value.red { color: #b91c1c; font-weight: bold; }
    .brands-section { margin-top: 25px; }
    .brands-title { font-size: 14px; font-weight: bold; color: #111827; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    .brands-text { font-size: 12px; color: #4b5563; margin-bottom: 20px; }
    .btn-start-over { background: #137078; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; display: inline-block; text-align: center; }
    .state-evidence { margin-top: 22px; padding-top: 12px; break-inside: avoid; break-before: page; page-break-before: always; }
    .state-evidence h2 { color: #1e3a5f; font-size: 15px; margin-bottom: 4px; }
    .state-evidence p { color: #555; font-size: 10px; margin-bottom: 10px; }
    .state-evidence img { display: block; width: 100%; max-height: 78vh; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; }
    .evidence-unavailable { margin-top: 22px; padding: 14px; border: 1px solid #f59e0b; background: #fffbeb; color: #78350f; border-radius: 6px; font-size: 11px; line-height: 1.5; }

  </style>
</head>
<body>
  ${sections.join("")}
</body>
</html>`;
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

export function printAllReports(currentResults) {
  if (!currentResults) {
    showToast("No results to print.", "info");
    return;
  }
  openAndPrint(combinedAllReportHTML(currentResults), true);
}


// ---------- PDF download (jsPDF) ----------
//
// Goal: produce PDFs that visually mirror the print-window HTML reports — same
// official letterhead, same colour palette, same certification footer. All
// drawn programmatically in jsPDF so we avoid html2canvas/html2pdf bloat.

async function loadJsPDF() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("lib/jspdf.umd.min.js");
    script.onload = () => {
      if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error("jsPDF did not load"));
    };
    script.onerror = () => reject(new Error("Failed to load jsPDF script"));
    document.head.appendChild(script);
  });
}

// Colour palette mirrors the print HTML reports.
const PALETTE = {
  navy: [30, 58, 95],
  navyDark: [12, 30, 56],
  muted: [100, 116, 139],
  border: [205, 213, 220],
  cardBg: [248, 250, 252],
  yellowBg: [254, 252, 232],
  yellowBorder: [253, 224, 71],
  successBg: [209, 250, 229],
  successBorder: [16, 185, 129],
  successText: [6, 95, 70],
  dangerBg: [254, 226, 226],
  dangerBorder: [239, 68, 68],
  dangerText: [153, 27, 27],
  warnBg: [254, 243, 199],
  warnBorder: [245, 158, 11],
  warnText: [146, 64, 14],
  neutralBg: [248, 250, 252],
  neutralBorder: [148, 163, 184],
  neutralText: [51, 65, 85],
  body: [55, 65, 81],
  ink: [17, 24, 39],
};

async function createPdfContext(orientation = "portrait") {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: "pt", format: "letter", orientation });
  return {
    doc,
    pageWidth: doc.internal.pageSize.getWidth(),
    pageHeight: doc.internal.pageSize.getHeight(),
    margin: 48,
    y: 48,
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
}

function setFill(doc, rgb) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setDraw(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }
function setText(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

function ensureSpace(ctx, needed) {
  if (ctx.y + needed > ctx.pageHeight - ctx.margin) {
    ctx.doc.addPage();
    ctx.y = ctx.margin;
  }
}

function writeText(ctx, text, opts = {}) {
  const {
    fontSize = 10,
    bold = false,
    italic = false,
    color = PALETTE.ink,
    align = "left",
    lineHeight = 1.35,
    maxWidth,
  } = opts;
  const { doc, pageWidth, margin } = ctx;
  doc.setFontSize(fontSize);
  doc.setFont(
    "helvetica",
    bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal"
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

/**
 * Draws an unmistakably app-generated OFAC screening-record header.
 */
function drawOfacRecordHeader(ctx, opts = {}) {
  const {
    eyebrow = "APP-GENERATED · NOT ISSUED OR ENDORSED BY TREASURY / OFAC",
    title = "Compliance Central OFAC Screening Record",
    subtitle = "Screening against the U.S. Treasury OFAC SDN list",
    meta = [],
  } = opts;
  const { doc, pageWidth, margin } = ctx;

  const headerHeight = 110;
  ensureSpace(ctx, headerHeight + 8);

  // App-native single frame; this must not resemble government letterhead.
  setDraw(doc, PALETTE.navy);
  doc.setLineWidth(0.8);
  doc.rect(margin, ctx.y, pageWidth - margin * 2, headerHeight);

  const innerLeft = margin + 14;
  const innerWidth = pageWidth - margin * 2 - 28;
  let yy = ctx.y + 22;

  // Prominent non-government notice.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setText(doc, PALETTE.warnText);
  doc.text(eyebrow, pageWidth / 2, yy, { align: "center" });
  yy += 16;

  // Main app-generated record title.
  doc.setFontSize(15);
  setText(doc, PALETTE.navy);
  doc.text(title, pageWidth / 2, yy, { align: "center" });
  yy += 12;

  // Italic subtitle.
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  setText(doc, PALETTE.muted);
  const subLines = doc.splitTextToSize(subtitle, innerWidth);
  for (const line of subLines) {
    doc.text(line, pageWidth / 2, yy, { align: "center" });
    yy += 11;
  }

  // Divider inside header.
  yy += 4;
  setDraw(doc, PALETTE.border);
  doc.setLineWidth(0.4);
  doc.line(innerLeft, yy, innerLeft + innerWidth, yy);
  yy += 12;

  // Meta two-column row.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setText(doc, PALETTE.body);
  if (meta.length) {
    const left = meta.filter((m) => m.side !== "right");
    const right = meta.filter((m) => m.side === "right");
    let ly = yy;
    let ry = yy;
    for (const item of left) {
      doc.setFont("helvetica", "bold");
      doc.text(item.label + ":", innerLeft, ly);
      doc.setFont("helvetica", "normal");
      doc.text(
        String(item.value || "—"),
        innerLeft + doc.getTextWidth(item.label + ": "),
        ly
      );
      ly += 11;
    }
    for (const item of right) {
      doc.setFont("helvetica", "bold");
      const labelWidth = doc.getTextWidth(item.label + ": ");
      const valWidth = doc.getTextWidth(String(item.value || "—"));
      const rightEdge = innerLeft + innerWidth;
      doc.text(item.label + ":", rightEdge - labelWidth - valWidth, ry);
      doc.setFont("helvetica", "normal");
      doc.text(String(item.value || "—"), rightEdge - valWidth, ry);
      ry += 11;
    }
  }

  ctx.y += headerHeight + 14;
}

/**
 * Simpler title bar for non-OFAC reports (Repeat Offender, Title & Lien).
 */
function drawCheckHeader(ctx, opts) {
  const { title, meta = [] } = opts;
  const { doc, pageWidth, margin } = ctx;

  ensureSpace(ctx, 56);

  setFill(doc, PALETTE.cardBg);
  doc.rect(margin, ctx.y, pageWidth - margin * 2, 46, "F");
  setDraw(doc, PALETTE.navy);
  doc.setLineWidth(0.8);
  doc.line(margin, ctx.y + 46, pageWidth - margin * 2 + margin, ctx.y + 46);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  setText(doc, PALETTE.navy);
  doc.text(title, margin + 12, ctx.y + 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setText(doc, PALETTE.muted);
  const metaY = ctx.y + 32;
  const metaText = meta
    .filter(Boolean)
    .map((m) => (m.value ? `${m.label}: ${m.value}` : null))
    .filter(Boolean)
    .join("   ·   ");
  if (metaText) {
    doc.text(metaText, margin + 12, metaY);
  }

  ctx.y += 56;
}

function drawSubjectBox(ctx, opts) {
  const { title = "SUBJECT SCREENED", rows = [] } = opts;
  const { doc, pageWidth, margin } = ctx;

  const rowHeight = 16;
  const padding = 12;
  const totalH = padding * 2 + 22 + rows.length * rowHeight;
  ensureSpace(ctx, totalH + 8);

  setFill(doc, PALETTE.cardBg);
  setDraw(doc, PALETTE.border);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin, ctx.y, pageWidth - margin * 2, totalH, 4, 4, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setText(doc, PALETTE.muted);
  doc.text(title, margin + padding, ctx.y + padding + 10);

  setDraw(doc, PALETTE.border);
  doc.setLineWidth(0.4);
  doc.line(
    margin + padding,
    ctx.y + padding + 16,
    pageWidth - margin - padding,
    ctx.y + padding + 16
  );

  let rowY = ctx.y + padding + 16 + rowHeight - 4;
  for (const r of rows) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setText(doc, PALETTE.body);
    doc.text(r.label + ":", margin + padding, rowY);
    doc.setFont("helvetica", "normal");
    setText(doc, PALETTE.ink);
    doc.text(String(r.value || "—"), margin + padding + 130, rowY);
    rowY += rowHeight;
  }

  ctx.y += totalH + 14;
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

  const padding = 20;
  const titleH = 28;
  const subH = subtitle ? 16 : 0;
  const extraH = extraLines.length * 14;
  const totalH = padding * 2 + titleH + subH + extraH;
  ensureSpace(ctx, totalH + 12);

  setFill(doc, palette.bg);
  setDraw(doc, palette.border);
  doc.setLineWidth(2);
  doc.roundedRect(margin, ctx.y, pageWidth - margin * 2, totalH, 6, 6, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setText(doc, palette.text);
  doc.text(title, pageWidth / 2, ctx.y + padding + 20, { align: "center" });

  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(subtitle, pageWidth / 2, ctx.y + padding + titleH + 12, {
      align: "center",
    });
  }

  if (extraLines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, palette.text);
    let ly = ctx.y + padding + titleH + subH + 12;
    for (const line of extraLines) {
      doc.text(line, pageWidth / 2, ly, { align: "center" });
      ly += 14;
    }
  }

  ctx.y += totalH + 14;
}

function drawScreeningRecord(ctx, text) {
  const { doc, pageWidth, margin } = ctx;
  const padding = 12;
  const lineHeight = 11;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const lines = doc.splitTextToSize(text, pageWidth - margin * 2 - padding * 2);
  const totalH = padding * 2 + lines.length * lineHeight;
  ensureSpace(ctx, totalH + 8);

  setFill(doc, PALETTE.yellowBg);
  setDraw(doc, PALETTE.yellowBorder);
  doc.setLineWidth(0.8);
  doc.roundedRect(margin, ctx.y, pageWidth - margin * 2, totalH, 4, 4, "FD");

  setText(doc, PALETTE.warnText);
  doc.setFont("helvetica", "bold");
  doc.text("SCREENING RECORD", margin + padding, ctx.y + padding + 9);
  doc.setFont("helvetica", "normal");
  let ly = ctx.y + padding + 22;
  for (const line of lines) {
    doc.text(line, margin + padding, ly);
    ly += lineHeight;
  }

  ctx.y += totalH + 14;
}

function drawFooter(ctx, lines) {
  const { doc, pageWidth, pageHeight, margin } = ctx;
  const yStart = pageHeight - margin - 6 - lines.length * 11;
  setDraw(doc, PALETTE.border);
  doc.setLineWidth(0.4);
  doc.line(margin, yStart, pageWidth - margin, yStart);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setText(doc, PALETTE.muted);
  let ly = yStart + 12;
  for (const line of lines) {
    doc.text(line, pageWidth / 2, ly, { align: "center" });
    ly += 10;
  }
}

function drawScreenshotPage(ctx, dataUrl, opts = {}) {
  if (!dataUrl) return;
  const { doc, pageWidth, pageHeight, margin } = ctx;
  const usableW = pageWidth - margin * 2;
  const maxH = pageHeight - ctx.y - margin - (opts.reserveFooter ? 36 : 0);

  try {
    const imgProps = doc.getImageProperties(dataUrl);
    const ratio = imgProps.height / imgProps.width;
    let renderW = usableW;
    let renderH = renderW * ratio;
    if (renderH > maxH) {
      renderH = maxH;
      renderW = renderH / ratio;
    }
    // Border around screenshot.
    setDraw(doc, PALETTE.border);
    doc.setLineWidth(0.5);
    const x = margin + (usableW - renderW) / 2;
    doc.addImage(dataUrl, "PNG", x, ctx.y, renderW, renderH);
    doc.rect(x, ctx.y, renderW, renderH);
    ctx.y += renderH + 10;
  } catch (err) {
    console.error("PDF image error:", err);
    writeText(ctx, "Screenshot could not be embedded.", {
      fontSize: 9,
      color: PALETTE.warnText,
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
    .slice(0, 80);
}

function nowStamp() {
  return new Date().toLocaleString();
}

const STANDARD_FOOTER = [
  "Data Source: Official U.S. Treasury OFAC SDN List  ·  auto-refreshed daily.",
  "Generated by Compliance Central — Michigan Dealer Compliance Hub.",
];

const MDOS_FOOTER = [
  "Actual page captured from https://dsvsesvc.sos.state.mi.us/  ·  Framed by Compliance Central.",
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
      { label: "Report Generated", value: nowStamp() },
      { label: "Screening Date", value: reportDate(ofac.timestamp) },
      { label: "Database Updated", value: lastUpdate, side: "right" },
      { label: "Entries Searched", value: entries, side: "right" },
    ],
  });

  const rows = [
    { label: "Full Name", value: subjectFullName(customer) },
    { label: "Date of Birth", value: customer.dob },
    { label: "Driver License / PID", value: customer.dlnPid },
  ];
  if (customer.tradeVin) {
    rows.push({ label: "Trade-In VIN", value: customer.tradeVin });
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
      outcome.state === "match" && shownMatches.length
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
    writeText(
      ctx,
      `DATA FRESHNESS NOTICE: This screening used cached SDN data last updated ${lastUpdate}${
        ofac.dataAgeHours != null ? ` (about ${ofac.dataAgeHours} hours ago)` : ""
      }. A live update was unavailable at screening time — re-run this check when back online to screen against the current OFAC SDN list.`,
      { fontSize: 9, bold: true, color: PALETTE.warnText }
    );
    ctx.y += 6;
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
  const { title, meta = [], subject, result, screenshot } = opts;
  drawCheckHeader(ctx, { title, meta });
  if (subject) drawSubjectBox(ctx, subject);
  if (result) drawResultBox(ctx, result);
  if (screenshot) {
    const safeShot = ensureDataUrl(screenshot);
    if (safeShot) {
      writeText(ctx, "ACTUAL MICHIGAN STATE-SITE SCREENSHOT", {
        fontSize: 9,
        bold: true,
        color: PALETTE.muted,
      });
      writeText(ctx, "Captured from https://dsvsesvc.sos.state.mi.us/", {
        fontSize: 8,
        color: PALETTE.muted,
      });
      ctx.y += 2;
      drawScreenshotPage(ctx, safeShot, { reserveFooter: true });
    } else {
      writeText(
        ctx,
        "ACTUAL MICHIGAN STATE-SITE SCREENSHOT UNAVAILABLE",
        { fontSize: 9, bold: true, color: PALETTE.warnText }
      );
      writeText(
        ctx,
        "The result above is an app-generated summary, not a Michigan Department of State webpage or document. Re-run the check before relying on it when state-site evidence is required.",
        { fontSize: 9, color: PALETTE.warnText }
      );
    }
  } else {
    writeText(
      ctx,
      "ACTUAL MICHIGAN STATE-SITE SCREENSHOT UNAVAILABLE",
      { fontSize: 9, bold: true, color: PALETTE.warnText }
    );
    writeText(
      ctx,
      "The result above is an app-generated summary, not a Michigan Department of State webpage or document. Re-run the check before relying on it when state-site evidence is required.",
      { fontSize: 9, color: PALETTE.warnText }
    );
  }
  drawFooter(ctx, MDOS_FOOTER);
}

// Renders an MDOS/SOS check as the ACTUAL captured portal page: a slim
// provenance header (who / what / when), then the real screenshot filling the
// page, then a source footer. This is the digital equivalent of opening the
// portal and printing it — we do NOT rebuild the result with our own boxes.
// (Reconstruction is reserved for OFAC, which has no portal page to capture.)
function drawPortalCapture(ctx, opts) {
  const { title, metaLine, screenshot, footerLines = MDOS_FOOTER } = opts;
  const { doc, pageWidth, margin } = ctx;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  setText(doc, PALETTE.navy);
  doc.text(title, margin, ctx.y + 12);
  ctx.y += 22;

  if (metaLine) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setText(doc, PALETTE.muted);
    const lines = doc.splitTextToSize(String(metaLine), pageWidth - margin * 2);
    for (const ln of lines) {
      doc.text(ln, margin, ctx.y + 8);
      ctx.y += 11;
    }
  }

  setDraw(doc, PALETTE.navy);
  doc.setLineWidth(0.8);
  doc.line(margin, ctx.y + 2, pageWidth - margin, ctx.y + 2);
  ctx.y += 12;

  writeText(ctx, "ACTUAL MICHIGAN STATE-SITE SCREENSHOT", {
    fontSize: 9,
    bold: true,
    color: PALETTE.muted,
  });
  writeText(ctx, "Captured from https://dsvsesvc.sos.state.mi.us/", {
    fontSize: 8,
    color: PALETTE.muted,
  });
  ctx.y += 3;
  drawScreenshotPage(ctx, screenshot, { reserveFooter: true });
  drawFooter(ctx, footerLines);
}

/** A combined-report section that renders the actual Repeat Offender portal
 * capture when a screenshot exists, else a labeled summary. */
export function repeatSection(ro, person, title, subjectLabel) {
  const screenshot = stateEvidenceDataUrl(ro);
  const classification = classifyRepeatOffenderResult(ro);
  if (
    screenshot &&
    ["eligible", "ineligible"].includes(classification.state)
  ) {
    return {
      orientation: "portrait",
      render: (ctx) =>
        drawPortalCapture(ctx, {
          title,
          metaLine: `Customer: ${subjectFullName(person)}   ·   DLN/PID: ${person?.dlnPid || "—"}   ·   Captured: ${reportDate(ro?.timestamp)}`,
          screenshot,
        }),
    };
  }
  return {
    orientation: "portrait",
    render: (ctx) =>
      drawMdosResultSection(ctx, {
        title,
        meta: [{ label: "Screened", value: reportDate(ro?.timestamp) }],
        subject: {
          title: subjectLabel,
          rows: [
            { label: "Full Name", value: subjectFullName(person) },
            { label: "Date of Birth", value: person?.dob },
            { label: "Driver License / PID", value: person?.dlnPid },
          ],
        },
        result: repeatOffenderResultArgs(ro),
        screenshot,
      }),
  };
}

/** A combined-report section that renders the actual Title & Lien portal
 * capture when a screenshot exists, else a labeled summary. */
export function titleSection(t, customer) {
  const vin = customer?.tradeVin || "N/A";
  const vehicle = [t?.year, t?.make, t?.model].filter(Boolean).join(" ");
  const screenshot = stateEvidenceDataUrl(t);
  if (screenshot && !t?.error && t?.status !== "error") {
    return {
      orientation: "portrait",
      render: (ctx) =>
        drawPortalCapture(ctx, {
          title: "Michigan Title & Lien Check",
          metaLine: `VIN: ${vin}${vehicle ? "   ·   " + vehicle : ""}   ·   Captured: ${reportDate(t?.timestamp)}`,
          screenshot,
        }),
    };
  }
  return {
    orientation: "portrait",
    render: (ctx) =>
      drawMdosResultSection(ctx, {
        title: "Michigan Title & Lien Check",
        meta: [{ label: "Screened", value: reportDate(t?.timestamp) }],
        subject: { title: "TRADE-IN VEHICLE", rows: titleSubjectRows(t, vin) },
        result: titleResultArgs(t),
        screenshot,
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
  const rows = [{ label: "VIN", value: vin }];
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

/** First page of a combined PDF: final decision plus every expected check. */
export function finalDecisionSection(currentResults) {
  const summary = reportDecisionSummary(currentResults);
  const decisionVariant =
    summary.decision.level === "APPROVED"
      ? "pass"
      : summary.decision.level === "DENIED"
        ? "fail"
        : "warn";

  return {
    orientation: "portrait",
    render: (ctx) => {
      drawCheckHeader(ctx, {
        title: "Overall Compliance Decision",
        meta: [{ label: "Report generated", value: nowStamp() }],
      });
      drawResultBox(ctx, {
        variant: decisionVariant,
        title:
          summary.decision.level === "REVIEW"
            ? "REVIEW REQUIRED"
            : summary.decision.level,
        subtitle: summary.decision.reason,
      });

      writeText(ctx, "CHECK SUMMARY", {
        fontSize: 11,
        bold: true,
        color: PALETTE.navy,
      });
      ctx.y += 4;
      for (const row of summary.rows) {
        writeText(ctx, `${row.label}: ${row.state}`, {
          fontSize: 10,
          bold: true,
          color: row.incomplete ? PALETTE.warnText : PALETTE.ink,
        });
        writeText(ctx, row.detail, {
          fontSize: 8.5,
          color: PALETTE.body,
        });
        ctx.y += 6;
      }

      ctx.y += 4;
      writeText(ctx, "INCOMPLETE CHECKS", {
        fontSize: 11,
        bold: true,
        color:
          summary.incomplete.length > 0
            ? PALETTE.warnText
            : PALETTE.successText,
      });
      if (summary.incomplete.length > 0) {
        for (const row of summary.incomplete) {
          writeText(ctx, `${row.label}: ${row.state} — ${row.detail}`, {
            fontSize: 9,
            color: PALETTE.warnText,
          });
        }
      } else {
        writeText(ctx, "None. Every required check returned a recognized result.", {
          fontSize: 9,
          color: PALETTE.successText,
        });
      }
      drawFooter(ctx, [
        "Generated by Compliance Central  ·  Review source evidence before completing a transaction.",
      ]);
    },
  };
}

// ---------- Public downloaders ----------

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
  ctx.doc.save(fileName);
}

export function combinedPdfSections(currentResults) {
  const customer = currentResults?.customer || {};
  const checks = currentResults?.checks || {};
  const coBuyer = customer.coBuyer;
  const sections = [finalDecisionSection(currentResults)];

  if (checks.ofac) {
    sections.push({
      orientation: "portrait",
      render: (ctx) => drawOfacSection(ctx, customer, checks.ofac),
    });
  }
  if (checks.coBuyerOfac && coBuyer) {
    sections.push({
      orientation: "portrait",
      render: (ctx) =>
        drawOfacSection(ctx, coBuyer, checks.coBuyerOfac, {
          subjectLabel: "CO-BUYER SUBJECT SCREENED",
        }),
    });
  }

  if (checks.repeatOffender) {
    sections.push(
      repeatSection(
        checks.repeatOffender,
        customer,
        "Michigan Repeat Offender Check",
        "SUBJECT SCREENED"
      )
    );
  }

  if (checks.coBuyerRepeatOffender && coBuyer) {
    sections.push(
      repeatSection(
        checks.coBuyerRepeatOffender,
        coBuyer,
        "Michigan Repeat Offender Check (Co-Buyer)",
        "CO-BUYER SCREENED"
      )
    );
  }

  if (checks.title) {
    sections.push(titleSection(checks.title, customer));
  }

  return sections;
}

/**
 * Combined "Download PDF" — every check that ran, stitched into one PDF
 * with the same official styling as the per-check downloads.
 */
export async function downloadAllReportsPDF(currentResults) {
  if (!currentResults) {
    showToast("No results to download.", "info");
    return;
  }

  const customer = currentResults.customer;
  // Build the section list. OFAC renders its official letterhead; the MDOS/SOS
  // checks render the actual portal capture (the page the dealer would print).
  // All pages are portrait.
  const sections = combinedPdfSections(currentResults);

  if (!sections.length) {
    showToast("Nothing to include in the PDF yet.", "info");
    return;
  }

  let ctx;
  try {
    ctx = await createPdfContext(sections[0].orientation);
  } catch (err) {
    console.error("jsPDF load error:", err);
    showToast("Could not load PDF library. Try the Print button instead.", "error");
    return;
  }

  for (let i = 0; i < sections.length; i++) {
    if (i > 0) addPageWithOrientation(ctx, sections[i].orientation);
    await sections[i].render(ctx);
  }

  ctx.doc.save(
    `Compliance_${safeFileName([
      customer?.firstName,
      customer?.lastName,
    ])}_${Date.now()}.pdf`
  );
}


export function repeatReportHTML(currentResults, isCoBuyer = false) {
  const c = isCoBuyer ? currentResults.customer?.coBuyer : currentResults.customer;
  if (!c) return "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Michigan Repeat Offender Check</title>
  <style>
    @page { size: portrait; margin: 0.5in; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #333; margin: 0; padding: 20px; background: #fff; }
    .page-header { display: flex; justify-content: space-between; font-size: 10px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 15px; }
    .main-title { color: #1e3a5f; font-size: 20px; font-weight: 700; margin-bottom: 15px; font-family: Arial, Helvetica, sans-serif; }
    .summary-notice { padding: 13px 16px; border: 1px solid #cbd5e1; border-left: 4px solid #1e3a5f; border-radius: 6px; background: #f8fafc; margin-bottom: 14px; font-size: 11px; color: #475569; }
    .summary-notice strong { display: block; margin-bottom: 4px; color: #1e3a5f; font-size: 13px; }
    .content-box { border: 1px solid #e5e7eb; padding: 24px; background: #fff; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .section-title { font-size: 16px; font-weight: bold; color: #111827; margin-top: 0; margin-bottom: 4px; }
    .section-subtitle { font-size: 11px; color: #6b7280; margin-bottom: 20px; }
    .form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
    .form-field { display: flex; flex-direction: column; }
    .form-label { font-size: 10px; color: #4b5563; margin-bottom: 4px; font-weight: 600; }
    .form-value { background: #f9fafb; border: 1px solid #d1d5db; padding: 8px 12px; border-radius: 4px; font-size: 13px; font-weight: bold; text-transform: uppercase; height: 18px; line-height: 18px; }
    .results-header { font-size: 12px; font-weight: bold; color: #374151; margin-top: 25px; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    .eligible-card { border: 1px solid #ceead6; background: #e6f4ea; border-radius: 6px; padding: 16px; display: flex; gap: 12px; align-items: flex-start; color: #137333; margin-top: 15px; }
    .eligible-icon { width: 20px; height: 20px; fill: currentColor; flex-shrink: 0; margin-top: 2px; }
    .eligible-text { font-size: 12px; line-height: 1.5; font-weight: 500; }
    .eligible-text strong { font-weight: 700; }
    .eligible-note { font-size: 10px; color: #5f6368; margin-top: 6px; font-weight: normal; }
    .btn-search { background: #137078; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; text-align: center; }
    .portal-footer { text-align: center; font-size: 10px; color: #6b7280; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 15px; }
    .copyright { font-size: 9px; color: #9ca3af; margin-top: 5px; }
    .eligible-card.result-review { border-color: #f59e0b; background: #fffbeb; color: #92400e; }
    .state-evidence { margin-top: 22px; padding-top: 12px; break-inside: avoid; break-before: page; page-break-before: always; }
    .state-evidence h2 { color: #1e3a5f; font-size: 15px; margin-bottom: 4px; }
    .state-evidence p { color: #555; font-size: 10px; margin-bottom: 10px; }
    .state-evidence img { display: block; width: 100%; max-height: 78vh; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; }
    .evidence-unavailable { margin-top: 22px; padding: 14px; border: 1px solid #f59e0b; background: #fffbeb; color: #78350f; border-radius: 6px; font-size: 11px; line-height: 1.5; }
  </style>
</head>
<body>
  ${getRepeatReportPageHTML(currentResults, isCoBuyer)}
</body>
</html>`;
}

export function titleReportHTML(currentResults) {
  const c = currentResults.customer;
  if (!c) return "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Michigan Title & Lien Check</title>
  <style>
    @page { size: portrait; margin: 0.5in; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #333; margin: 0; padding: 20px; background: #fff; }
    .page-header { display: flex; justify-content: space-between; font-size: 10px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 15px; }
    .main-title { color: #1e3a5f; font-size: 20px; font-weight: 700; margin-bottom: 15px; font-family: Arial, Helvetica, sans-serif; }
    .summary-notice { padding: 13px 16px; border: 1px solid #cbd5e1; border-left: 4px solid #1e3a5f; border-radius: 6px; background: #f8fafc; margin-bottom: 14px; font-size: 11px; color: #475569; }
    .summary-notice strong { display: block; margin-bottom: 4px; color: #1e3a5f; font-size: 13px; }
    .content-box { border: 1px solid #e5e7eb; padding: 24px; background: #fff; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .section-title { font-size: 16px; font-weight: bold; color: #111827; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    .vin-search-info { border-left: 3px solid #137078; padding-left: 10px; font-size: 11px; color: #374151; margin-bottom: 20px; font-weight: 500; }
    .vin-search-info strong { color: #111827; }
    .eligible-card { border: 1px solid #ceead6; background: #e6f4ea; border-radius: 6px; padding: 16px; color: #137333; margin: 15px 0 20px; }
    .eligible-card.result-review { border-color: #f59e0b; background: #fffbeb; color: #92400e; }
    .eligible-text { font-size: 12px; line-height: 1.5; font-weight: 500; }
    .eligible-note { font-size: 10px; color: #5f6368; margin-top: 6px; font-weight: normal; }
    .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
    .detail-label { width: 180px; font-weight: 600; color: #4b5563; }
    .detail-value { color: #111827; font-weight: 500; }
    .detail-value.red { color: #b91c1c; font-weight: bold; }
    .brands-section { margin-top: 25px; }
    .brands-title { font-size: 14px; font-weight: bold; color: #111827; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    .brands-text { font-size: 12px; color: #4b5563; margin-bottom: 20px; }
    .btn-start-over { background: #137078; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; display: inline-block; text-align: center; }
    .portal-footer { text-align: center; font-size: 10px; color: #6b7280; margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 15px; }
    .copyright { font-size: 9px; color: #9ca3af; margin-top: 5px; }
    .state-evidence { margin-top: 22px; padding-top: 12px; break-inside: avoid; break-before: page; page-break-before: always; }
    .state-evidence h2 { color: #1e3a5f; font-size: 15px; margin-bottom: 4px; }
    .state-evidence p { color: #555; font-size: 10px; margin-bottom: 10px; }
    .state-evidence img { display: block; width: 100%; max-height: 78vh; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; }
    .evidence-unavailable { margin-top: 22px; padding: 14px; border: 1px solid #f59e0b; background: #fffbeb; color: #78350f; border-radius: 6px; font-size: 11px; line-height: 1.5; }
  </style>
</head>
<body>
  ${getTitleReportPageHTML(currentResults)}
</body>
</html>`;
}
