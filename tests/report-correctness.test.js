import assert from "node:assert/strict";
import test from "node:test";

import {
  combinedAllReportHTML,
  combinedPdfSections,
  ofacReportHTML,
  ofacResultArgs,
  reportDecisionSummary,
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
    matches: [{ name: "Confirmed candidate" }],
  };
  const summary = reportDecisionSummary(results);
  const html = combinedAllReportHTML(results);

  assert.equal(summary.decision.level, "DENIED");
  assert.match(html, /decision-denied/);
  assert.match(html, /OFAC match found/);
  assert.match(html, /Title \/ Lien[\s\S]*UNAVAILABLE/);
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
