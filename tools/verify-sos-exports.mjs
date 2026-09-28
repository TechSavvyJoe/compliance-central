/** Synthetic plate-export regression: actual panel buttons + packaged jsPDF.
 * No state requests, physical printing or customer documents are used.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "../visual-refresh/repair-20260925");
const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const path = resolve(root, "." + new URL(req.url, "http://localhost").pathname);
  if (!path.startsWith(root)) return void res.writeHead(403).end();
  try { const body = await readFile(path); res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }), headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 800 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", (req) => req.url().startsWith(origin) || /^(data|blob):/.test(req.url()) ? req.continue() : req.abort());
  await page.evaluateOnNewDocument(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900; canvas.height = 1000;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 900, 1000);
    ctx.fillStyle = "#0c2b48"; ctx.font = "bold 32px sans-serif";
    ["SYNTHETIC TEST CAPTURE — NOT A STATE RESULT", "Registration Fee Calculation", "Test vehicle · New plate", "Registration: $165.00", "Recreation Passport: $14.00", "Total fee: $179.00", "12 months · expires March 14, 2027"].forEach((text, i) => ctx.fillText(text, 30, 65 + i * 80));
    const quote = { mode: "new_plate", source: "calculated", plateDesignValue: "u_michigan_state", feeCents: 17900, feeBreakdown: [{ label: "Registration", feeCents: 16500 }, { label: "Recreation Passport", feeCents: 1400 }], vehicleDescription: "Synthetic test vehicle", msrpCents: 4250000, calculatedAt: "2026-09-25T16:00:00Z", recreationPassport: true, registrationMonths: 12, expiresOn: "2027-03-14", officialPageImage: canvas.toDataURL("image/png") };
    const fixture = window.exportFixture = { quote, downloads: [], tabs: [], text: [], local: { dataUseNoticeSeen: true, retentionNoticeAckVersion: "1.6.0-retention" }, session: { sosFeeQuote: quote } };
    const listeners = new Set();
    const area = (name) => ({
      async get(keys) { return keys == null ? structuredClone(fixture[name]) : Object.fromEntries((Array.isArray(keys) ? keys : typeof keys === "object" ? Object.keys(keys) : [keys]).map((key) => [key, structuredClone(fixture[name][key])])); },
      async set(values) { Object.assign(fixture[name], structuredClone(values)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete fixture[name][key]; },
    });
    window.chrome = {
      storage: { local: area("local"), session: area("session"), onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } },
      runtime: { getManifest: () => ({ version: "test" }), getURL: (path) => new URL(path, location.href).href, sendMessage: async (message) => message.type === "getDataStatus" ? { success: true, entryCount: 1000, lastUpdate: Date.now() } : { success: true } },
      tabs: { create: async (options) => { fixture.tabs.push(options); return { id: 1 }; } },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    };
    HTMLAnchorElement.prototype.click = function () { if (this.download) fixture.downloads.push({ filename: this.download, url: this.href }); };
    window.open = () => { throw new Error("Popup should not be used when tabs.create is available"); };
  });
  await page.goto(`${origin}/sidepanel.html`, { waitUntil: "networkidle0" });
  assert.equal(await page.title(), "Compliance Central");
  await page.click("#sosTabBtn");
  await page.waitForFunction(() => !document.querySelector("#printSosBothBtn").disabled);
  for (const [id, count] of [["downloadSosBothPdfBtn", 1], ["downloadSosQuotePdfBtn", 2], ["downloadSosCalculationPdfBtn", 3]]) {
    await page.click(`#${id}`);
    await page.waitForFunction((count) => window.exportFixture.downloads.length === count, {}, count);
  }
  for (const [id, count] of [["printSosBothBtn", 1], ["printSosQuoteBtn", 2], ["printSosCalculationBtn", 3]]) {
    await page.click(`#${id}`);
    await page.waitForFunction((count) => window.exportFixture.tabs.length === count, {}, count);
  }
  const checks = await page.evaluate(async () => {
    const { createSosFeeDocumentsPDF, exportSosFeeDocuments } = await import("./src/sidepanel/export.js");
    const { createSosFeeQuotePrintHTML, sosCustomerReferenceRows, SOS_WORKSHEET_NOTE, SOS_WORKSHEET_FOOTER } = await import("./src/sidepanel/sos-fee-quote.js");
    const f = window.exportFixture;
    const combined = await createSosFeeDocumentsPDF(f.quote);
    const customer = await createSosFeeDocumentsPDF(f.quote, { official: false });
    const state = await createSosFeeDocumentsPDF(f.quote, { customer: false });
    const pdfs = await Promise.all([...f.downloads, ...f.tabs].map(async ({ url }) => new TextDecoder().decode(await (await fetch(url)).arrayBuffer())));
    const downloadedBlob = await (await fetch(f.downloads[0].url)).blob();
    const downloadedBase64 = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(downloadedBlob); });
    // Capture rendered PDF text with the real font and layout engine still used.
    const Real = window.jspdf.jsPDF;
    function Spy(...args) {
      const doc = new Real(...args);
      const text = doc.text.bind(doc);
      doc.text = (value, ...rest) => { f.text.push(Array.isArray(value) ? value.join(" ") : String(value)); return text(value, ...rest); };
      return doc;
    }
    Spy.API = Real.API; window.jspdf.jsPDF = Spy;
    const parity = [];
    for (const passport of [true, false, null]) {
      f.text = [];
      const quote = { ...f.quote, recreationPassport: passport, feeBreakdown: [] };
      await createSosFeeDocumentsPDF(quote, { official: false });
      const text = f.text.join(" ");
      const html = createSosFeeQuotePrintHTML(quote);
      parity.push(sosCustomerReferenceRows(quote).every((row) => text.includes(row.label) && text.includes(row.value) && html.includes(row.value)) && text.includes(SOS_WORKSHEET_NOTE) && text.includes(SOS_WORKSHEET_FOOTER));
    }
    window.jspdf.jsPDF = Real;
    const before = f.downloads.length;
    const missing = await exportSosFeeDocuments({ ...f.quote, officialPageImage: null });
    const missingToast = document.querySelector(".toast:last-child .toast-message").textContent;
    const corrupt = await exportSosFeeDocuments({ ...f.quote, officialPageImage: "data:image/png;base64,AAAA" });
    const corruptToast = document.querySelector(".toast:last-child .toast-message").textContent;
    const noSubstitute = f.downloads.length === before;
    const customerAvailable = await exportSosFeeDocuments({ ...f.quote, officialPageImage: null }, { official: false });
    chrome.tabs.create = async () => { throw new Error("Synthetic tab failure"); };
    const blocked = await exportSosFeeDocuments(f.quote, { print: true });
    return { pages: [combined.getNumberOfPages(), customer.getNumberOfPages(), state.getNumberOfPages()], signatures: pdfs.map((pdf) => pdf.startsWith("%PDF-")), imageCount: (pdfs[0].match(/\/Subtype \/Image/g) || []).length, parity, missing, missingToast, corrupt, corruptToast, noSubstitute, customerAvailable, blocked, combined: downloadedBase64 };
  });
  assert.deepEqual(checks.pages, [2, 1, 1]);
  assert.deepEqual(checks.signatures, Array(6).fill(true));
  assert.ok(checks.imageCount >= 2, "Combined button PDF embeds both the authentic plate artwork and state capture");
  assert.deepEqual(checks.parity, [true, true, true]);
  assert.equal(checks.missing, false); assert.match(checks.missingToast, /capture is unavailable/);
  assert.equal(checks.corrupt, false); assert.match(checks.corruptToast, /capture could not be read/);
  assert.equal(checks.noSubstitute, true); assert.equal(checks.customerAvailable, true); assert.equal(checks.blocked, false);
  assert.deepEqual(errors, []);
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "plate-both-test.pdf"), Buffer.from(checks.combined, "base64"));
  await page.evaluate(() => { document.querySelector("#toast-container")?.remove(); document.querySelector("#sosExportActions").scrollIntoView({ block: "center" }); });
  await page.screenshot({ path: resolve(output, "plate-export-controls.png") });
  console.log("PASS: all six actual buttons create PDF blobs; combined 2 pages, individual 1 each; missing/corrupt state never substituted; customer still available; failed tab reported; HTML/PDF reference parity for all Passport states; no page errors.");
  console.log(resolve(output, "plate-both-test.pdf"));
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
