import assert from "node:assert/strict";
import test from "node:test";

import {
  REPORT_KEYS,
  availableReportItems,
  buildStoredZipArchive,
  combinedPdfFileName,
  combinedAllReportHTML,
  combinedPdfSections,
  normalizeReportSelection,
  ofacReportHTML,
  ofacResultArgs,
  reportPdfEntries,
  reportDecisionSummary,
  separatePdfsZipFileName,
} from "../src/sidepanel/export.js";

function resultFixture() {
  return {
    timestamp: "2026-07-22T12:00:00.000Z",
    customer: {
      firstName: "Jamie",
      lastName: "Dealer",
      dob: "01/02/1980",
      dlnPid: "S123456789012",
      tradeVin: "1HGBH41JXMN109186",
    },
    checks: {
      ofac: {
        passed: false,
        status: "error",
        error: "SDN service unavailable",
      },
      repeatOffender: {
        passed: null,
        status: "not_applicable",
        message: "Out-of-state ID",
      },
      title: {
        passed: false,
        status: "error",
        error: "Title service unavailable",
      },
    },
  };
}

function pdfContext() {
  const calls = { text: [] };
  const doc = {
    addImage() {},
    addPage() {},
    getImageProperties: () => ({ width: 1280, height: 1800 }),
    // The running head measures each half of a "label: value" pair so the two
    // cannot overprint; the double needs the same call jsPDF provides.
    getTextWidth: (value) => String(value).length * 5,
    line() {},
    rect() {},
    roundedRect() {},
    setDrawColor() {},
    setFillColor() {},
    setFont() {},
    setFontSize() {},
    setLineWidth() {},
    setTextColor() {},
    splitTextToSize: (value) => [String(value)],
    text: (value) => calls.text.push(String(value)),
  };
  return {
    calls,
    ctx: {
      doc,
      pageWidth: 612,
      pageHeight: 792,
      margin: 40,
      y: 40,
    },
  };
}

test("OFAC service errors render unavailable and never as a potential match", () => {
  const ofac = {
    passed: false,
    status: "error",
    error: "SDN service unavailable",
  };
  const outcome = ofacResultArgs(ofac);
  assert.equal(outcome.variant, "warn");
  assert.equal(outcome.title, "RESULT UNAVAILABLE");

  const html = ofacReportHTML({
    customer: { firstName: "Jamie", lastName: "Dealer" },
    ofac,
    lastUpdate: "Unknown",
  });
  assert.match(html, /RESULT UNAVAILABLE/);
  assert.match(html, /SDN service unavailable/);
  assert.doesNotMatch(html, /POTENTIAL MATCH/);
});

test("combined HTML starts with final decision and names unavailable and not-applicable checks", () => {
  const results = resultFixture();
  const html = combinedAllReportHTML(results);

  assert.ok(
    html.indexOf("Overall Compliance Decision") <
      html.indexOf("Compliance Central OFAC Screening Record")
  );
  assert.match(html, /REVIEW REQUIRED/);
  assert.match(html, /Incomplete checks/);
  assert.match(html, /Buyer OFAC[\s\S]*UNAVAILABLE/);
  assert.match(html, /Buyer Repeat Offender[\s\S]*NOT APPLICABLE/);
  assert.match(html, /Title \/ Lien[\s\S]*UNAVAILABLE/);
  assert.doesNotMatch(html, /POTENTIAL MATCH/);
});

test("combined report preserves a confirmed denial despite another unavailable check", () => {
  const results = resultFixture();
  results.checks.ofac = {
    passed: false,
    disposition: "confirmed_match",
    matches: [{ name: "Confirmed candidate" }],
  };
  const summary = reportDecisionSummary(results);
  const html = combinedAllReportHTML(results);

  assert.equal(summary.decision.level, "DENIED");
  assert.match(html, /decision-denied/);
  assert.match(html, /OFAC match confirmed/);
  assert.match(html, /Title \/ Lien[\s\S]*UNAVAILABLE/);
});

test("combined OFAC pages preserve readable potential-match details", () => {
  const results = resultFixture();
  results.checks.ofac = {
    passed: false,
    matchCount: 7,
    matches: [
      {
        name: "Example & Person",
        score: 97,
        confidence: "high",
        sdnBirthDate: "1980",
        type: "Individual",
      },
    ],
  };
  const html = combinedAllReportHTML(results);

  assert.match(html, /Example &amp; Person/);
  assert.match(html, /Score: 97%/);
  assert.match(html, /DOB match/);
  assert.match(html, /SDN DOB 1980/);
  assert.match(html, /6 additional potential match/);
  assert.doesNotMatch(html, /Example & Person/);
});

test("combined PDF assembly includes summary plus Repeat and Title non-success pages", async () => {
  const results = resultFixture();
  const sections = combinedPdfSections(results);
  assert.equal(sections.length, 4);

  const summaryPdf = pdfContext();
  const repeatPdf = pdfContext();
  const titlePdf = pdfContext();
  await sections[0].render(summaryPdf.ctx);
  await sections[2].render(repeatPdf.ctx);
  await sections[3].render(titlePdf.ctx);

  assert.ok(summaryPdf.calls.text.includes("Overall Compliance Decision"));
  assert.ok(summaryPdf.calls.text.includes("INCOMPLETE CHECKS"));
  assert.ok(
    summaryPdf.calls.text.some((value) =>
      value.includes("Buyer OFAC: UNAVAILABLE")
    )
  );
  assert.ok(repeatPdf.calls.text.includes("NOT APPLICABLE"));
  assert.ok(titlePdf.calls.text.includes("TITLE RESULT NEEDS REVIEW"));
  assert.ok(
    titlePdf.calls.text.some((value) =>
      value.includes("Title service unavailable")
    )
  );
});

test("bulk print and PDF selection resolve through one ordered report manifest", () => {
  const results = resultFixture();
  const available = availableReportItems(results).map((item) => item.key);
  assert.deepEqual(available, [
    REPORT_KEYS.decision,
    REPORT_KEYS.buyerOfac,
    REPORT_KEYS.buyerRepeat,
    REPORT_KEYS.title,
  ]);

  const requested = [
    REPORT_KEYS.title,
    REPORT_KEYS.buyerOfac,
    REPORT_KEYS.title,
    "not-a-report",
  ];
  const normalized = normalizeReportSelection(results, requested);
  assert.deepEqual(normalized, [REPORT_KEYS.buyerOfac, REPORT_KEYS.title]);

  const entries = reportPdfEntries(results, requested, 12345);
  assert.deepEqual(
    entries.map((entry) => entry.key),
    normalized
  );
  assert.equal(combinedPdfSections(results, requested).length, entries.length);
  assert.match(entries[0].fileName, /^OFAC_Jamie_Dealer_12345\.pdf$/);
  assert.match(entries[1].fileName, /^Title_1HGBH41JXMN109186_12345\.pdf$/);

  const html = combinedAllReportHTML(results, requested);
  assert.match(html, /Compliance Central OFAC Screening Record/);
  assert.match(html, /Michigan Title & Lien Check/);
  assert.doesNotMatch(html, /Overall Compliance Decision/);
  assert.doesNotMatch(html, /Michigan Repeat Offender Check/);
});

test("an empty bulk selection produces no report pages", () => {
  const results = resultFixture();
  assert.deepEqual(normalizeReportSelection(results, []), []);
  assert.deepEqual(reportPdfEntries(results, []), []);
  assert.deepEqual(combinedPdfSections(results, []), []);
  assert.doesNotMatch(combinedAllReportHTML(results, []), /class="page /);
});

test("separate PDF downloads form one valid ZIP archive", () => {
  const archive = buildStoredZipArchive(
    [
      { name: "Buyer OFAC.pdf", data: new TextEncoder().encode("hello") },
      { name: "Title.pdf", data: new Uint8Array([1, 2, 3, 4]) },
    ],
    new Date("2026-08-14T12:00:00")
  );
  const view = new DataView(archive.buffer);
  const end = archive.length - 22;
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0x3610a686);
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const centralOffset = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
  const decoded = new TextDecoder().decode(archive);
  assert.match(decoded, /Buyer OFAC\.pdf/);
  assert.match(decoded, /Title\.pdf/);
});

test("bulk download filenames are safe, distinct, and never blank", () => {
  const results = resultFixture();
  results.customer.firstName = "Jamie / QA";
  results.customer.lastName = "Dealer & Co.";

  assert.equal(
    combinedPdfFileName(results, 12345),
    "Compliance_Jamie_QA_Dealer_Co_12345.pdf"
  );
  assert.equal(
    separatePdfsZipFileName(results, 12345),
    "Compliance_PDFs_Jamie_QA_Dealer_Co_12345.zip"
  );
  assert.equal(combinedPdfFileName({}, 12345), "Compliance_Record_12345.pdf");
  assert.equal(
    separatePdfsZipFileName({}, 12345),
    "Compliance_PDFs_Record_12345.zip"
  );
});

test("no trade-in is explicitly not applicable rather than incomplete", () => {
  const results = resultFixture();
  results.customer.tradeVin = "";
  delete results.checks.title;
  results.checks.ofac = { passed: true };
  results.checks.repeatOffender = { passed: true, status: "eligible" };

  const summary = reportDecisionSummary(results);
  const titleRow = summary.rows.find((row) => row.label === "Title / Lien");
  assert.equal(titleRow.state, "NOT APPLICABLE");
  assert.equal(titleRow.incomplete, false);
  assert.equal(summary.decision.level, "APPROVED");
});
