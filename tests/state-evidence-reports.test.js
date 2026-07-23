import assert from "node:assert/strict";
import test from "node:test";

import {
  combinedAllReportHTML,
  getRepeatReportPageHTML,
  getTitleReportPageHTML,
  repeatReportHTML,
  repeatSection,
  stateEvidenceDataUrl,
  titleReportHTML,
  titleSection,
} from "../src/sidepanel/export.js";

const REPEAT_SCREENSHOT = "data:image/png;base64,UkVQRUFU";
const COBUYER_SCREENSHOT = "data:image/png;base64,Q09CVVlFUg==";
const TITLE_SCREENSHOT = "data:image/png;base64,VElUTEU=";

function reportFixture() {
  return {
    timestamp: "2026-07-22T12:00:00.000Z",
    customer: {
      firstName: "Jamie",
      lastName: "Dealer",
      dob: "01/02/1980",
      dlnPid: "S123456789012",
      tradeVin: "1HGBH41JXMN109186",
      coBuyer: {
        firstName: "Taylor",
        lastName: "Buyer",
        dob: "03/04/1981",
        dlnPid: "B123456789012",
      },
    },
    checks: {
      repeatOffender: {
        passed: true,
        status: "eligible",
        screenshotData: REPEAT_SCREENSHOT,
        timestamp: "2026-07-22T12:01:00.000Z",
      },
      coBuyerRepeatOffender: {
        passed: true,
        status: "eligible",
        screenshotData: COBUYER_SCREENSHOT,
        timestamp: "2026-07-22T12:02:00.000Z",
      },
      title: {
        passed: true,
        titleStatus: "Clear",
        titleBrand: "CLEAN",
        hasLien: false,
        vehicleBrands: [],
        screenshotData: TITLE_SCREENSHOT,
        timestamp: "2026-07-22T12:03:00.000Z",
      },
    },
  };
}

function pdfContext() {
  const calls = { images: [], text: [] };
  const doc = {
    addImage: (...args) => calls.images.push(args),
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

test("validates state screenshot data before any report embeds it", () => {
  assert.equal(
    stateEvidenceDataUrl({ screenshotData: REPEAT_SCREENSHOT }),
    REPEAT_SCREENSHOT
  );
  assert.equal(stateEvidenceDataUrl({ screenshotData: "not an image" }), null);
  assert.equal(
    stateEvidenceDataUrl({
      screenshotData: 'data:image/png;base64,UkVQRUFU" onerror="alert(1)',
    }),
    null
  );
});

test("Repeat and Title HTML include the actual captured state webpage", () => {
  const results = reportFixture();
  const repeat = getRepeatReportPageHTML(results);
  const title = getTitleReportPageHTML(results);

  for (const [html, screenshot] of [
    [repeat, REPEAT_SCREENSHOT],
    [title, TITLE_SCREENSHOT],
  ]) {
    assert.match(html, /Actual Michigan state-site screenshot/);
    assert.match(html, /https:\/\/dsvsesvc\.sos\.state\.mi\.us\//);
    assert.match(html, /state webpage, not a recreated mockup/);
    assert.ok(html.includes(`<img src="${screenshot}"`));
    assert.doesNotMatch(html, /class="mdos-banner"|class="breadcrumb"/);
  }
});

test("standalone and combined print HTML preserve every state-site capture", () => {
  const results = reportFixture();
  const repeat = repeatReportHTML(results);
  const title = titleReportHTML(results);
  const combined = combinedAllReportHTML(results);

  assert.ok(repeat.includes(REPEAT_SCREENSHOT));
  assert.ok(title.includes(TITLE_SCREENSHOT));
  for (const screenshot of [
    REPEAT_SCREENSHOT,
    COBUYER_SCREENSHOT,
    TITLE_SCREENSHOT,
  ]) {
    assert.ok(combined.includes(screenshot));
  }
  assert.match(repeat, /page-break-before: always/);
  assert.match(title, /page-break-before: always/);
  assert.doesNotMatch(combined, /class="mdos-banner"|class="breadcrumb"/);
});

test("HTML fallback is prominent and never presents an app summary as a state page", () => {
  const results = reportFixture();
  delete results.checks.repeatOffender.screenshotData;
  const html = getRepeatReportPageHTML(results);

  assert.match(html, /Actual Michigan state-site screenshot unavailable/);
  assert.match(html, /app-generated summary, not a Michigan Department of State webpage/);
  assert.match(html, /Re-run the check before relying on it/);
  assert.doesNotMatch(html, /<img\b/);
});

test("Repeat and Title PDF sections embed the validated real captures", () => {
  const results = reportFixture();
  const repeatPdf = pdfContext();
  const titlePdf = pdfContext();

  repeatSection(
    results.checks.repeatOffender,
    results.customer,
    "Michigan Repeat Offender Check",
    "SUBJECT SCREENED"
  ).render(repeatPdf.ctx);
  titleSection(results.checks.title, results.customer).render(titlePdf.ctx);

  assert.equal(repeatPdf.calls.images.length, 1);
  assert.equal(repeatPdf.calls.images[0][0], REPEAT_SCREENSHOT);
  assert.equal(titlePdf.calls.images.length, 1);
  assert.equal(titlePdf.calls.images[0][0], TITLE_SCREENSHOT);
  for (const textCalls of [repeatPdf.calls.text, titlePdf.calls.text]) {
    assert.ok(textCalls.includes("ACTUAL MICHIGAN STATE-SITE SCREENSHOT"));
    assert.ok(textCalls.includes("Captured from https://dsvsesvc.sos.state.mi.us/"));
  }
});

test("PDF fallback labels missing or invalid state evidence honestly", () => {
  const results = reportFixture();
  const fallbackPdf = pdfContext();
  results.checks.repeatOffender.screenshotData = "invalid screenshot";

  repeatSection(
    results.checks.repeatOffender,
    results.customer,
    "Michigan Repeat Offender Check",
    "SUBJECT SCREENED"
  ).render(fallbackPdf.ctx);

  assert.equal(fallbackPdf.calls.images.length, 0);
  assert.ok(
    fallbackPdf.calls.text.includes(
      "ACTUAL MICHIGAN STATE-SITE SCREENSHOT UNAVAILABLE"
    )
  );
  assert.ok(
    fallbackPdf.calls.text.some((value) =>
      value.includes("app-generated summary, not a Michigan Department of State webpage")
    )
  );
});
