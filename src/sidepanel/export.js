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

const PRINT_TIMEOUT_MS = 5 * 60 * 1000;

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
                `<li>${sanitizeHTML(m.name)} (Score: ${sanitizeHTML(m.score)}%, Type: ${sanitizeHTML(m.type)})</li>`
            )
            .join("")}</ul></div>`
        : ""
    }
  </div>
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

  if (repeatOffender?.screenshotData) {
    sections.push(
      screenshotBlock(
        "Michigan Repeat Offender Check",
        [
          `<strong>Customer:</strong> ${sanitizeHTML(customer?.firstName || "")} ${sanitizeHTML(customer?.lastName || "")}`,
        ],
        repeatOffender.screenshotData
      )
    );
  }

  if (cbRepeat?.screenshotData && coBuyer) {
    sections.push(
      screenshotBlock(
        "Michigan Repeat Offender Check (Co-Buyer)",
        [
          `<strong>Co-Buyer:</strong> ${sanitizeHTML(coBuyer.firstName || "")} ${sanitizeHTML(coBuyer.lastName || "")}`,
        ],
        cbRepeat.screenshotData
      )
    );
  }

  if (title?.screenshotData) {
    sections.push(
      screenshotBlock(
        "Michigan Title & Lien Check",
        [`<strong>VIN:</strong> ${sanitizeHTML(customer?.tradeVin || "N/A")}`],
        title.screenshotData
      )
    );
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
  const screenshot = currentResults?.checks?.repeatOffender?.screenshotData;
  if (!screenshot) {
    showToast("No Repeat Offender screenshot available.", "info");
    return;
  }
  const c = currentResults.customer;
  openAndPrint(
    screenshotReportHTML({
      heading: "Michigan Repeat Offender Check",
      subjectLines: [
        `<strong>Customer:</strong> ${sanitizeHTML(c?.firstName || "")} ${sanitizeHTML(c?.lastName || "")}`,
      ],
      screenshotData: screenshot,
      orientation: "landscape",
    }),
    true
  );
}

export function printCoBuyerRepeatScreenshot(currentResults) {
  const screenshot = currentResults?.checks?.coBuyerRepeatOffender?.screenshotData;
  const coBuyer = currentResults?.customer?.coBuyer;
  if (!screenshot || !coBuyer) {
    showToast("No Co-Buyer Repeat Offender screenshot available.", "info");
    return;
  }
  openAndPrint(
    screenshotReportHTML({
      heading: "Michigan Repeat Offender Check (Co-Buyer)",
      subjectLines: [
        `<strong>Co-Buyer:</strong> ${sanitizeHTML(coBuyer.firstName || "")} ${sanitizeHTML(coBuyer.lastName || "")} ${sanitizeHTML(coBuyer.suffix || "")}`,
      ],
      screenshotData: screenshot,
      orientation: "landscape",
    }),
    true
  );
}

export function printTitleScreenshot(currentResults) {
  const screenshot = currentResults?.checks?.title?.screenshotData;
  if (!screenshot) {
    showToast("No Title/Lien screenshot available.", "info");
    return;
  }
  const vin = currentResults.customer?.tradeVin || "N/A";
  openAndPrint(
    screenshotReportHTML({
      heading: "Michigan Title & Lien Check",
      subjectLines: [`<strong>VIN:</strong> ${sanitizeHTML(vin)}`],
      screenshotData: screenshot,
      orientation: "portrait",
    }),
    true
  );
}

export function printAllReports(currentResults) {
  if (!currentResults) {
    showToast("No results to print.", "info");
    return;
  }
  openAndPrint(combinedAllReportHTML(currentResults), true);
}

// ---------- PDF download (jsPDF) ----------

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

function fmtSummaryLine(label, value) {
  return `${label}: ${value || "—"}`;
}

export async function downloadAllReportsPDF(currentResults) {
  if (!currentResults) {
    showToast("No results to download.", "info");
    return;
  }

  let JsPDF;
  try {
    JsPDF = await loadJsPDF();
  } catch (err) {
    console.error("jsPDF load error:", err);
    showToast("Could not load PDF library. Try the Print button instead.", "error");
    return;
  }

  const customer = currentResults.customer;
  const checks = currentResults.checks || {};
  const decision = currentResults.finalDecision;
  const timestamp = new Date().toLocaleString();
  const safeName = `${customer.firstName || ""}_${customer.lastName || ""}`
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "");

  const doc = new JsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  let y = margin;

  const writeLine = (text, opts = {}) => {
    const fontSize = opts.fontSize || 11;
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    if (opts.color) doc.setTextColor(...opts.color);
    else doc.setTextColor(0, 0, 0);
    const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += fontSize * 1.3;
    }
  };

  const drawSeparator = () => {
    if (y > pageHeight - margin - 10) {
      doc.addPage();
      y = margin;
      return;
    }
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 12;
  };

  // Cover.
  writeLine("Compliance Central — Deal Jacket", { fontSize: 18, bold: true, color: [30, 58, 95] });
  writeLine(timestamp, { fontSize: 10, color: [100, 100, 100] });
  y += 8;

  drawSeparator();
  writeLine("Customer", { fontSize: 13, bold: true, color: [30, 58, 95] });
  writeLine(fmtSummaryLine("Name", buildSanitizedName(customer).replace(/&amp;/g, "&")));
  writeLine(fmtSummaryLine("Date of Birth", customer.dob));
  writeLine(fmtSummaryLine("DLN / PID", customer.dlnPid));
  if (customer.tradeVin) writeLine(fmtSummaryLine("Trade VIN", customer.tradeVin));

  if (customer.coBuyer && customer.hasCoBuyer) {
    y += 6;
    writeLine("Co-Buyer", { fontSize: 13, bold: true, color: [30, 58, 95] });
    const co = customer.coBuyer;
    writeLine(
      fmtSummaryLine("Name", `${co.firstName || ""} ${co.middleName || ""} ${co.lastName || ""} ${co.suffix || ""}`.replace(/\s+/g, " ").trim())
    );
    writeLine(fmtSummaryLine("Date of Birth", co.dob));
    writeLine(fmtSummaryLine("DLN / PID", co.dlnPid));
  }

  y += 8;
  drawSeparator();
  writeLine("Decision", { fontSize: 13, bold: true, color: [30, 58, 95] });
  if (decision) {
    const color =
      decision.level === "APPROVED"
        ? [6, 95, 70]
        : decision.level === "REVIEW"
        ? [146, 64, 14]
        : [153, 27, 27];
    writeLine(decision.level, { fontSize: 18, bold: true, color });
    writeLine(decision.reason, { fontSize: 11 });
    if (decision.warnings?.length) {
      for (const w of decision.warnings) writeLine("• " + w, { fontSize: 10, color: [146, 64, 14] });
    }
  }

  y += 8;
  drawSeparator();
  writeLine("Check Results", { fontSize: 13, bold: true, color: [30, 58, 95] });

  const passColor = [6, 95, 70];
  const failColor = [153, 27, 27];
  const warnColor = [146, 64, 14];

  if (checks.ofac) {
    writeLine("OFAC (Buyer)", { fontSize: 12, bold: true });
    writeLine(
      checks.ofac.passed ? "Pass — no SDN matches" : `Failed — ${checks.ofac.matches?.length || 0} potential match(es)`,
      { fontSize: 10, color: checks.ofac.passed ? passColor : failColor }
    );
    if (!checks.ofac.passed && checks.ofac.matches?.length) {
      for (const m of checks.ofac.matches.slice(0, 5)) {
        writeLine(`• ${m.name} — score ${m.score}, type ${m.type}`, { fontSize: 9 });
      }
    }
    y += 4;
  }

  if (checks.coBuyerOfac) {
    writeLine("OFAC (Co-Buyer)", { fontSize: 12, bold: true });
    writeLine(
      checks.coBuyerOfac.passed ? "Pass — no SDN matches" : `Failed — ${checks.coBuyerOfac.matches?.length || 0} potential match(es)`,
      { fontSize: 10, color: checks.coBuyerOfac.passed ? passColor : failColor }
    );
    y += 4;
  }

  if (checks.repeatOffender) {
    writeLine("Repeat Offender (Buyer)", { fontSize: 12, bold: true });
    if (checks.repeatOffender.status === "error") {
      writeLine(`Error: ${checks.repeatOffender.error || "Unknown"}`, { fontSize: 10, color: warnColor });
    } else {
      writeLine(
        checks.repeatOffender.passed ? "Pass — eligible" : `Failed — ${checks.repeatOffender.status}`,
        { fontSize: 10, color: checks.repeatOffender.passed ? passColor : failColor }
      );
    }
    y += 4;
  }

  if (checks.coBuyerRepeatOffender) {
    writeLine("Repeat Offender (Co-Buyer)", { fontSize: 12, bold: true });
    writeLine(
      checks.coBuyerRepeatOffender.passed
        ? "Pass — eligible"
        : `Failed — ${checks.coBuyerRepeatOffender.status}`,
      { fontSize: 10, color: checks.coBuyerRepeatOffender.passed ? passColor : failColor }
    );
    y += 4;
  }

  if (checks.title) {
    writeLine("Title & Lien", { fontSize: 12, bold: true });
    if (checks.title.error) {
      writeLine(`Error: ${checks.title.error}`, { fontSize: 10, color: warnColor });
    } else {
      writeLine(
        `Brand: ${checks.title.titleBrand || "CLEAN"}${checks.title.titleType ? " — Type: " + checks.title.titleType : ""}`,
        { fontSize: 10 }
      );
      writeLine(`Lien: ${checks.title.lienStatus || "Unknown"}`, { fontSize: 10 });
      if (checks.title.year && checks.title.make && checks.title.model) {
        writeLine(`Vehicle: ${checks.title.year} ${checks.title.make} ${checks.title.model}`, { fontSize: 10 });
      }
    }
  }

  // Embed screenshots on separate pages.
  const embedScreenshot = async (label, base64) => {
    if (!base64) return;
    const dataUrl = ensureDataUrl(base64);
    doc.addPage();
    y = margin;
    writeLine(label, { fontSize: 14, bold: true, color: [30, 58, 95] });
    y += 4;
    try {
      const imgProps = doc.getImageProperties(dataUrl);
      const usableW = pageWidth - margin * 2;
      const ratio = imgProps.height / imgProps.width;
      let renderW = usableW;
      let renderH = renderW * ratio;
      const maxH = pageHeight - margin * 2 - 32;
      if (renderH > maxH) {
        renderH = maxH;
        renderW = renderH / ratio;
      }
      doc.addImage(dataUrl, "PNG", margin, y, renderW, renderH);
    } catch (err) {
      console.error("PDF image error:", err);
      writeLine("Screenshot could not be embedded.", { fontSize: 10, color: warnColor });
    }
  };

  await embedScreenshot("Repeat Offender (Buyer)", checks.repeatOffender?.screenshotData);
  await embedScreenshot(
    "Repeat Offender (Co-Buyer)",
    checks.coBuyerRepeatOffender?.screenshotData
  );
  await embedScreenshot("Title & Lien", checks.title?.screenshotData);

  doc.save(`compliance-${safeName || "report"}-${Date.now()}.pdf`);
}
