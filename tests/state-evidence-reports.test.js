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
  const calls = { addPages: 0, images: [], roundedRects: [], text: [] };
  const doc = {
    addImage: (...args) => calls.images.push(args),
    addPage() { calls.addPages++; },
    // A verdict draws its own glyph: neither mark exists in the shipped faces.
    circle() {},
    getImageProperties: () => ({ width: 1280, height: 1800 }),
    // The running head measures each half of a "label: value" pair so the two
    // cannot overprint; the double needs the same call jsPDF provides.
    getTextWidth: (value) => String(value).length * 5,
    line() {},
    rect() {},
    roundedRect: (...args) => calls.roundedRects.push(args),
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
    assert.match(html, /State-Site Capture/);
    assert.match(html, /https:\/\/dsvsesvc\.sos\.state\.mi\.us\//);
    assert.match(html, /Actual webpage captured/);
    assert.ok(html.includes(`src="${screenshot}"`));
    assert.match(html, /data-state-evidence-image/);
    assert.match(html, />1 page</);
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
  for (const html of [repeat, title, combined]) {
    assert.match(html, /class="page evidence-page state-evidence"/);
    assert.match(
      html,
      /\.page\s*\{[^}]*break-after:\s*page;[^}]*page-break-after:\s*always/
    );
    assert.doesNotMatch(html, /page-break-before:\s*always/);
    assert.doesNotMatch(html, /min-height:\s*90vh/);
  }
  assert.doesNotMatch(combined, /class="mdos-banner"|class="breadcrumb"/);
});

test("print layouts keep values inside aligned rows and leave optional names blank", () => {
  const results = reportFixture();
  delete results.checks.repeatOffender.screenshotData;
  const repeatPage = getRepeatReportPageHTML(results);
  const standalone = repeatReportHTML(results);
  const combined = combinedAllReportHTML(results);

  assert.match(
    repeatPage,
    /Middle Name<\/div>\s*<div class="form-value"><\/div>/
  );
  assert.match(
    repeatPage,
    /Suffix<\/div>\s*<div class="form-value"><\/div>/
  );
  assert.doesNotMatch(
    repeatPage,
    /(?:Middle Name|Suffix)<\/div>\s*<div class="form-value">Not provided/
  );

  for (const html of [standalone, combined]) {
    assert.match(html, /class="form-grid identity-grid"/);
    assert.match(html, /class="form-grid id-grid"/);
    assert.match(
      html,
      /\.identity-grid,\s*\.id-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
    );
    assert.match(html, /\.form-value\s*\{[^}]*min-height:\s*38px/);
    assert.match(html, /\.form-value\s*\{[^}]*height:\s*100%/);
    assert.match(html, /\.form-value\s*\{[^}]*overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(html, /\.form-value\s*\{[^}]*height:\s*18px/);
    assert.doesNotMatch(
      html,
      /\.form-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4/
    );
    assert.match(html, /print-color-adjust:\s*exact/);
  }
});

test("successful Michigan reports print as one authentic evidence sheet each", () => {
  const results = reportFixture();
  const repeat = repeatReportHTML(results);
  const title = titleReportHTML(results);

  for (const html of [repeat, title]) {
    assert.equal((html.match(/class="page(?:\s|")/g) || []).length, 1);
    assert.doesNotMatch(html, /class="page repeat-page"|class="page title-page"/);
    assert.match(
      html,
      /\.state-evidence img\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*max-width:\s*100%;[^}]*max-height:\s*8\.3in/
    );
    assert.match(
      html,
      /\.portal-footer\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*0/
    );
  }
});

test("HTML fallbacks stay on one page and never present an app summary as a state page", () => {
  const results = reportFixture();
  delete results.checks.repeatOffender.screenshotData;
  delete results.checks.title.screenshotData;
  const reports = [repeatReportHTML(results), titleReportHTML(results)];

  for (const html of reports) {
    assert.equal((html.match(/class="page(?:\s|")/g) || []).length, 1);
    assert.match(html, /Actual Michigan state-site screenshot unavailable/);
    assert.match(html, /app-generated summary, not a Michigan Department of State webpage/);
    assert.match(html, /Re-run the check before relying on it/);
    assert.doesNotMatch(html, /<img\b/);
  }
});

test("an unverified capture stays off the one-page fallback record", () => {
  const results = reportFixture();
  results.checks.repeatOffender.status = "unknown";
  results.checks.repeatOffender.passed = false;
  const html = repeatReportHTML(results);

  assert.equal((html.match(/class="page(?:\s|")/g) || []).length, 1);
  assert.match(html, /evidence could not be verified/i);
  assert.doesNotMatch(html, /<img\b/);
});

test("an unconfirmed Title/Lien capture stays off the HTML evidence record", () => {
  const results = reportFixture();
  results.checks.title.passed = false;
  results.checks.title.titleBrand = "UNKNOWN";
  const html = getTitleReportPageHTML(results);

  assert.equal((html.match(/class="page(?:\s|")/g) || []).length, 1);
  assert.match(html, /evidence could not be verified/i);
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
  assert.equal(repeatPdf.calls.addPages, 0);
  assert.equal(titlePdf.calls.addPages, 0);
  // The capture fills the sheet between the masthead and the footer. Its
  // ceiling is the same one the printed page applies (max-height: 8.3in), so a
  // portrait capture is height-limited: this 1280x1800 fixture lands near
  // 447pt wide in the PDF and 425pt on the printed sheet. It used to be drawn
  // at 501pt, wider than the printed sheet ever renders it.
  assert.ok(repeatPdf.calls.images[0][4] > 400);
  assert.ok(repeatPdf.calls.images[0][4] < 525.6, "never wider than the text column");
  for (const textCalls of [repeatPdf.calls.text, titlePdf.calls.text]) {
    assert.ok(
      textCalls.includes("ACTUAL MICHIGAN STATE-SITE CAPTURE · ONE-PAGE RECORD")
    );
    assert.ok(
      textCalls.some((value) => value.includes("dsvsesvc.sos.state.mi.us"))
    );
  }
});

test("PDF embedding preserves the backend JPEG format", () => {
  const results = reportFixture();
  results.checks.repeatOffender.screenshotData =
    "data:image/jpeg;base64,UkVQRUFU";
  const pdf = pdfContext();

  repeatSection(
    results.checks.repeatOffender,
    results.customer,
    "Michigan Repeat Offender Check",
    "SUBJECT SCREENED"
  ).render(pdf.ctx);

  assert.equal(pdf.calls.images[0][1], "JPEG");
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
  // The download says word for word what the printed sheet says.
  assert.ok(
    fallbackPdf.calls.text.includes(
      "Actual Michigan state-site screenshot unavailable."
    )
  );
  assert.ok(
    fallbackPdf.calls.text.some((value) =>
      value.includes("app-generated summary, not a Michigan Department of State webpage")
    )
  );
});

test("PDF fallbacks never embed unconfirmed Michigan captures", () => {
  const results = reportFixture();
  results.checks.repeatOffender.status = "unknown";
  results.checks.repeatOffender.passed = false;
  results.checks.title.passed = false;
  results.checks.title.titleBrand = "UNKNOWN";

  const repeatPdf = pdfContext();
  const titlePdf = pdfContext();
  repeatSection(
    results.checks.repeatOffender,
    results.customer,
    "Michigan Repeat Offender Check",
    "SUBJECT SCREENED"
  ).render(repeatPdf.ctx);
  titleSection(results.checks.title, results.customer).render(titlePdf.ctx);

  for (const pdf of [repeatPdf, titlePdf]) {
    assert.equal(pdf.calls.images.length, 0);
    assert.ok(
      pdf.calls.text.includes(
        "Actual Michigan state-site screenshot unavailable."
      )
    );
  }
});

test("downloaded PDF rows grow and wrap instead of drawing values across lines", () => {
  const results = reportFixture();
  results.customer.firstName = "Alexandria-Catherine-Elizabeth";
  results.customer.middleName = "Bartholomew";
  results.customer.lastName = "Montgomery-Washington-Smythe";
  delete results.checks.repeatOffender.screenshotData;

  const wrapped = pdfContext();
  wrapped.ctx.doc.splitTextToSize = (value) => {
    const text = String(value);
    if (text.includes("Montgomery-Washington-Smythe")) {
      return [
        "Alexandria-Catherine-Elizabeth Bartholomew",
        "Montgomery-Washington-Smythe",
      ];
    }
    return [text];
  };

  repeatSection(
    results.checks.repeatOffender,
    results.customer,
    "Michigan Repeat Offender Check",
    "SUBJECT SCREENED"
  ).render(wrapped.ctx);

  // The page draws several cards; the subject box is the one that has to grow.
  assert.ok(
    Math.max(...wrapped.calls.roundedRects.map((rect) => rect[3])) >= 128,
    "the subject box should grow to contain the wrapped name"
  );
  assert.ok(
    wrapped.calls.text.includes("Montgomery-Washington-Smythe"),
    "the wrapped continuation should be drawn inside the subject box"
  );
});
