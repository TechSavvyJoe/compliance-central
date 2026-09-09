import assert from "node:assert/strict";
import test from "node:test";
import { registerPdfFonts } from "../lib/pdf-fonts.js";
import { PRINT_METRICS } from "../lib/print-html.js";
import { combinedPdfSections, loadReportBranding } from "../src/sidepanel/export.js";
import { STORAGE_KEYS } from "../lib/storage-keys.js";

// Exercise the bundled PDF engine and embedded font metrics, with no browser or download.
const previousSelf = globalThis.self;
globalThis.self = globalThis;
await import("../lib/jspdf.umd.min.js");
globalThis.self = previousSelf;
const { jsPDF } = globalThis.jspdf;
registerPdfFonts(jsPDF);

function recordingContext() {
  const doc = new jsPDF({ unit: "pt", format: "letter", putOnlyUsedFonts: true });
  const text = [];
  const original = doc.text.bind(doc);
  doc.text = (value, x, y, options) => {
    for (const [index, line] of (Array.isArray(value) ? value : [value]).entries()) {
      const width = doc.getTextWidth(String(line));
      const left = options?.align === "right" ? x - width : x;
      text.push({ value: String(line), left, right: left + width, y: y + index * doc.getLineHeight(), size: doc.getFontSize() });
    }
    return original(value, x, y, options);
  };
  return {
    text,
    ctx: { doc, pageWidth: 612, pageHeight: 792, margin: PRINT_METRICS.margin, y: PRINT_METRICS.margin, page: 1, pageNumberSlots: {} },
  };
}

function fixture() {
  return {
    timestamp: "2026-09-09T12:00:00.000Z",
    customer: { firstName: "Alex", lastName: "Example" },
    checks: { ofac: { passed: true, lastUpdate: "2026-09-09T12:00:00.000Z" }, repeatOffender: { status: "eligible", passed: true } },
  };
}

test("PDF dealership names fit the printable width without clipping", async () => {
  const { ctx, text } = recordingContext();
  const dealerName = "W".repeat(80);
  await combinedPdfSections(fixture(), ["buyer-ofac"], { dealerName })[0].render(ctx);
  const nameLines = text.filter(line => /^W+$/.test(line.value));
  assert.equal(nameLines.map(line => line.value).join(""), dealerName);
  assert.ok(nameLines.every(line => line.right <= 612 - PRINT_METRICS.margin + 0.1));
  const title = text.find(line => line.value.includes("Compliance Central OFAC"));
  assert.ok(nameLines.every(line => line.y < title.y));
  assert.ok(ctx.doc.output("arraybuffer").byteLength > 1000);
});

test("PDF mastheads fit beside a wide dealer logo without losing text", async () => {
  const { ctx, text } = recordingContext();
  const logoBoxes = [];
  ctx.doc.getImageProperties = () => ({ width: 800, height: 200 });
  ctx.doc.addImage = (_image, x, y, width, height) => { logoBoxes.push({ x, y, width, height }); };
  const branding = { dealerName: "W".repeat(80), logoUrl: "data:image/png;base64,UkVQRUFU" };
  await combinedPdfSections(fixture(), ["buyer-ofac"], branding)[0].render(ctx);
  const heading = text.filter(line => line.size === PRINT_METRICS.type.masthead);
  assert.equal(heading.map(line => line.value).join(" "), "Compliance Central OFAC Screening Record");
  const nameLines = text.filter(line => /^W+$/.test(line.value));
  assert.equal(nameLines.map(line => line.value).join(""), branding.dealerName);
  assert.ok(nameLines.length > 1);
  assert.equal(logoBoxes.length, 1);
  assert.ok([...heading, ...nameLines].every(line => line.left > logoBoxes[0].x + logoBoxes[0].width));
  assert.ok([...heading, ...nameLines].every(line => line.right <= 612 - PRINT_METRICS.margin + 0.1));
});

test("state capture heading and provenance occupy separate lines in a real PDF", async () => {
  const results = fixture();
  // A syntactically valid image selects the captured-state report path.
  results.checks.repeatOffender.screenshotData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const { ctx, text } = recordingContext();
  // Keep real font/layout measurements; a state portal image is an external input.
  ctx.doc.getImageProperties = () => ({ width: 1200, height: 1600 });
  ctx.doc.addImage = () => ctx.doc;
  await combinedPdfSections(results, ["buyer-repeat"], { dealerName: "Example Motors" })[0].render(ctx);
  const heading = text.find(line => line.value.includes("State-Site Capture"));
  const provenance = text.find(line => line.value.includes("ACTUAL MICHIGAN STATE-SITE CAPTURE"));
  assert.ok(heading && provenance);
  assert.ok(provenance.y - provenance.size >= heading.y, "provenance must not overprint the title");
  assert.ok(heading.right <= 586.1);
});

test("report branding comes from Settings and degrades to the public app on read failure", async (t) => {
  const previousChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  globalThis.chrome = { storage: { local: { get: async () => ({
    [STORAGE_KEYS.dealershipName]: "  Example Motors  ",
    [STORAGE_KEYS.dealershipLogo]: "https://example.invalid/logo.png",
  }) } } };
  assert.deepEqual(await loadReportBranding(), { dealerName: "Example Motors", logoUrl: "" });
  globalThis.chrome.storage.local.get = async () => { throw new Error("storage unavailable"); };
  assert.deepEqual(await loadReportBranding(), { dealerName: "", logoUrl: "" });
});
