/**
 * Print + PDF download for compliance reports.
 *
 * - Print path: opens a print-formatted window and triggers window.print().
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
} from "./title-format.js";

const PRINT_TIMEOUT_MS = 5 * 60 * 1000;

// DOB-disambiguation confidence labels for the OFAC report (mirrors the card).
const OFAC_CONF_LABEL = {
  high: "DOB match",
  medium: "DOB unknown",
  low: "DOB differs",
};

function setupPrintWindowCleanup(printWindow, timeoutMs = PRINT_TIMEOUT_MS) {
  let closed = false;
  const closeWindow = () => {
    if (!closed && printWindow && !printWindow.closed) {
      closed = true;
      try {
        printWindow.close();
      } catch {
        // already closed
      }
    }
  };

  printWindow.onafterprint = closeWindow;
  setTimeout(() => {
    if (!closed && printWindow && !printWindow.closed) closeWindow();
  }, timeoutMs);

  let printStarted = false;
  printWindow.onbeforeprint = () => {
    printStarted = true;
  };
  window.addEventListener(
    "focus",
    () => {
      if (printStarted && !closed) {
        setTimeout(() => {
          if (!closed && printWindow && !printWindow.closed) closeWindow();
        }, 1000);
      }
    },
    { once: true }
  );
}

function openAndPrint(html, waitForImages = false) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Popup blocked. Allow popups for this page.", "warning");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  setupPrintWindowCleanup(printWindow);

  if (!waitForImages) {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 400);
    return;
  }

  const images = printWindow.document.querySelectorAll("img");
  if (images.length === 0) {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 400);
    return;
  }

  let loaded = 0;
  const tryPrint = () => {
    if (++loaded === images.length) {
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 400);
    }
  };
  images.forEach((img) => {
    if (img.complete) tryPrint();
    else {
      img.onload = tryPrint;
      img.onerror = tryPrint;
    }
  });
}

function ensureDataUrl(data) {
  if (!data) return null;
  return data.startsWith("data:") ? data : `data:image/png;base64,${data}`;
}

// ---------- HTML report templates ----------

function ofacReportHTML({ customer, ofac, lastUpdate, subjectLabel = "SUBJECT SCREENED" }) {
  const timestamp = new Date().toLocaleString();
  const screeningDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>OFAC Screening Report</title>
  <style>
    @page { margin: 0.5in; }
    body { font-family: 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 30px; }
    .header { border: 3px double #1e3a5f; padding: 25px; margin-bottom: 25px; background: linear-gradient(to bottom, #fff, #f0f4f8); }
    .header-title { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 15px; margin-bottom: 15px; }
    .header h1 { color: #1e3a5f; margin: 0; font-size: 20px; letter-spacing: 2px; }
    .header h2 { color: #1e3a5f; margin: 8px 0 0; font-size: 16px; }
    .header-subtitle { color: #64748b; font-size: 13px; margin: 8px 0 0; font-style: italic; }
    .header-info { display: flex; justify-content: space-between; font-size: 12px; color: #374151; }
    .result { padding: 30px; margin: 25px 0; border-radius: 8px; text-align: center; }
    .result.pass { background: linear-gradient(to bottom, #d1fae5, #a7f3d0); border: 3px solid #10b981; }
    .result.fail { background: linear-gradient(to bottom, #fee2e2, #fecaca); border: 3px solid #ef4444; }
    .result h2 { margin: 0; font-size: 36px; }
    .result.pass h2 { color: #065f46; }
    .result.fail h2 { color: #991b1b; }
    .result p { margin: 15px 0 0; font-size: 16px; }
    .subject { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0; }
    .subject h3 { margin: 0 0 15px; color: #1e3a5f; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; }
    .subject table { width: 100%; font-size: 13px; border-collapse: collapse; }
    .subject td { padding: 5px 0; }
    .subject td:first-child { width: 30%; }
    .certification { background: #fefce8; padding: 15px; border-radius: 6px; margin: 25px 0; border: 1px solid #fde047; font-size: 12px; color: #713f12; }
    .footer { color: #64748b; font-size: 10px; text-align: center; margin-top: 30px; border-top: 2px solid #e2e8f0; padding-top: 15px; }
    .matches { margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.7); border-radius: 6px; text-align: left; }

    .page-header { display: flex; justify-content: space-between; font-size: 10px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 15px; }
    .main-title { color: #1e3a5f; font-size: 20px; font-weight: 700; margin-bottom: 15px; font-family: Arial, Helvetica, sans-serif; }
    .mdos-banner { background: #137078; color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; border-radius: 4px 4px 0 0; }
    .mdos-logo { display: flex; align-items: center; gap: 10px; font-weight: bold; }
    .mdos-links { font-size: 11px; }
    .mdos-links a { color: white; text-decoration: none; margin-left: 10px; }
    .breadcrumb { padding: 10px 20px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-size: 11px; color: #137078; font-weight: bold; }
    .content-box { border: 1px solid #e5e7eb; border-top: none; padding: 24px; background: #fff; border-radius: 0 0 4px 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
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
    .vin-search-info { border-left: 3px solid #137078; padding-left: 10px; font-size: 11px; color: #374151; margin-bottom: 20px; font-weight: 500; }
    .vin-search-info strong { color: #111827; }
    .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
    .detail-label { width: 180px; font-weight: 600; color: #4b5563; }
    .detail-value { color: #111827; font-weight: 500; }
    .detail-value.red { color: #b91c1c; font-weight: bold; }
    .brands-section { margin-top: 25px; }
    .brands-title { font-size: 14px; font-weight: bold; color: #111827; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    .brands-text { font-size: 12px; color: #4b5563; margin-bottom: 20px; }
    .btn-start-over { background: #137078; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; display: inline-block; text-align: center; }

  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <h1>U.S. DEPARTMENT OF THE TREASURY</h1>
      <h2>Office of Foreign Assets Control (OFAC)</h2>
      <p class="header-subtitle">Specially Designated Nationals and Blocked Persons List (SDN) Screening Report</p>
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
    <h3>${subjectLabel}</h3>
    <table>
      <tr><td><strong>Full Name:</strong></td><td>${buildSanitizedName(customer)}</td></tr>
      <tr><td><strong>Date of Birth:</strong></td><td>${sanitizeHTML(customer.dob) || "Not Provided"}</td></tr>
      <tr><td><strong>Driver License / PID:</strong></td><td>${sanitizeHTML(customer.dlnPid) || "Not Provided"}</td></tr>
      ${customer.tradeVin ? `<tr><td><strong>Trade-In VIN:</strong></td><td>${sanitizeHTML(customer.tradeVin)}</td></tr>` : ""}
    </table>
  </div>
  <div class="result ${ofac.passed ? "pass" : "fail"}">
    <h2>${ofac.passed ? "✓ NO MATCH FOUND" : "⚠ POTENTIAL MATCH"}</h2>
    <p>${ofac.passed ? "Subject is NOT listed on the OFAC SDN List" : "REVIEW REQUIRED — Potential match found"}</p>
    ${
      !ofac.passed && ofac.matches?.length > 0
        ? `<div class="matches"><strong>Potential Matches (${ofac.matches.length}):</strong><ul>${ofac.matches
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
            ofac.matches.length > 5
              ? `<p><em>…and ${ofac.matches.length - 5} more potential match(es) — review the full list in the extension before proceeding.</em></p>`
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
    <p><strong>Compliance Certification:</strong> This screening was performed in accordance with OFAC regulations requiring financial institutions and businesses to screen customers against the SDN List. This report serves as documentation of compliance efforts.</p>
  </div>
  <div class="footer">
    <p><strong>Data Source:</strong> OFAC SDN List via OpenSanctions &middot; auto-refreshed every 24 hours.</p>
    <p>Generated by Compliance Central — Michigan Dealer Compliance Hub.</p>
  </div>
</body>
</html>`;
}

function screenshotReportHTML({ heading, subjectLines, screenshotData, orientation = "landscape" }) {
  const timestamp = new Date().toLocaleString();
  const dataUrl = ensureDataUrl(screenshotData);
  return `<!DOCTYPE html>
<html>
<head>
  <title>${sanitizeHTML(heading)}</title>
  <style>
    @page { size: ${orientation}; margin: 0.25in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 15px; background: #fff; }
    .header { border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
    .header h2 { color: #1e3a5f; font-size: 16px; }
    .header-info { font-size: 10px; text-align: right; }
    .header-info p { margin: 2px 0; }
    .screenshot-container { text-align: center; }
    .screenshot-container img { max-width: 100%; max-height: ${orientation === "portrait" ? "80vh" : "65vh"}; border: 1px solid #ccc; }
    .footer { font-size: 8px; color: #666; text-align: center; margin-top: 8px; border-top: 1px solid #ccc; padding-top: 5px; }

    .page-header { display: flex; justify-content: space-between; font-size: 10px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 15px; }
    .main-title { color: #1e3a5f; font-size: 20px; font-weight: 700; margin-bottom: 15px; font-family: Arial, Helvetica, sans-serif; }
    .mdos-banner { background: #137078; color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; border-radius: 4px 4px 0 0; }
    .mdos-logo { display: flex; align-items: center; gap: 10px; font-weight: bold; }
    .mdos-links { font-size: 11px; }
    .mdos-links a { color: white; text-decoration: none; margin-left: 10px; }
    .breadcrumb { padding: 10px 20px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-size: 11px; color: #137078; font-weight: bold; }
    .content-box { border: 1px solid #e5e7eb; border-top: none; padding: 24px; background: #fff; border-radius: 0 0 4px 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
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
    .vin-search-info { border-left: 3px solid #137078; padding-left: 10px; font-size: 11px; color: #374151; margin-bottom: 20px; font-weight: 500; }
    .vin-search-info strong { color: #111827; }
    .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
    .detail-label { width: 180px; font-weight: 600; color: #4b5563; }
    .detail-value { color: #111827; font-weight: 500; }
    .detail-value.red { color: #b91c1c; font-weight: bold; }
    .brands-section { margin-top: 25px; }
    .brands-title { font-size: 14px; font-weight: bold; color: #111827; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    .brands-text { font-size: 12px; color: #4b5563; margin-bottom: 20px; }
    .btn-start-over { background: #137078; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; display: inline-block; text-align: center; }

  </style>
</head>
<body>
  <div class="header">
    <h2>${sanitizeHTML(heading)}</h2>
    <div class="header-info">
      ${subjectLines.map((line) => `<p>${line}</p>`).join("")}
      <p><strong>Date:</strong> ${timestamp}</p>
    </div>
  </div>
  <div class="screenshot-container"><img src="${dataUrl}" /></div>
  <div class="footer">Source: Michigan Department of State MDOS Portal &middot; Compliance Central</div>
</body>
</html>`;
}


function getRepeatReportPageHTML(currentResults, isCoBuyer = false) {
  const c = isCoBuyer ? currentResults.customer?.coBuyer : currentResults.customer;
  if (!c) return "";
  const timestamp = new Date().toLocaleString();
  const dateStr = new Date().toLocaleDateString("en-US");
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' });
  const headerTime = `${dateStr}, ${timeStr}`;

  return `
    <div class="page repeat-page">
      <div class="page-header">
        <div>${dateStr}, ${timeStr}</div>
        <div style="font-weight: 600;">Compliance Central &mdash; All Reports</div>
        <div style="text-align: right;">
          <strong>Customer:</strong> ${c.firstName} ${c.lastName}<br>
          <strong>Date:</strong> ${timestamp}
        </div>
      </div>
      <div class="main-title">Michigan Repeat Offender Check</div>
      <hr style="border: none; border-top: 2px solid #1e3a5f; margin-bottom: 20px; margin-top: -8px;">
      
      <div class="mdos-banner">
        <div class="mdos-logo">
          <svg style="width:20px; height:20px; fill:white;" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          Michigan Department of State Online Services
        </div>
        <div class="mdos-links">
          <a href="#">SOS Home</a> | <a href="#">MI.gov</a> | <a href="#">FAQs</a> | <a href="#">Contact Us</a>
        </div>
      </div>
      <div class="breadcrumb">&lt; Dealer Services</div>
      
      <div class="content-box">
        <div class="section-title">Repeat Offender Search</div>
        <div class="section-subtitle">Enter the full name as it appears on the ID</div>
        
        <div class="form-grid">
          <div class="form-field">
            <div class="form-label">First Name</div>
            <div class="form-value">${c.firstName}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Middle Name</div>
            <div class="form-value">${c.middleName || ''}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Last Name</div>
            <div class="form-value">${c.lastName}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Suffix</div>
            <div class="form-value">${c.suffix || ''}</div>
          </div>
        </div>
        
        <div class="section-subtitle" style="margin-top: 20px; margin-bottom: 15px;">Enter the ID Information</div>
        
        <div class="form-grid" style="align-items: end;">
          <div class="form-field" style="grid-column: span 2;">
            <div class="form-label">Date of Birth</div>
            <div class="form-value">${formatDobForMdos(c.dob)}</div>
          </div>
          <div class="form-field" style="grid-column: span 2;">
            <div class="form-label">Enter the DLN or PID Number</div>
            <div class="form-value">${formatDlnForMdos(c.dlnPid)}</div>
          </div>
        </div>
        
        <div style="display: flex; justify-content: flex-end; margin-top: 15px;">
          <div class="btn-search">Search Again</div>
        </div>
        
        <div class="results-header">Search Results as of ${headerTime}</div>
        
        <div class="eligible-card">
          <svg class="eligible-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          <div class="eligible-text">
            Our records indicate this purchaser <strong>IS ELIGIBLE</strong> to purchase and register a vehicle.
            <div class="eligible-note">NOTE: This search <strong>DOES NOT</strong> confirm that the above individual is eligible to drive or that the purchaser holds a valid driver's license.</div>
          </div>
        </div>
      </div>
      
      <div class="portal-footer">
        Michigan Secretary of State &nbsp;|&nbsp; Contact Us &nbsp;|&nbsp; FAQs &nbsp;|&nbsp; Privacy Statement
        <div class="copyright">Copyright &copy; 2026 State of Michigan</div>
      </div>
    </div>
  `;
}

function getTitleReportPageHTML(currentResults) {
  const c = currentResults.customer;
  if (!c) return "";
  const timestamp = new Date().toLocaleString();
  const dateStr = new Date().toLocaleDateString("en-US");
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' });
  const headerTime = `${dateStr}, ${timeStr}`;
  const title = currentResults.checks?.title || {};
  const year = title.year || "2018";
  const make = title.make || "HONDA";
  const model = title.model || "CLARITY";
  const unladenWeight = title.unladenWeight || "4,059.00 lbs";
  const titleType = title.titleType || "Electronic";
  const titleIssued = title.titleIssued || "3/7/2025";
  const lienStatus = title.lienStatus || "Active Lien on Vehicle";
  const vehicleBrands = title.vehicleBrands && title.vehicleBrands.length > 0
    ? title.vehicleBrands.join(", ")
    : "No brands were returned for this vehicle";

  return `
    <div class="page title-page">
      <div class="page-header">
        <div>${dateStr}, ${timeStr}</div>
        <div style="font-weight: 600;">Compliance Central &mdash; All Reports</div>
        <div style="text-align: right;">
          <strong>VIN:</strong> ${c.tradeVin}<br>
          <strong>Date:</strong> ${timestamp}
        </div>
      </div>
      <div class="main-title">Michigan Title & Lien Check</div>
      <hr style="border: none; border-top: 2px solid #1e3a5f; margin-bottom: 20px; margin-top: -8px;">
      
      <div class="mdos-banner">
        <div class="mdos-logo">
          <svg style="width:20px; height:20px; fill:white;" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          Michigan Department of State Online Services
        </div>
        <div class="mdos-links">
          <a href="#">SOS Home</a> | <a href="#">MI.gov</a> | <a href="#">FAQs</a> | <a href="#">Contact Us</a>
        </div>
      </div>
      <div class="breadcrumb">&lt; Lien and Brand Information</div>
      
      <div class="content-box">
        <div class="section-title">Search Results</div>
        
        <div class="vin-search-info">
          Search Results For Vehicle Identification Number: <strong>${c.tradeVin}</strong> as of <strong>${headerTime.split(',')[0]}</strong>
        </div>
        
        <div class="detail-row">
          <div class="detail-label">Year:</div>
          <div class="detail-value">${year}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Make:</div>
          <div class="detail-value">${make}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Model:</div>
          <div class="detail-value">${model}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Unladen Weight:</div>
          <div class="detail-value">${unladenWeight}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Title Type:</div>
          <div class="detail-value">${titleType}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Title Issued:</div>
          <div class="detail-value">${titleIssued}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Lien Status:</div>
          <div class="detail-value red">${lienStatus}</div>
        </div>
        
        <div class="brands-section">
          <div class="brands-title">Vehicle Brands</div>
          <div class="brands-text">${vehicleBrands}</div>
        </div>
        
        <div style="margin-top: 15px;">
          <div class="btn-start-over">Start Over</div>
        </div>
      </div>
      
      <div class="portal-footer">
        Michigan Secretary of State &nbsp;|&nbsp; Contact Us &nbsp;|&nbsp; FAQs &nbsp;|&nbsp; Privacy Statement
        <div class="copyright">Copyright &copy; 2026 State of Michigan</div>
      </div>
    </div>
  `;
}

function combinedAllReportHTML(currentResults) {
  const customer = currentResults.customer;
  const timestamp = new Date().toLocaleString();
  const ofac = currentResults.checks?.ofac;
  const repeatOffender = currentResults.checks?.repeatOffender;
  const title = currentResults.checks?.title;
  const cbOfac = currentResults.checks?.coBuyerOfac;
  const cbRepeat = currentResults.checks?.coBuyerRepeatOffender;
  const coBuyer = customer.coBuyer;

  const sections = [];

  const screeningDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const ofacBlock = (subjectHTML, ofacResult, label) => `
    <div class="page ofac-page">
      <div class="ofac-header">
        <h1>U.S. DEPARTMENT OF THE TREASURY</h1>
        <h2>Office of Foreign Assets Control (OFAC)</h2>
        <p class="subtitle">Specially Designated Nationals and Blocked Persons List (SDN) Screening Report</p>
      </div>
      <div class="ofac-meta">
        <div><strong>Report Generated:</strong> ${timestamp}<br><strong>Screening Date:</strong> ${screeningDate}</div>
        <div style="text-align: right;"><strong>Database Updated:</strong> ${sanitizeHTML(ofacResult.lastUpdate || "N/A")}<br><strong>Entries Searched:</strong> ${ofacResult.entriesSearched?.toLocaleString() || "N/A"}</div>
      </div>
      <div class="subject-box">
        <h3>${label}</h3>
        ${subjectHTML}
      </div>
      <div class="result-box ${ofacResult.passed ? "passed" : "failed"}">
        <h2>${ofacResult.passed ? "✓ NO MATCH FOUND" : "⚠ POTENTIAL MATCH"}</h2>
        <p>${ofacResult.passed ? "Subject is NOT listed on the OFAC SDN List" : "REVIEW REQUIRED — Potential match found"}</p>
      </div>
      <div class="footer">Compliance Central — OFAC Screening Report</div>
    </div>`;

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

  const screenshotBlock = (title, subjectLines, screenshotData) => `
    <div class="page screenshot-page">
      <div class="header">
        <h2>${sanitizeHTML(title)}</h2>
        <div class="header-info">
          ${subjectLines.map((l) => `<p>${l}</p>`).join("")}
          <p><strong>Date:</strong> ${timestamp}</p>
        </div>
      </div>
      <div class="screenshot-container"><img src="${ensureDataUrl(screenshotData)}" /></div>
      <div class="footer">Source: Michigan Department of State MDOS Portal &middot; Compliance Central</div>
    </div>`;

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
    .ofac-header { text-align: center; border-bottom: 3px double #1e3a5f; padding-bottom: 15px; margin-bottom: 20px; }
    .ofac-header h1 { font-size: 16px; margin: 0 0 5px; color: #000; text-transform: uppercase; }
    .ofac-header h2 { font-size: 20px; margin: 0 0 5px; color: #1e3a5f; }
    .ofac-header .subtitle { font-size: 12px; color: #666; font-style: italic; }
    .ofac-meta { display: flex; justify-content: space-between; font-size: 10px; color: #555; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
    .subject-box { background: #f8f9fa; border: 1px solid #ddd; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    .subject-box h3 { font-size: 12px; margin: 0 0 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
    .subject-box p { margin: 5px 0; font-size: 14px; }
    .result-box { text-align: center; padding: 20px; border: 2px solid; border-radius: 8px; margin: 30px 0; }
    .result-box.passed { border-color: #28a745; background: #f0fff4; color: #28a745; }
    .result-box.failed { border-color: #dc3545; background: #fff5f5; color: #dc3545; }
    .result-box h2 { font-size: 24px; margin: 0 0 10px; }
    .screenshot-container { text-align: center; margin-top: 20px; }
    .screenshot-container img { max-width: 100%; max-height: 65vh; border: 1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .footer { position: absolute; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; color: #999; border-top: 1px solid #eee; padding-top: 10px; }
    .header-info { font-size: 10px; text-align: right; }
    .header-info p { margin: 2px 0; }

    .page-header { display: flex; justify-content: space-between; font-size: 10px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 15px; }
    .main-title { color: #1e3a5f; font-size: 20px; font-weight: 700; margin-bottom: 15px; font-family: Arial, Helvetica, sans-serif; }
    .mdos-banner { background: #137078; color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; border-radius: 4px 4px 0 0; }
    .mdos-logo { display: flex; align-items: center; gap: 10px; font-weight: bold; }
    .mdos-links { font-size: 11px; }
    .mdos-links a { color: white; text-decoration: none; margin-left: 10px; }
    .breadcrumb { padding: 10px 20px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-size: 11px; color: #137078; font-weight: bold; }
    .content-box { border: 1px solid #e5e7eb; border-top: none; padding: 24px; background: #fff; border-radius: 0 0 4px 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
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
    .vin-search-info { border-left: 3px solid #137078; padding-left: 10px; font-size: 11px; color: #374151; margin-bottom: 20px; font-weight: 500; }
    .vin-search-info strong { color: #111827; }
    .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
    .detail-label { width: 180px; font-weight: 600; color: #4b5563; }
    .detail-value { color: #111827; font-weight: 500; }
    .detail-value.red { color: #b91c1c; font-weight: bold; }
    .brands-section { margin-top: 25px; }
    .brands-title { font-size: 14px; font-weight: bold; color: #111827; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    .brands-text { font-size: 12px; color: #4b5563; margin-bottom: 20px; }
    .btn-start-over { background: #137078; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; display: inline-block; text-align: center; }

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
 * Draws the official "U.S. DEPARTMENT OF THE TREASURY / OFAC" letterhead
 * with the navy double border, two-column meta row, and divider.
 */
function drawOfficialHeader(ctx, opts = {}) {
  const {
    eyebrow = "U.S. DEPARTMENT OF THE TREASURY",
    title = "Office of Foreign Assets Control (OFAC)",
    subtitle = "Specially Designated Nationals and Blocked Persons List (SDN) Screening Report",
    meta = [],
  } = opts;
  const { doc, pageWidth, margin } = ctx;

  const headerHeight = 110;
  ensureSpace(ctx, headerHeight + 8);

  // Outer double border.
  setDraw(doc, PALETTE.navy);
  doc.setLineWidth(1.6);
  doc.rect(margin, ctx.y, pageWidth - margin * 2, headerHeight);
  doc.setLineWidth(0.5);
  doc.rect(
    margin + 4,
    ctx.y + 4,
    pageWidth - margin * 2 - 8,
    headerHeight - 8
  );

  const innerLeft = margin + 14;
  const innerWidth = pageWidth - margin * 2 - 28;
  let yy = ctx.y + 22;

  // Eyebrow (department name).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, PALETTE.ink);
  doc.text(eyebrow, pageWidth / 2, yy, { align: "center" });
  yy += 16;

  // Main title (OFAC).
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
  };
  const palette = palettes[variant] || palettes.pass;

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

function drawCertification(ctx, text) {
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
  doc.text("COMPLIANCE CERTIFICATION", margin + padding, ctx.y + padding + 9);
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

function nowScreeningDate() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const STANDARD_FOOTER = [
  "Data Source: OFAC SDN List via OpenSanctions  ·  auto-refreshed daily.",
  "Generated by Compliance Central — Michigan Dealer Compliance Hub.",
];

const MDOS_FOOTER = [
  "Source: Michigan Department of State (MDOS) Portal  ·  Compliance Central.",
];

// ---------- OFAC PDF section ----------

async function drawOfacSection(ctx, customer, ofac, opts = {}) {
  const lastUpdate = await getSdnLastUpdate(ofac);
  const entries = ofac.entriesSearched
    ? ofac.entriesSearched.toLocaleString()
    : "N/A";

  drawOfficialHeader(ctx, {
    meta: [
      { label: "Report Generated", value: nowStamp() },
      { label: "Screening Date", value: nowScreeningDate() },
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
    variant: ofac.passed ? "pass" : "fail",
    title: ofac.passed ? "NO MATCH FOUND" : "POTENTIAL MATCH",
    subtitle: ofac.passed
      ? "Subject is NOT listed on the OFAC SDN List"
      : "REVIEW REQUIRED — Potential match found",
    extraLines:
      !ofac.passed && ofac.matches?.length
        ? [
            ...ofac.matches
              .slice(0, 5)
              .map((m) => {
                const conf = m.confidence
                  ? `   ·   ${OFAC_CONF_LABEL[m.confidence] || ""}`
                  : "";
                const dob = m.sdnBirthDate ? `   ·   SDN DOB ${m.sdnBirthDate}` : "";
                return `${m.name} — Score ${m.score}%${conf}${dob}   ·   Type ${m.type}`;
              }),
            ...(ofac.matches.length > 5
              ? [
                  `…and ${ofac.matches.length - 5} more potential match(es) — review the full list in the extension.`,
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

  drawCertification(
    ctx,
    "This screening was performed against the OFAC SDN List under U.S. Treasury regulations requiring screening of customers prior to consummating a financial transaction. This report serves as documented evidence of compliance efforts."
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
    writeText(ctx, "Official MDOS portal response:", {
      fontSize: 9,
      bold: true,
      color: PALETTE.muted,
    });
    ctx.y += 2;
    drawScreenshotPage(ctx, ensureDataUrl(screenshot), { reserveFooter: true });
  } else {
    writeText(
      ctx,
      "The MDOS portal screenshot was not captured for this check; the result above reflects the portal response.",
      { fontSize: 9, italic: true, color: PALETTE.muted }
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

  drawScreenshotPage(ctx, ensureDataUrl(screenshot), { reserveFooter: true });
  drawFooter(ctx, footerLines);
}

/** A combined-report section that renders the actual Repeat Offender portal
 * capture when a screenshot exists, else a labeled summary. */
function repeatSection(ro, person, title, subjectLabel) {
  if (ro?.screenshotData) {
    return {
      orientation: "portrait",
      render: (ctx) =>
        drawPortalCapture(ctx, {
          title,
          metaLine: `Customer: ${subjectFullName(person)}   ·   DLN/PID: ${person?.dlnPid || "—"}   ·   Captured: ${nowStamp()}`,
          screenshot: ro.screenshotData,
        }),
    };
  }
  return {
    orientation: "portrait",
    render: (ctx) =>
      drawMdosResultSection(ctx, {
        title,
        meta: [{ label: "Date", value: nowStamp() }],
        subject: {
          title: subjectLabel,
          rows: [
            { label: "Full Name", value: subjectFullName(person) },
            { label: "Date of Birth", value: person?.dob },
            { label: "Driver License / PID", value: person?.dlnPid },
          ],
        },
        result: repeatOffenderResultArgs(ro),
        screenshot: null,
      }),
  };
}

/** A combined-report section that renders the actual Title & Lien portal
 * capture when a screenshot exists, else a labeled summary. */
function titleSection(t, customer) {
  const vin = customer?.tradeVin || "N/A";
  const vehicle = [t?.year, t?.make, t?.model].filter(Boolean).join(" ");
  if (t?.screenshotData) {
    return {
      orientation: "portrait",
      render: (ctx) =>
        drawPortalCapture(ctx, {
          title: "Michigan Title & Lien Check",
          metaLine: `VIN: ${vin}${vehicle ? "   ·   " + vehicle : ""}   ·   Captured: ${nowStamp()}`,
          screenshot: t.screenshotData,
        }),
    };
  }
  return {
    orientation: "portrait",
    render: (ctx) =>
      drawMdosResultSection(ctx, {
        title: "Michigan Title & Lien Check",
        meta: [{ label: "Date", value: nowStamp() }],
        subject: { title: "TRADE-IN VEHICLE", rows: titleSubjectRows(t, vin) },
        result: titleResultArgs(t),
        screenshot: null,
      }),
  };
}

/** Result-box args for a Repeat Offender check (eligible/ineligible). */
function repeatOffenderResultArgs(ro) {
  return {
    variant: ro?.passed ? "pass" : "fail",
    title: ro?.passed ? "ELIGIBLE" : "NOT ELIGIBLE",
    subtitle: ro?.passed
      ? "No repeat-offender or ex parte records found — eligible to purchase."
      : ro?.message ||
        ro?.rawText ||
        "Repeat-offender or ex parte record found — review before proceeding.",
  };
}

/** Result-box args for a Title/Lien check (clear / branded / lien). */
function titleResultArgs(t) {
  const brand =
    t?.titleBrand &&
    !["CLEAN", "UNKNOWN", "NONE"].includes(String(t.titleBrand).toUpperCase())
      ? String(t.titleBrand).toUpperCase()
      : null;
  if (t?.hasLien) {
    const holder = cleanLienHolder(t.lienHolder);
    return {
      variant: "warn",
      title: "ACTIVE LIEN",
      subtitle: holder
        ? `Lienholder: ${holder} — payoff required before sale.`
        : `${formatLienStatus(t.lienStatus, true)} — payoff / lien release required before sale.`,
    };
  }
  if (brand) {
    return {
      variant: "warn",
      title: `${brand} TITLE`,
      subtitle: "Branded title — requires disclosure before sale.",
    };
  }
  return {
    variant: "pass",
    title: "CLEAR TITLE",
    subtitle: "No title brands or active liens reported.",
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
  const checks = currentResults.checks || {};
  const coBuyer = customer?.coBuyer;

  // Build the section list. OFAC renders its official letterhead; the MDOS/SOS
  // checks render the actual portal capture (the page the dealer would print).
  // All pages are portrait.
  const sections = [];

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

  const ro = checks.repeatOffender;
  if (ro && !ro.error && ro.status !== "error" && ro.status !== "not_applicable") {
    sections.push(
      repeatSection(ro, customer, "Michigan Repeat Offender Check", "SUBJECT SCREENED")
    );
  }

  const cbRo = checks.coBuyerRepeatOffender;
  if (cbRo && !cbRo.error && cbRo.status !== "error" && cbRo.status !== "not_applicable" && coBuyer) {
    sections.push(
      repeatSection(
        cbRo,
        coBuyer,
        "Michigan Repeat Offender Check (Co-Buyer)",
        "CO-BUYER SCREENED"
      )
    );
  }

  if (checks.title && !checks.title.error) {
    sections.push(titleSection(checks.title, customer));
  }

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


function repeatReportHTML(currentResults, isCoBuyer = false) {
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
    .mdos-banner { background: #137078; color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; border-radius: 4px 4px 0 0; }
    .mdos-logo { display: flex; align-items: center; gap: 10px; font-weight: bold; }
    .mdos-links { font-size: 11px; }
    .mdos-links a { color: white; text-decoration: none; margin-left: 10px; }
    .breadcrumb { padding: 10px 20px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-size: 11px; color: #137078; font-weight: bold; }
    .content-box { border: 1px solid #e5e7eb; border-top: none; padding: 24px; background: #fff; border-radius: 0 0 4px 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
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
  </style>
</head>
<body>
  ${getRepeatReportPageHTML(currentResults, isCoBuyer)}
</body>
</html>`;
}

function titleReportHTML(currentResults) {
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
    .mdos-banner { background: #137078; color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; border-radius: 4px 4px 0 0; }
    .mdos-logo { display: flex; align-items: center; gap: 10px; font-weight: bold; }
    .mdos-links { font-size: 11px; }
    .mdos-links a { color: white; text-decoration: none; margin-left: 10px; }
    .breadcrumb { padding: 10px 20px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-size: 11px; color: #137078; font-weight: bold; }
    .content-box { border: 1px solid #e5e7eb; border-top: none; padding: 24px; background: #fff; border-radius: 0 0 4px 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .section-title { font-size: 16px; font-weight: bold; color: #111827; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    .vin-search-info { border-left: 3px solid #137078; padding-left: 10px; font-size: 11px; color: #374151; margin-bottom: 20px; font-weight: 500; }
    .vin-search-info strong { color: #111827; }
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
  </style>
</head>
<body>
  ${getTitleReportPageHTML(currentResults)}
</body>
</html>`;
}
