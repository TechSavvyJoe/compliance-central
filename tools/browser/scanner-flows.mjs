import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import puppeteer from "puppeteer-core";
import { decryptPayload } from "../../lib/crypto-pair.js";

// Explicitly run by npm run test:browser; outside default node --test discovery.
// Uses the pinned project dependency and installed Chrome; never downloads it.
const ROOT = new URL("../../docs/", import.meta.url);
const RAW = "@\n\rANSI 636032100102DL00410279\n" +
  "DLDAQS123456789012\nDCSSAMPLE\nDCTPAT ALEX\nDBB08081985\nDAJMI\n\r";
const PAIR = "#s=11111111111111111111111111111111&k=" + "A".repeat(43);
const mime = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", webp: "image/webp", woff2: "font/woff2" };

test("scanner recovery and review in a browser", { timeout: 60_000 }, async (t) => {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname.slice(1);
      const file = new URL(path, ROOT);
      if (!file.href.startsWith(ROOT.href)) throw new Error("outside fixture root");
      const body = await readFile(fileURLToPath(file));
      res.writeHead(200, { "Content-Type": mime[path.split(".").pop()] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    headless: true,
    args: ["--disable-background-networking", ...(process.env.CI ? ["--no-sandbox"] : [])],
  });
  t.after(() => browser.close());

  async function open(st, { permission = "prompt", label = "", paired = false, width = 390, height = 844 } = {}) {
    const page = await browser.newPage();
    st.after(() => page.close());
    page.setDefaultTimeout(3000);
    // Loading Chrome/fonts on a busy CI host is not camera-permission latency.
    // Keep the short interaction assertions, but give navigation its own budget.
    page.setDefaultNavigationTimeout(15000);
    await page.setViewport({ width, height, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    st.after(() => assert.deepEqual(errors, [], "no unhandled page errors"));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin) return void request.abort();
      if (url.pathname.endsWith("scanner-provider.js")) {
        return void request.respond({ contentType: "text/javascript", body: "export async function createCommercialScannerProvider() { return {provider:null}; }" });
      }
      if (url.pathname.endsWith("zxing-wasm-loader.js")) {
        return void request.respond({ contentType: "text/javascript", body: "export async function ensureWasmReader(){return false;} export async function decodePdf417File(){return [];} export async function decodePdf417Wasm(){return [];}" });
      }
      if (url.pathname.endsWith("zxing.min.js")) {
        return void request.respond({ contentType: "text/javascript", body: "" });
      }
      void request.continue();
    });
    await page.evaluateOnNewDocument((permission, label, raw) => {
      const state = window.scanTest = { cameraCalls: 0, stopped: 0, raw, accept: false, rejectCamera: false, requests: [], delivery: "success" };
      navigator.permissions.query = async () => {
        if (permission === "unsupported") throw new TypeError("unsupported descriptor");
        if (permission === "pending") return new Promise((resolve) => { state.resolvePermission = resolve; });
        return { state: permission };
      };
      navigator.mediaDevices.enumerateDevices = async () => [{ kind: "videoinput", label }];
      navigator.mediaDevices.getUserMedia = async () => {
        state.cameraCalls++;
        if (state.rejectCamera) throw new DOMException("Permission denied", "NotAllowedError");
        const track = { stop: () => state.stopped++, getCapabilities: () => ({}), getSettings: () => ({}) };
        return { getTracks: () => [track], getVideoTracks: () => [track] };
      };
      Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { get() { return this.testStream; }, set(value) { this.testStream = value; } });
      HTMLMediaElement.prototype.play = async () => {};
      for (const [name, value] of Object.entries({ readyState: 4, videoWidth: 640, videoHeight: 480 })) {
        Object.defineProperty(HTMLVideoElement.prototype, name, { get: () => value });
      }
      window.BarcodeDetector = class {
        static async getSupportedFormats() { return ["pdf417"]; }
        async detect() { return state.accept ? [{ rawValue: state.raw }] : []; }
      };
      const nativeFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (!String(url).includes("/pair/")) return nativeFetch(url, options);
        state.requests.push(JSON.parse(options.body));
        if (state.delivery === "pending") {
          return new Promise((resolve, reject) => {
            state.resolveDelivery = () => resolve(new Response("{}", { status: 200 }));
            options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          });
        }
        return new Response("{}", { status: Number(state.delivery) || 200 });
      };
    }, permission, label, RAW);
    await page.goto(`${origin}/scan.html${paired ? PAIR : ""}`);
    return page;
  }

  async function review(page) {
    await page.evaluate(() => { window.scanTest.accept = true; });
    const start = await page.$eval("#startBtn", (button) => !button.classList.contains("hidden"));
    if (start) await page.click("#startBtn");
    await page.waitForSelector("#reviewScreen:not(.hidden)");
    await page.waitForFunction(() => document.activeElement.id === "reviewHeading");
  }

  async function finish(page) {
    await review(page);
    await page.click("#confirmBtn");
    await page.waitForSelector("#cobuyerPrompt:not(.hidden)");
    await page.click("#noCoBuyerBtn");
    await page.waitForSelector("#doneScreen:not(.hidden)");
  }

  await t.test("a stalled permission probe leaves an immediate camera action", async (st) => {
    const page = await open(st, { permission: "pending" });
    await page.waitForSelector("#startBtn:not(.hidden)");
    await review(page);
    await page.evaluate(() => window.scanTest.resolvePermission({ state: "granted" }));
    assert.equal(await page.$eval("#reviewScreen", (node) => node.classList.contains("hidden")), false);
    assert.equal(await page.evaluate(() => window.scanTest.cameraCalls), 1);
  });

  for (const options of [{ permission: "granted" }, { permission: "unsupported", label: "Back Camera" }]) {
    await t.test(`prior camera grant auto-starts (${options.permission})`, async (st) => {
      const page = await open(st, options);
      await page.waitForFunction(() => window.scanTest.cameraCalls === 1);
      await review(page);
      assert.ok(await page.evaluate(() => window.scanTest.stopped > 0));
    });
  }

  await t.test("denial keeps photo fallback and permits an explicit retry", async (st) => {
    const page = await open(st, { permission: "denied" });
    assert.equal(await page.evaluate(() => window.scanTest.cameraCalls), 0);
    await page.evaluate(() => { window.scanTest.rejectCamera = true; });
    await page.click("#startBtn");
    await page.waitForSelector("#errorBanner:not(.hidden)");
    assert.match(await page.$eval("#errorBanner", (node) => node.textContent), /browser settings/);
    assert.equal(await page.$eval("#photoBtn", (button) => button.disabled), false);
    await page.evaluate(() => { window.scanTest.rejectCamera = false; });
    await review(page);
  });

  await t.test("standalone review and done remain visible and truthful on a small phone", async (st) => {
    const page = await open(st, { width: 320, height: 568 });
    await page.evaluate(() => {
      window.scanTest.raw = window.scanTest.raw.replace("636032", "636001").replace("DAJMI", "DAJNY");
    });
    await review(page);
    const heading = await page.$eval("#reviewHeading", (node) => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom }));
    assert.ok(heading.top >= 0 && heading.bottom < 568, "focused review heading is visible after scrolling capture controls");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "rescanBtn");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "confirmBtn");
    await page.keyboard.press("Enter");
    await page.click("#noCoBuyerBtn");
    assert.doesNotMatch(await page.$eval("#doneScreen .hint", (node) => node.textContent), /fill automatically/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => window.scanTest.requests.length), 0);
  });

  await t.test("transient delivery failures retry the approved data without a rescan", async (st) => {
    const page = await open(st, { paired: true });
    await page.evaluate(() => { window.scanTest.delivery = "503"; });
    await finish(page);
    await page.waitForSelector("#retrySendBtn:not(.hidden)");
    assert.equal(await page.$eval(".done-check", (node) => getComputedStyle(node).display), "none");
    await page.evaluate(() => { window.scanTest.delivery = "success"; });
    await page.click("#retrySendBtn");
    await page.waitForFunction(() => document.getElementById("deliveryStatus").textContent.startsWith("Sent securely"));
    assert.equal(await page.evaluate(() => document.activeElement.id), "doneHeading");
    assert.equal(await page.evaluate(() => window.scanTest.cameraCalls), 1);
    const blobs = await page.evaluate(() => window.scanTest.requests);
    const payloads = await Promise.all(blobs.map((blob) => decryptPayload("A".repeat(43), blob)));
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads[0], payloads[1]);
    assert.equal(payloads[0].buyer.firstName, "PAT");
  });

  await t.test("restoring an interrupted send exposes retry and never claims success", async (st) => {
    const page = await open(st, { paired: true });
    await page.evaluate(() => { window.scanTest.delivery = "pending"; });
    await finish(page);
    await page.waitForFunction(() => window.scanTest.requests.length === 1);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.waitForSelector("#retrySendBtn:not(.hidden)");
    assert.doesNotMatch(await page.$eval("#deliveryStatus", (node) => node.textContent), /Encrypting|Sent securely/);
    await page.evaluate(() => { window.scanTest.delivery = "success"; });
    await page.click("#retrySendBtn");
    await page.waitForFunction(() => document.getElementById("deliveryStatus").textContent.startsWith("Sent securely"));
    assert.equal(await page.evaluate(() => window.scanTest.cameraCalls), 1);
  });

  await t.test("restoring the camera page offers a fresh explicit start", async (st) => {
    const page = await open(st, { permission: "granted" });
    await page.waitForFunction(() => window.scanTest.cameraCalls === 1);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.waitForSelector("#startBtn:not(.hidden)");
    assert.equal(await page.evaluate(() => window.scanTest.cameraCalls), 1);
    await review(page);
    assert.equal(await page.evaluate(() => window.scanTest.cameraCalls), 2);
  });

  await t.test("expired delivery gives new QR guidance without an unusable retry", async (st) => {
    const page = await open(st, { paired: true });
    await page.evaluate(() => { window.scanTest.delivery = "400"; });
    await finish(page);
    await page.waitForSelector("#errorBanner:not(.hidden)");
    assert.match(await page.$eval("#errorBanner", (node) => node.textContent), /new scanner QR code/);
    assert.equal(await page.$eval("#retrySendBtn", (button) => button.classList.contains("hidden")), true);
    assert.equal(await page.evaluate(() => window.scanTest.requests.length), 1);
  });
});
