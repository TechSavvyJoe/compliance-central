import assert from "node:assert/strict";
import test from "node:test";

import { STORAGE_KEYS } from "../lib/storage-keys.js";
import {
  cancelIndividualOperation,
  handleRepeatOffenderCheck,
  handleTitleCheck,
} from "../src/worker/mdos-check.js";

function mockChromeSession(initial = {}) {
  const state = { ...initial };
  const badgeTexts = [];
  globalThis.chrome = {
    runtime: {
      getPlatformInfo(callback) {
        callback?.({});
      },
    },
    action: {
      async setBadgeText({ text }) {
        badgeTexts.push(text);
      },
      async setBadgeBackgroundColor() {},
    },
    storage: {
      session: {
        async set(values) {
          Object.assign(state, values);
        },
        async get(keys) {
          const selected = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            selected[key] = state[key];
          }
          return selected;
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete state[key];
          }
        },
      },
    },
  };
  return { state, badgeTexts };
}

function deferredFetch() {
  let resolveFetch;
  let markStarted;
  let requestSignal;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  globalThis.fetch = (_url, options) => {
    requestSignal = options.signal;
    markStarted();
    // Deliberately ignore AbortSignal here. The operation tombstone must still
    // reject a backend result that arrives after Clear.
    return new Promise((resolve) => {
      resolveFetch = resolve;
    });
  };
  return {
    started,
    resolve(payload) {
      resolveFetch({
        ok: true,
        status: 200,
        async json() {
          return payload;
        },
      });
    },
    get signal() {
      return requestSignal;
    },
  };
}

test("Clear aborts and fences a late individual Repeat Offender result", async () => {
  const { state, badgeTexts } = mockChromeSession();
  const pending = deferredFetch();
  const operationId = "repeat-operation-race";

  const check = handleRepeatOffenderCheck({
    firstName: "Test",
    lastName: "Buyer",
    dlnPid: "S123456789012",
    operationId,
  });
  await pending.started;

  const cancelled = await cancelIndividualOperation(operationId);
  assert.equal(cancelled.success, true);
  assert.equal(cancelled.cancelled, true);
  assert.equal(pending.signal.aborted, true);

  pending.resolve({
    success: true,
    status: "eligible",
    passed: true,
    screenshot: "data:image/png;base64,late-repeat-image",
    message: "Eligible",
  });
  const result = await check;

  assert.equal(result.cancelled, true);
  assert.equal(state[STORAGE_KEYS.repeatOffenderScreenshot], undefined);
  assert.equal(state[STORAGE_KEYS.lastResult], undefined);
  assert.equal(state[STORAGE_KEYS.activeIndividualOperationId], null);
  assert.equal(
    state[STORAGE_KEYS.cancelledIndividualOperationId],
    operationId
  );
  assert.equal(badgeTexts.at(-1), "");
  assert.equal(badgeTexts.includes("✓"), false);
});

test("Clear fences a late individual Title screenshot", async () => {
  const { state } = mockChromeSession();
  const pending = deferredFetch();
  const operationId = "title-operation-race";

  const check = handleTitleCheck({
    vin: "1HGBH41JXMN109186",
    operationId,
  });
  await pending.started;
  await cancelIndividualOperation(operationId);

  pending.resolve({
    success: true,
    passed: true,
    screenshot: "data:image/png;base64,late-title-image",
    details: {
      titleStatus: "Clear",
      titleBrand: "CLEAN",
      hasLien: false,
    },
  });
  const result = await check;

  assert.equal(result.cancelled, true);
  assert.equal(state[STORAGE_KEYS.titleScreenshot], undefined);
  assert.equal(state[STORAGE_KEYS.lastResult], undefined);
});

test("a persisted operation tombstone prevents a delayed worker request", async () => {
  const operationId = "already-cleared-operation";
  mockChromeSession({
    [STORAGE_KEYS.cancelledIndividualOperationId]: operationId,
  });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not run for a cleared operation");
  };

  const result = await handleTitleCheck({
    vin: "1HGBH41JXMN109186",
    operationId,
  });

  assert.equal(result.cancelled, true);
  assert.equal(fetchCalls, 0);
});
