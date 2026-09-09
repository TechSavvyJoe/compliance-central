/** Real panel DOM and events with synthetic storage and delayed service replies.
 * Run: npm run test:browser. Chrome must be installed (or set CHROME_PATH).
 * No customer records or traffic to Michigan are used by this test.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const path = resolve(root, "." + new URL(req.url, "http://localhost").pathname);
  if (!path.startsWith(root)) return void res.writeHead(403).end();
  try {
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    headless: true,
    args: ["--disable-background-networking", ...(process.env.CI ? ["--no-sandbox"] : [])],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.setViewport({ width: 400, height: 800 });
  await page.setRequestInterception(true);
  let artworkFixture = false;
  page.on("request", (req) => {
    if (req.url().startsWith(origin) || req.url().startsWith("data:")) return req.continue();
    if (artworkFixture && new URL(req.url()).hostname.endsWith("michigan.gov")) {
      return req.respond({ status: 200, contentType: "image/svg+xml", body:
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#102c48"/><text x="300" y="170" text-anchor="middle" fill="white" font-size="40">TEST ARTWORK</text></svg>' });
    }
    return req.abort();
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    const listeners = new Set();
    const fixture = window.panelFixture = {
      messages: [], pending: [], local: { dataUseNoticeSeen: true, retentionNoticeAckVersion: "1.6.0-retention" }, session: {},
    };
    const area = (name) => ({
      async get(keys) {
        const store = fixture[name];
        return keys == null ? structuredClone(store) : Object.fromEntries((Array.isArray(keys) ? keys : typeof keys === "object" ? Object.keys(keys) : [keys]).map((k) => [k, structuredClone(store[k])]));
      },
      async set(values) {
        const changes = {};
        for (const [k, v] of Object.entries(values)) { changes[k] = { oldValue: fixture[name][k], newValue: v }; fixture[name][k] = structuredClone(v); }
        queueMicrotask(() => listeners.forEach((fn) => fn(changes, name)));
      },
      async remove(keys) {
        const changes = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) { changes[k] = { oldValue: fixture[name][k] }; delete fixture[name][k]; }
        queueMicrotask(() => listeners.forEach((fn) => fn(changes, name)));
      },
    });
    window.chrome = {
      storage: { local: area("local"), session: area("session"), onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } },
      runtime: {
        getManifest: () => ({ version: "test" }), getURL: (path) => new URL(path, location.href).href,
        sendMessage: async (message) => {
          fixture.messages.push(message);
          if (message.type === "getDataStatus") return { success: true, lastUpdate: Date.now(), entryCount: 1000 };
          if (message.type === "SOS_FEE_CALCULATE") return new Promise((resolve) => fixture.pending.push({ resolve, mode: message.data.mode }));
          return { success: true };
        },
      },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    };
    fixture.respond = (feeCents = 17900, index = 0) => {
      const pending = fixture.pending.splice(index, 1)[0];
      pending.resolve({ success: true, quote: { calculationMode: pending.mode, feeCents, feeBreakdown: [{ label: "Registration", feeCents }], registrationMonths: 12, expiresOn: "2027-03-14", vehicleDescription: "Synthetic test vehicle", calculatedAt: new Date().toISOString() } });
    };
  });
  const fill = async (id, value, event = "input") => page.$eval(`#${id}`, (el, value, event) => { el.value = value; el.dispatchEvent(new Event(event, { bubbles: true })); }, value, event);
  const ready = () => page.waitForFunction(() => !document.querySelector("#calculateSosFeeBtn").disabled);
  const quoteState = () => page.evaluate(() => ({
    printable: !document.querySelector("#printSosQuoteBtn").disabled,
    visible: !document.querySelector("#sosQuoteHeadline").classList.contains("hidden"),
    stored: Boolean(window.panelFixture.session.sosFeeQuote),
  }));
  const emptyQuote = { printable: false, visible: false, stored: false };
  const begin = async () => { await page.click("#calculateSosFeeBtn"); await page.waitForFunction(() => window.panelFixture.pending.length > 0); };
  const respond = async (amount = 17900, index = 0) => { await page.evaluate((amount, index) => window.panelFixture.respond(amount, index), amount, index); await ready(); };
  const reload = async () => { await page.goto(`${origin}/sidepanel.html`, { waitUntil: "networkidle0" }); };
  await reload();
  await page.click("#sosTabBtn");
  await fill("sosModelYear", "2026"); await fill("sosMsrp", "42500"); await fill("sosOwnerBirthdate", "03/14/1985");
  await begin(); await respond();
  assert.deepEqual(await quoteState(), { printable: true, visible: true, stored: true });
  assert.equal(await page.$eval("#sosExportActions", (el) => {
    const r = el.getBoundingClientRect();
    return !el.hidden && r.top >= 0 && r.bottom <= innerHeight;
  }), true, "a finished quote reveals its print actions without another scroll");
  await page.click("#sosFeeBreakdown summary");
  assert.match(await page.$eval("#sosFeeBreakdownRows", (el) => el.textContent), /Registration.*\$179\.00/);
  await fill("sosOwnerBirthdate", "04/15/1985");
  assert.deepEqual(await quoteState(), emptyQuote, "birthdate edits must invalidate the quote");
  console.log("PASS: current quote, accessible breakdown, birthdate invalidation");

  await begin(); await fill("sosMsrp", "99900"); await respond(15700);
  assert.deepEqual(await quoteState(), emptyQuote, "a late answer cannot quote new MSRP with the old fee");
  await begin(); await fill("sosMsrp", "42500"); await begin();
  await respond(17900, 1); await respond(15700, 0);
  assert.equal(await page.evaluate(() => window.panelFixture.session.sosFeeQuote.feeCents), 17900, "old response cannot overwrite the replacement quote");
  console.log("PASS: edited and superseded calculations cannot restore stale fees");

  await page.click('input[name="sosQuoteMode"][value="plate_transfer"]');
  await fill("sosTransferPlateNumber", "TEST123"); await begin(); await respond(2100);
  await page.click('input[name="sosTransferAlreadyOwn"][value="yes"]');
  assert.deepEqual(await quoteState(), emptyQuote);
  await begin(); await respond(2100);
  await page.click('input[name="sosTransferChangePlate"][value="yes"]');
  assert.deepEqual(await quoteState(), emptyQuote);
  await fill("sosFuelType", "ELECTR", "change"); await begin();
  await page.click("#clearSosQuoteBtn"); await respond(2100);
  assert.deepEqual(await quoteState(), emptyQuote);
  assert.deepEqual(await page.evaluate(() => [document.querySelector("#sosFuelType").value, document.querySelector('input[name="sosQuoteMode"]:checked').value, document.querySelectorAll(".sos-field-error").length]), ["GAS", "new_plate", 0]);
  console.log("PASS: transfer choices invalidate fees; Clear cancels and resets the vehicle");

  await page.click("#calculateSosFeeBtn");
  assert.equal(await page.$eval("#sosOwnerBirthdate", (el) => el.getAttribute("aria-invalid")), "true");
  await fill("sosOwnerBirthdate", "03/14/1985");
  assert.equal(await page.$eval("#sosOwnerBirthdate", (el) => el.getAttribute("aria-describedby")), "sosOwnerBirthdateHint");
  await fill("sosModelYear", "2026"); await fill("sosMsrp", "42500");
  assert.equal(await page.$eval("#sosReadiness", (el) => el.textContent), "Ready to calculate.");
  console.log("PASS: inline validation clears obsolete errors and preserves field help");

  await reload();
  await page.focus("#screeningTabBtn"); await page.keyboard.press("End");
  await page.waitForFunction(() => !document.querySelector("#historyWorkspace").hidden && document.querySelector("#historyList").textContent.trim());
  assert.equal(await page.evaluate(() => document.activeElement.id), "viewHistoryBtn");
  await page.keyboard.press("Home");
  await page.click("#settingsBtn"); await page.waitForSelector("#settingsModal:not(.hidden)");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement.id), "settingsBtn");
  console.log("PASS: keyboard History loading and Settings focus restoration");

  artworkFixture = true;
  await reload();
  await page.click("#sosTabBtn");
  await page.waitForFunction(() => {
    const img = document.querySelector("#sosPlatePreviewImage");
    return img.complete && img.naturalWidth > 0;
  });
  for (const size of [{ width: 320, height: 640 }, { width: 400, height: 400 }, { width: 1280, height: 720 }]) {
    await page.setViewport(size);
    await page.click("#sosPlatePreview");
    await page.waitForSelector("#sosPlateViewer:not(.hidden)");
    await page.$eval(".sos-plate-viewer-shell", (el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
    assert.equal(await page.$eval(".sos-plate-viewer-shell", (el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    }), true, `viewer fits ${size.width}x${size.height}`);
    await page.click("#sosPlateViewerStage", { count: 2 });
    assert.equal(await page.$eval("#sosPlateZoomReset", (el) => el.textContent), "175%");
    await page.click("#sosPlateViewerStage", { count: 2 });
    assert.equal(await page.$eval("#sosPlateZoomReset", (el) => el.textContent), "100%");
    await page.click("#sosPlateZoomIn");
    await page.click("#sosPlateZoomReset");
    assert.equal(await page.$eval("#sosPlateZoomReset", (el) => el.textContent), "100%");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement.id), "sosPlatePreview");
  }
  console.log("PASS: plate viewer fits short/narrow/wide screens; zoom and Escape recover");

  for (const width of [320, 400, 600]) {
    await page.setViewport({ width, height: 800 });
    for (const tab of ["#screeningTabBtn", "#sosTabBtn", "#viewHistoryBtn"]) {
      await page.click(tab);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${tab} fits ${width}px`);
    }
  }
  await page.setViewport({ width: 400, height: 800 });
  await page.click("#sosTabBtn");
  await fill("sosModelYear", "2026"); await fill("sosMsrp", "42500"); await fill("sosOwnerBirthdate", "03/14/1985");
  await begin(); await respond();
  if (process.env.CC_FLOW_ARTIFACTS) {
    await mkdir(process.env.CC_FLOW_ARTIFACTS, { recursive: true });
    await page.screenshot({ path: resolve(process.env.CC_FLOW_ARTIFACTS, "plate-result.png") });
    await page.click("#screeningTabBtn");
    await page.screenshot({ path: resolve(process.env.CC_FLOW_ARTIFACTS, "screening.png") });
  }
  assert.deepEqual(pageErrors, [], "no unhandled browser errors");
  console.log("PASS: all three panels fit 320, 400 and 600px; no browser exceptions");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
