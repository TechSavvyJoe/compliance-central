import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { getFormData, planChecksForData } from "../src/sidepanel/form.js";
import { handleMessage } from "../src/worker/message-router.js";
import { isRunInFlight } from "../src/worker/orchestrator.js";

const vin = "1FTFW1E84PFA10397";
const buyer = { firstName: "Synthetic", lastName: "Example", dob: "03/14/1985", dlnPid: "T123456789012" };

// Invoke the actual parent collector, including empty strings, checkbox
// semantics, ISO birthdates, jurisdiction fields, hasTrade and plan.
function formPayload(values = {}, checked = false) {
  const elements = Object.fromEntries([
    "firstName", "middleName", "lastName", "suffix", "dob", "dlnPid", "tradeVin",
    "cbFirstName", "cbMiddleName", "cbLastName", "cbSuffix", "cbDob", "cbDlnPid",
  ].map((id) => [id, { value: values[id] || "", dataset: {} }]));
  elements.hasCoBuyer = { checked };
  const customer = getFormData(elements);
  customer.buyerIsMichigan = null;
  customer.coBuyerIsMichigan = null;
  return { customer, hasTrade: Boolean(customer.tradeVin), plan: planChecksForData(customer), runId: "synthetic-form-run" };
}

function install(t) {
  const state = {};
  const requests = [];
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });
  // Node has no IndexedDB. OFAC reports its normal unavailable-data error;
  // these tests assert scheduling and MDOS payloads, never an OFAC pass.
  t.mock.method(console, "error", () => {});
  globalThis.chrome = {
    runtime: { id: "synthetic-extension", getURL: (path) => `chrome-extension://synthetic-extension/${path}`, getPlatformInfo: (callback) => callback?.({}) },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    storage: { session: {
      async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, state[key]]))); },
      async set(values) { Object.assign(state, structuredClone(values)); },
    } },
  };
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ path, data: JSON.parse(options.body) });
    assert.ok(["/api/title-check", "/api/repeat-offender"].includes(path));
    return new Response(JSON.stringify(path === "/api/title-check" ? {
      success: true, passed: true, details: { titleStatus: "clear", hasLien: false, titleBrand: "CLEAN" },
    } : { success: true, passed: true, status: "eligible", message: "Synthetic fixture" }), { headers: { "Content-Type": "application/json" } });
  };
  return { state, requests };
}

async function run(payload) {
  const response = await handleMessage({ type: "RUN_ALL_CHECKS", data: payload }, {
    id: "synthetic-extension", url: "chrome-extension://synthetic-extension/sidepanel.html",
  });
  for (let attempt = 0; attempt < 1000 && isRunInFlight(); attempt++) await setImmediate();
  assert.equal(isRunInFlight(), false, "the synthetic run must settle");
  return response;
}

test("router runs VIN-only using the exact parent getFormData payload", async (t) => {
  const { state, requests } = install(t);
  const payload = formPayload({ tradeVin: vin });
  assert.equal(payload.customer.firstName, "");
  assert.equal(payload.customer.dob, "");
  assert.equal((await run(payload)).success, true);
  assert.deepEqual(requests, [{ path: "/api/title-check", data: { vin } }]);
  assert.equal(state.currentResults.checks.ofac.status, "skipped");
  assert.equal(state.currentResults.checks.repeatOffender.status, "skipped");
  assert.equal(state.currentResults.checks.title.passed, true);
});

test("router runs co-buyer-only from the exact checked parent form payload", async (t) => {
  const { state, requests } = install(t);
  const payload = formPayload({ cbFirstName: buyer.firstName, cbLastName: buyer.lastName, cbDob: buyer.dob, cbDlnPid: buyer.dlnPid }, true);
  assert.equal(payload.customer.coBuyer.dob, "1985-03-14");
  assert.equal((await run(payload)).success, true);
  assert.deepEqual(requests.map((request) => request.path), ["/api/repeat-offender"]);
  assert.equal(requests[0].data.firstName, buyer.firstName);
  assert.equal(requests[0].data.dob, "1985-03-14");
  assert.equal(state.currentResults.checks.ofac.status, "skipped");
  assert.equal(state.currentResults.checks.coBuyerRepeatOffender.status, "eligible");
  assert.equal(state.currentResults.checks.coBuyerOfac.status, "error");
});

test("forged plan and trade flags cannot skip supplied valid buyer or VIN", async (t) => {
  const { state, requests } = install(t);
  const payload = formPayload({ ...buyer, tradeVin: vin });
  payload.plan = { buyer: false, coBuyer: false, title: false };
  payload.hasTrade = false;
  assert.equal((await run(payload)).success, true);
  assert.deepEqual(requests.map((request) => request.path), ["/api/repeat-offender", "/api/title-check"]);
  assert.equal(state.currentResults.hasTrade, true);
  assert.equal(state.currentResults.checks.ofac.status, "error");
});

test("a forged co-buyer flag cannot hide an identity included in the payload", async (t) => {
  const { state, requests } = install(t);
  const payload = formPayload({ cbFirstName: buyer.firstName, cbLastName: buyer.lastName, cbDob: buyer.dob, cbDlnPid: buyer.dlnPid }, true);
  payload.customer.hasCoBuyer = false;
  payload.plan.coBuyer = false;
  assert.equal((await run(payload)).success, true);
  assert.equal(state.currentResults.customer.hasCoBuyer, true);
  assert.equal(requests[0].path, "/api/repeat-offender");
});

for (const [label, payload] of [
  ["empty form despite asserted plan", { ...formPayload(), plan: { buyer: true, coBuyer: true, title: true }, hasTrade: true }],
  ["partial buyer beside VIN", formPayload({ firstName: "Synthetic", tradeVin: vin })],
  ["middle-name-only buyer beside VIN", formPayload({ middleName: "Synthetic", tradeVin: vin })],
  ["partial co-buyer beside VIN", formPayload({ cbFirstName: "Synthetic", tradeVin: vin }, true)],
  ["invalid co-buyer birthdate", formPayload({ cbFirstName: buyer.firstName, cbLastName: buyer.lastName, cbDob: "02/31/1985", cbDlnPid: buyer.dlnPid }, true)],
  ["invalid Michigan license", formPayload({ ...buyer, dlnPid: "123" })],
  ["invalid trade VIN", formPayload({ ...buyer, tradeVin: "INVALID" })],
]) {
  test(`router rejects ${label} before publishing or calling a service`, async (t) => {
    const { state, requests } = install(t);
    payload.plan = { buyer: false, coBuyer: false, title: true };
    const response = await run(payload);
    assert.equal(response.success, false);
    assert.match(response.error, /Invalid RUN_ALL_CHECKS payload/);
    assert.deepEqual(state, {});
    assert.deepEqual(requests, []);
  });
}
