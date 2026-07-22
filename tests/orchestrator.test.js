import assert from "node:assert/strict";
import test from "node:test";

import {
  handleRunAllChecks,
  cancelCurrentRun,
  isRunInFlight,
  waitForSettledOrAbort,
} from "../src/worker/orchestrator.js";
import { handleMessage } from "../src/worker/message-router.js";
import { atomicStateUpdate } from "../src/worker/state.js";

function mockChromeSession(handlers = {}) {
  const writes = [];
  const state = {};
  globalThis.chrome = {
    runtime: {
      id: "test-ext-id",
      getURL(path = "") {
        return `chrome-extension://test-ext-id/${path}`;
      },
    },
    action: {
      async setBadgeText() {},
    },
    storage: {
      session: {
        set(obj) {
          Object.assign(state, obj);
          writes.push({ ...obj });
          if (handlers.set) return handlers.set(obj, writes);
          return Promise.resolve();
        },
        async get(keys) {
          if (handlers.get) return handlers.get(keys, state);
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
  return { writes, state };
}

test("cancellation releases orchestration without waiting for a slow shared branch", async () => {
  let resolveSlowBranch;
  const slowBranch = new Promise((resolve) => {
    resolveSlowBranch = resolve;
  });
  const controller = new AbortController();
  const waiting = waitForSettledOrAbort([slowBranch], controller.signal);

  controller.abort();
  assert.equal(await waiting, null);

  // The detached promise is still safely observed by allSettled and may finish
  // later (for example, a shared OFAC refresh used by another caller).
  resolveSlowBranch("done");
  await slowBranch;
});

test("a second concurrent Run All Checks is rejected while one is in flight", async () => {
  let releaseStart;
  const startBlocked = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let blockFirstSet = true;
  mockChromeSession({
    set() {
      if (blockFirstSet) {
        blockFirstSet = false;
        return startBlocked;
      }
      return Promise.resolve();
    },
  });

  const customer = { firstName: "John", lastName: "Doe", hasCoBuyer: false };

  const first = handleRunAllChecks({
    customer,
    hasTrade: false,
    runId: "run-busy",
  });
  assert.equal(isRunInFlight(), true);

  const second = await handleRunAllChecks({ customer, hasTrade: false });
  assert.equal(second.success, false);
  assert.match(second.error, /already in progress/i);
  await cancelCurrentRun("run-busy");
  releaseStart();
  assert.equal((await first).cancelled, true);
});

test("message router returns busy before starting a second RUN_ALL_CHECKS", async () => {
  let releaseStart;
  const startBlocked = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let blockFirstSet = true;
  mockChromeSession({
    set() {
      if (blockFirstSet) {
        blockFirstSet = false;
        return startBlocked;
      }
      return Promise.resolve();
    },
  });

  const customer = {
    firstName: "Jane",
    lastName: "Doe",
    dlnPid: "S123456789012",
    hasCoBuyer: false,
  };
  const first = handleRunAllChecks({
    customer,
    hasTrade: false,
    runId: "run-router-busy",
  });

  const response = await handleMessage(
    { type: "RUN_ALL_CHECKS", data: { customer, hasTrade: false } },
    { id: "test-ext-id" }
  );
  assert.equal(response.success, false);
  assert.match(response.error, /already in progress/i);
  await cancelCurrentRun("run-router-busy");
  releaseStart();
  await first;
});

test("message router reports an initial storage failure instead of false started", async () => {
  mockChromeSession({
    set() {
      return Promise.reject(new Error("session quota exceeded"));
    },
  });
  const customer = {
    firstName: "Jane",
    lastName: "Doe",
    dlnPid: "S123456789012",
    hasCoBuyer: false,
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await handleMessage(
      {
        type: "RUN_ALL_CHECKS",
        data: { customer, hasTrade: false, runId: "run-start-fails" },
      },
      { id: "test-ext-id", url: "chrome-extension://test-ext-id/sidepanel.html" }
    );
    assert.equal(response.success, false);
    assert.match(response.error, /quota exceeded/i);
    assert.equal(isRunInFlight(), false);
  } finally {
    console.error = originalConsoleError;
  }
});

test("a delayed cancel for an older run cannot fence a newer starting run", async () => {
  let releaseStart;
  const startBlocked = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let blockFirstSet = true;
  const { state } = mockChromeSession({
    set() {
      if (blockFirstSet) {
        blockFirstSet = false;
        return startBlocked;
      }
      return Promise.resolve();
    },
    // Model a storage read racing ahead of the new run's pending initial write.
    async get() {
      return {};
    },
  });

  const run = handleRunAllChecks({
    customer: { firstName: "New", lastName: "Buyer", hasCoBuyer: false },
    hasTrade: false,
    runId: "run-new",
  });

  const staleCancel = await cancelCurrentRun("run-old");
  assert.equal(staleCancel.cancelled, false);
  assert.equal(state.activeRunId, "run-new");
  assert.notEqual(state.cancelledRunId, "run-old");

  await cancelCurrentRun("run-new");
  releaseStart();
  await run;
});

test("cancelled run cannot publish completion or leave transient residue", async () => {
  let releaseStart;
  const startBlocked = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let blockFirstSet = true;
  const { writes, state } = mockChromeSession({
    set() {
      if (blockFirstSet) {
        blockFirstSet = false;
        return startBlocked;
      }
      return Promise.resolve();
    },
  });

  state.repeatOffenderScreenshot = "old-image";
  state.lastResult = { status: "eligible" };
  const run = handleRunAllChecks({
    customer: { firstName: "Ann", lastName: "Lee", hasCoBuyer: false },
    hasTrade: false,
    runId: "run-cancelled",
  });
  assert.equal(isRunInFlight(), true);

  const response = await handleMessage(
    { type: "CANCEL_CURRENT_RUN", runId: "run-cancelled" },
    { id: "test-ext-id" }
  );
  assert.equal(response.success, true);
  assert.equal(response.cancelled, true);

  releaseStart();
  const outcome = await run;
  assert.equal(outcome.cancelled, true);
  assert.equal(state.activeRunId, null);
  assert.equal(state.cancelledRunId, "run-cancelled");
  assert.equal(state.repeatOffenderScreenshot, undefined);
  assert.equal(state.lastResult, undefined);
  assert.equal(
    writes.some((write) => write.searchStatus === "complete"),
    false
  );
});

test("message router rejects invalid messages and foreign senders", async () => {
  mockChromeSession();
  const bad = await handleMessage(null, { id: "test-ext-id" });
  assert.equal(bad.success, false);

  const malformedRun = await handleMessage(
    { type: "RUN_ALL_CHECKS", data: { hasTrade: false } },
    { id: "test-ext-id", url: "chrome-extension://test-ext-id/sidepanel.html" }
  );
  assert.equal(malformedRun.success, false);
  assert.match(malformedRun.error, /invalid RUN_ALL_CHECKS payload/i);

  const malformedCancel = await handleMessage(
    { type: "CANCEL_CURRENT_RUN", runId: { unexpected: true } },
    { id: "test-ext-id" }
  );
  assert.equal(malformedCancel.success, false);
  assert.match(malformedCancel.error, /invalid CANCEL_CURRENT_RUN payload/i);

  const foreign = await handleMessage(
    { type: "getDataStatus" },
    { id: "other-extension" }
  );
  assert.equal(foreign.success, false);
  assert.match(foreign.error, /unauthorized/i);

  const contentScript = await handleMessage(
    { type: "getDataStatus" },
    { id: "test-ext-id", url: "https://untrusted.example/page" }
  );
  assert.equal(contentScript.success, false);
  assert.match(contentScript.error, /unauthorized/i);
});

test("atomic state updates report failed storage publication", async () => {
  mockChromeSession({
    set() {
      return Promise.reject(new Error("session quota exceeded"));
    },
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await atomicStateUpdate(() => ({ searchProgress: 100 }));
    assert.equal(result.applied, false);
    assert.match(result.error.message, /quota exceeded/i);
  } finally {
    console.error = originalConsoleError;
  }
});
