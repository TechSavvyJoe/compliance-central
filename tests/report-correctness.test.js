import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  REPORT_KEYS,
  availableReportItems,
  buildStoredZipArchive,
  combinedPdfFileName,
  combinedAllReportHTML,
  combinedPdfSections,
  normalizeReportBranding,
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
    // A verdict draws its own glyph: neither mark exists in the shipped faces.
    circle() {},
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
  // The masthead escapes its title now that it is assembled rather than
  // written straight into the markup.
  assert.match(html, /Michigan Title &amp; Lien Check/);
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

// A dealership files and emails these records, so the sheet should read as
// that dealership's paperwork. The name and logo are a per-install setting: a
// publicly listed extension must never ship one store's name or a
// manufacturer's trade dress, and every document has to look finished with
// neither set.
const LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("every screening report carries the dealership's own masthead", () => {
  const results = resultFixture();
  const branded = combinedAllReportHTML(results, null, {
    dealerName: "Delaney Motors",
    logoUrl: LOGO,
  });

  // The store leads and the record's own title follows on all four pages.
  assert.equal((branded.match(/class="brand-masthead"/g) || []).length, 4);
  assert.equal(
    (branded.match(/class="brand-name">Delaney Motors</g) || []).length,
    4
  );
  assert.equal((branded.match(/class="brand-title"/g) || []).length, 4);
  assert.ok(branded.includes(`src="${LOGO}"`));
  // The logo is labelled with the store it belongs to, not "image".
  assert.match(branded, /alt="Delaney Motors"/);
  assert.match(branded, /class="brand-title">Overall Compliance Decision</);
  // Compliance Central stays on the page as the system that made the record.
  assert.match(branded, /Generated by Compliance Central/);
});

test("an unbranded report is the same document without a hole in it", () => {
  const results = resultFixture();
  const plain = combinedAllReportHTML(results);

  assert.doesNotMatch(plain, /class="brand-masthead"/);
  assert.doesNotMatch(plain, /class="brand-name"/);
  assert.doesNotMatch(plain, /<img/);
  // The masthead falls back to exactly the one it always had.
  assert.match(plain, /class="main-title">Overall Compliance Decision<\/h1>/);

  // A name with no logo, and a logo with no name, each stand alone.
  const nameOnly = combinedAllReportHTML(results, null, { dealerName: "Delaney Motors" });
  assert.match(nameOnly, /class="brand-name">Delaney Motors</);
  assert.doesNotMatch(nameOnly, /<img/);
  const logoOnly = combinedAllReportHTML(results, null, { logoUrl: LOGO });
  assert.ok(logoOnly.includes(`src="${LOGO}"`));
  assert.doesNotMatch(logoOnly, /class="brand-name"/);
});

test("branding is a setting, and only an image we produced may be printed", () => {
  assert.deepEqual(
    normalizeReportBranding({ dealerName: "  Delaney Motors  ", logoUrl: LOGO }),
    { dealerName: "Delaney Motors", logoUrl: LOGO }
  );
  // A remote or scripted logo must never reach a printed sheet.
  for (const bad of [
    "https://example.com/logo.png",
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    undefined,
  ]) {
    assert.equal(normalizeReportBranding({ logoUrl: bad }).logoUrl, "");
  }
  assert.deepEqual(normalizeReportBranding(), { dealerName: "", logoUrl: "" });
  assert.equal(
    normalizeReportBranding({ dealerName: "x".repeat(200) }).dealerName.length,
    80
  );

  // No dealership may be compiled into a publicly listed extension.
  const source = readFileSync(
    new URL("../src/sidepanel/export.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /dealerName\s*=\s*"[A-Za-z]/);
  assert.match(source, /STORAGE_KEYS\.dealershipName/);
  assert.match(source, /STORAGE_KEYS\.dealershipLogo/);
});

test("a cleared OFAC record states what was screened, not just that nothing hit", () => {
  const results = resultFixture();
  results.checks.ofac = {
    passed: true,
    matches: [],
    entriesSearched: 18342,
    lastUpdate: "8/30/2026",
    publishDate: "2026-08-29",
  };
  const html = ofacReportHTML({
    customer: results.customer,
    ofac: results.checks.ofac,
    lastUpdate: "8/30/2026",
  });

  assert.match(html, /NO MATCH FOUND/);
  // The verdict carries a check, so a cleared result reads as a finding.
  assert.match(html, /class="verdict-icon"/);
  assert.match(html, /What was screened:/);
  assert.match(html, /Specially Designated Nationals \(SDN\) list/);
  assert.match(html, /retrieved 8\/30\/2026/);
  assert.match(html, /published by OFAC 2026-08-29/);
  assert.match(html, /18,342 entries were compared/);
  assert.match(html, /name-similarity threshold of 85% or higher/);
  // The reviewed certification paragraph is untouched.
  assert.match(html, /It is not an OFAC determination, legal advice, or a compliance certification\./);
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

// A screening record is handed to auditors and customers, so it must never
// assert something it does not know. The sentence used to read "retrieved
// Unknown" (the worker stores that literal string when the device has no
// retrieval date), and — precisely when the entry count was missing — claimed
// "Every entry on that list was compared", which is an unevidenced claim of
// full coverage.
test("the screening sentence states only what the result actually knows", async () => {
  const { screeningScopeSentence } = await import("../src/sidepanel/export.js");

  const known = screeningScopeSentence(
    { entriesSearched: 17342, threshold: 85, lastUpdate: "8/30/2026", publishDate: "8/29/2026" },
    null
  );
  assert.match(known, /retrieved 8\/30\/2026/);
  assert.match(known, /published by OFAC 8\/29\/2026/);
  assert.match(known, /17,342 entries were compared/);

  // No retrieval date: the clause goes, rather than printing the placeholder.
  const undated = screeningScopeSentence(
    { entriesSearched: 17342, threshold: 85, lastUpdate: "Unknown" },
    null
  );
  assert.doesNotMatch(undated, /Unknown/);
  assert.doesNotMatch(undated, /retrieved/);
  assert.match(undated, /17,342 entries were compared/);

  // No count: say so, never claim the whole list was covered.
  const uncounted = screeningScopeSentence({ threshold: 85, lastUpdate: "8/30/2026" }, null);
  assert.doesNotMatch(uncounted, /Every entry/i);
  assert.match(uncounted, /does not state how many/i);
  assert.match(uncounted, /threshold of 85% or higher/);

  // A zero count is not evidence of coverage either.
  const zero = screeningScopeSentence({ entriesSearched: 0, threshold: 85 }, null);
  assert.doesNotMatch(zero, /Every entry/i);
  assert.doesNotMatch(zero, /0 entries were compared/);
});
