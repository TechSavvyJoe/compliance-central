/**
 * Real MV3 worker, runtime messages, storage events and two panel documents in
 * separate Chrome windows. Only the backend fetch response is substituted.
 * Run: node tools/verify-extension-flows.mjs (Chrome or CHROME_PATH, puppeteer-core 25.10).
 * Puppeteer creates/deletes its own temporary profile; no personal browser is used.
 * Native side-panel docking/layout and live government services are not asserted.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const syntheticVin = "1FTFW1E84PFA10397";
const timeout = 8000;
const pages = [];
const pageErrors = [];
let browser;
let worker;
let phase = "launch";

async function installBackendFixture(targetWorker) {
  await targetWorker.evaluate((vin) => {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const fixture = globalThis.extensionFlowFixture = { requests: [], unexpected: [] };
    globalThis.fetch = (input, options = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.hostname !== "compliance-central-api.fly.dev") return nativeFetch(input, options);
      const data = JSON.parse(options.body || "{}");
      if (url.pathname !== "/api/title-check" || options.method !== "POST" || data.vin !== vin) {
        fixture.unexpected.push({ path: url.pathname, method: options.method });
        return Promise.reject(new Error("Unexpected backend request in isolated extension test"));
      }
      const request = { path: url.pathname, aborted: options.signal?.aborted || false, resolved: false };
      fixture.requests.push(request);
      options.signal?.addEventListener("abort", () => { request.aborted = true; }, { once: true });
      // Deliberately allow a response after abort to test the publication fence,
      // independently of how quickly the browser/network honours cancellation.
      return new Promise((resolve) => {
        request.respond = () => {
          request.resolved = true;
          resolve(new Response(JSON.stringify({
            success: true, passed: true, message: "Synthetic title fixture",
            timestamp: new Date().toISOString(),
            details: { titleStatus: "clear", titleBrand: "CLEAN", hasLien: false,
              year: "2023", make: "SYNTHETIC", model: "TEST VEHICLE" },
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
        };
      });
    };
  }, syntheticVin);
}

async function session(page) {
  return page.evaluate(() => chrome.storage.session.get([
    "activeRunId", "stateRunId", "cancelledRunId", "searchStatus", "searchProgress", "currentResults", "lastError",
  ]));
}

async function openPanel(name) {
  const client = await browser.target().createCDPSession();
  const blank = `about:blank#extension-flow-${name}`;
  await client.send("Target.createTarget", { url: blank, newWindow: true, width: 430, height: 900 });
  const target = await browser.waitForTarget((candidate) => candidate.url() === blank, { timeout });
  const page = await target.page();
  assert.ok(page, `${name} panel must be an actual extension page`);
  pages.push(page);
  page.on("pageerror", (error) => pageErrors.push({ panel: name, error: error.message }));
  page.setDefaultTimeout(timeout);
  await page.setViewport({ width: 400, height: 850 });
  const extensionOrigin = new URL(worker.url()).origin;
  // URL.origin is "null" for chrome-extension URLs in Node's URL parser.
  const extensionRoot = extensionOrigin === "null" ? worker.url().replace(/\/service-worker\.js$/, "") : extensionOrigin;
  await page.goto(`${extensionRoot}/sidepanel.html?flow=${name}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.readyState === "complete" && document.querySelector("#runAllChecksBtn"));
  // Importing the real module also ensures its DOMContentLoaded setup ran.
  await page.evaluate(async () => {
    await import(chrome.runtime.getURL("sidepanel.js"));
    await chrome.runtime.sendMessage({ type: "getDataStatus" });
  });
  await client.detach();
  return page;
}

async function startVinRun(page, requestCount) {
  await page.click("#screeningTabBtn");
  await page.waitForFunction(() => !document.querySelector("#runAllChecksBtn").disabled);
  // Use actual controls/events; do not replace form, message or storage APIs.
  if (await page.$eval("#inputPanel", (element) => element.classList.contains("hidden"))) {
    await page.click("#inputSummaryBar");
  }
  if (await page.$eval("#tradeSectionHeader", (element) => element.getAttribute("aria-expanded") !== "true")) {
    await page.click("#tradeSectionHeader");
  }
  await page.$eval("#tradeVin", (element, vin) => {
    element.value = vin;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, syntheticVin);
  await page.click("#runAllChecksBtn");
  await page.waitForFunction(async () => {
    const state = await chrome.storage.session.get(["activeRunId", "searchStatus"]);
    return state.activeRunId && state.searchStatus === "running";
  });
  await waitForRequestCount(requestCount);
  const state = await session(page);
  assert.equal(state.currentResults.customer.firstName, "", "no invented buyer accompanies a VIN-only run");
  assert.equal(state.currentResults.customer.tradeVin, syntheticVin);
  assert.equal(state.currentResults.runId, state.activeRunId);
  return state.activeRunId;
}

async function waitForRequestCount(count) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await worker.evaluate((count) => globalThis.extensionFlowFixture.requests.length >= count, count)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(`Expected ${count} synthetic title request(s)`);
}

async function respond(index) {
  await worker.evaluate((index) => {
    const request = globalThis.extensionFlowFixture.requests[index];
    if (!request || request.resolved) throw new Error("Missing or already resolved title fixture");
    request.respond();
  }, index);
}

async function waitCompleted(page, runId) {
  await page.waitForFunction(async (runId) => {
    const state = await chrome.storage.session.get(["searchStatus", "currentResults"]);
    return state.searchStatus === "complete" && state.currentResults?.runId === runId;
  }, {}, runId);
  await page.waitForSelector("#resultsSection:not(.hidden)");
  await page.waitForFunction(async (runId) => {
    const { complianceHistory = [] } = await chrome.storage.local.get("complianceHistory");
    return complianceHistory.some((entry) => entry.auditId === `run:${runId}`);
  }, {}, runId);
  const state = await session(page);
  assert.equal(state.currentResults.checks.title.passed, true);
  assert.equal(state.currentResults.checks.ofac.status, "skipped");
  assert.equal(state.currentResults.checks.repeatOffender.status, "skipped");
}

try {
  browser = await puppeteer.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    headless: true, enableExtensions: [root],
    pipe: true, timeout: 30000, protocolTimeout: 15000,
    args: ["--disable-background-networking", "--disable-background-timer-throttling",
      // All native network is directed to an unreachable local proxy, from
      // launch onward, including installation alarms before worker injection.
      "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>",
      ...(process.env.CI ? ["--no-sandbox"] : [])],
  });
  const workerTarget = await browser.waitForTarget((target) => target.type() === "service_worker" && target.url().endsWith("/service-worker.js"), { timeout });
  worker = await workerTarget.worker();
  assert.ok(worker, "the unpacked extension worker must run");
  await installBackendFixture(worker);
  const owner = await openPanel("owner");
  const unrelated = await openPanel("unrelated");
  const windowIds = await Promise.all(pages.map((page) => page.evaluate(async () => (await chrome.windows.getCurrent()).id)));
  assert.notEqual(windowIds[0], windowIds[1], "the panel documents must belong to distinct Chrome windows");
  console.log("PASS: unpacked extension with real worker and two independent Chrome windows");

  phase = "unrelated Clear during VIN-only run";
  const cancelledRun = await startVinRun(owner, 1);
  await unrelated.click("#clearBtn");
  await unrelated.evaluate(() => chrome.runtime.sendMessage({ type: "getDataStatus" }));
  const unaffected = await session(owner);
  assert.equal(unaffected.activeRunId, cancelledRun, "unrelated Clear must retain worker ownership");
  assert.equal(unaffected.currentResults.runId, cancelledRun, "unrelated Clear must retain the owner's results");
  assert.equal(unaffected.searchStatus, "running");
  assert.equal(await owner.$eval("#runAllChecksBtn", (button) => button.disabled), true);
  assert.equal(await worker.evaluate(() => globalThis.extensionFlowFixture.requests[0].aborted), false);
  console.log("PASS: clearing the unrelated panel preserves the pending VIN-only run");

  phase = "owning Clear, replacement run and late response";
  await owner.click("#clearBtn");
  await owner.waitForFunction(async (id) => {
    const state = await chrome.storage.session.get(["activeRunId", "cancelledRunId", "currentResults"]);
    return !state.activeRunId && state.cancelledRunId === id && !state.currentResults;
  }, {}, cancelledRun);
  assert.equal(await worker.evaluate(() => globalThis.extensionFlowFixture.requests[0].aborted), true);
  const completedRun = await startVinRun(owner, 2);
  assert.notEqual(completedRun, cancelledRun);
  await respond(0);
  // Reading worker state after the old promise settles exercises its queued
  // continuation while the replacement's backend response is still pending.
  await worker.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await chrome.storage.session.get("currentResults");
  });
  assert.equal((await session(owner)).currentResults.runId, completedRun);
  assert.equal((await session(owner)).searchStatus, "running");
  await respond(1);
  await waitCompleted(owner, completedRun);
  assert.equal(await owner.evaluate(async (id) => {
    const { complianceHistory = [] } = await chrome.storage.local.get("complianceHistory");
    return complianceHistory.some((entry) => entry.auditId === `run:${id}`);
  }, cancelledRun), false);
  console.log("PASS: owning Clear aborts; a delayed response cannot replace the next run or enter History");

  phase = "History Open while a full result is complete";
  await owner.click("#viewHistoryBtn");
  const historyButton = `.history-open-btn[data-audit="run:${completedRun}"]`;
  await owner.waitForSelector(historyButton);
  await owner.click(historyButton);
  await owner.waitForFunction(async (previousId) => {
    const state = await chrome.storage.session.get(["activeRunId", "searchStatus", "currentResults"]);
    return state.searchStatus === "complete" && state.activeRunId && state.activeRunId !== previousId && state.currentResults?.runId === state.activeRunId;
  }, {}, completedRun);
  const restored = await session(owner);
  assert.equal(restored.currentResults.customer.tradeVin, syntheticVin);
  assert.equal(restored.currentResults.checks.title.passed, true);
  await owner.waitForSelector("#resultsSection:not(.hidden)");
  await owner.reload({ waitUntil: "load" });
  await owner.waitForSelector("#resultsSection:not(.hidden)");
  assert.equal((await session(owner)).activeRunId, restored.activeRunId);
  assert.equal(await owner.evaluate(async () => {
    const { getCurrentResults } = await import(chrome.runtime.getURL("src/sidepanel/state.js"));
    return getCurrentResults()?.runId;
  }), restored.activeRunId);
  console.log("PASS: History Open creates a fresh completed working copy and survives panel reload");

  phase = "actual worker termination and restart reconciliation";
  await owner.click("#newCustomerBtn");
  await owner.waitForFunction(async () => !(await chrome.storage.session.get("activeRunId")).activeRunId);
  const interruptedRun = await startVinRun(owner, 3);
  assert.deepEqual(await worker.evaluate(() => globalThis.extensionFlowFixture.unexpected), []);
  const oldWorkerUrl = worker.url();
  const replacementTarget = browser.waitForTarget((target) => target !== workerTarget && target.type() === "service_worker" && target.url() === oldWorkerUrl, { timeout });
  await worker.close();
  await unrelated.evaluate(() => chrome.runtime.sendMessage({ type: "getDataStatus" }));
  worker = await (await replacementTarget).worker();
  assert.ok(worker);
  assert.equal(await worker.evaluate(() => typeof globalThis.extensionFlowFixture), "undefined", "the replacement must be a fresh worker execution");
  await installBackendFixture(worker);
  await owner.waitForFunction(async (id) => {
    const state = await chrome.storage.session.get(["searchStatus", "cancelledRunId", "activeRunId"]);
    return state.searchStatus === "error" && state.cancelledRunId === id && !state.activeRunId;
  }, {}, interruptedRun);
  await owner.waitForFunction(() => !document.querySelector("#runAllChecksBtn").disabled && document.querySelector("#progressSection").classList.contains("hidden"));
  assert.match((await session(owner)).lastError, /interrupted/);
  const afterRestart = await startVinRun(owner, 1);
  assert.notEqual(afterRestart, interruptedRun);
  await respond(0);
  await waitCompleted(owner, afterRestart);
  assert.equal(await owner.evaluate(async (id) => {
    const { complianceHistory = [] } = await chrome.storage.local.get("complianceHistory");
    return complianceHistory.some((entry) => entry.auditId === `run:${id}`);
  }, interruptedRun), false);
  assert.deepEqual(await worker.evaluate(() => globalThis.extensionFlowFixture.unexpected), []);
  assert.deepEqual(pageErrors, []);
  console.log("PASS: actual worker restart fences the interrupted run; a fresh run completes and saves History");
  console.log("PASS: all extension flows; backend responses synthetic; native network blocked for the isolated profile");
} catch (error) {
  console.error(`FAIL: ${phase}: ${error.message}`);
  for (const [index, page] of pages.entries()) {
    if (page.isClosed()) continue;
    try {
      console.error(JSON.stringify(await page.evaluate(async (index) => {
        const state = await chrome.storage.session.get(["activeRunId", "stateRunId", "searchStatus", "currentResults"]);
        return { panel: index, status: state.searchStatus, activeRunId: state.activeRunId,
          stateRunId: state.stateRunId, resultRunId: state.currentResults?.runId,
          runButtonDisabled: document.querySelector("#runAllChecksBtn")?.disabled,
          toasts: [...document.querySelectorAll(".toast-message")].map((node) => node.textContent) };
      }, index)));
    } catch { /* Browser might already have closed after a protocol failure. */ }
  }
  if (pageErrors.length) console.error(JSON.stringify(pageErrors));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
