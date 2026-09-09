import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptsRunStatusUpdate,
  isCheckCancelled,
  RESULT_STATE_MESSAGES,
} from "../lib/run-fence.js";
import { handleMessage } from "../src/worker/message-router.js";
import { handleRunAllChecks, cancelCurrentRun } from "../src/worker/orchestrator.js";
import { cancelIndividualOperation, handleTitleCheck, isIndividualMdosInFlight } from "../src/worker/mdos-check.js";
import { atomicStateUpdate, reconcileInterruptedRun } from "../src/worker/state.js";
import { createSosFeeRunner } from "../src/worker/sos-fee-runner.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function install(seed = {}, beforeSet = async () => {}) {
  const state = structuredClone(seed);
  const writes = [];
  const badges = [];
  const session = {
    async get(keys) {
      return structuredClone(Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, state[key]])
      ));
    },
    async set(values) {
      const snapshot = structuredClone(values);
      await beforeSet(snapshot);
      Object.assign(state, snapshot);
      writes.push(snapshot);
    },
    async remove(keys) {
      for (const key of keys) delete state[key];
    },
    async setAccessLevel() {},
  };
  globalThis.chrome = {
    storage: { session, local: { async get() { return {}; }, async setAccessLevel() {} } },
    action: {
      async setBadgeText({ text }) { badges.push(text); },
      async setBadgeBackgroundColor() {},
    },
    runtime: {
      id: "test-extension",
      getURL: (path = "") => `chrome-extension://test-extension/${path}`,
      getPlatformInfo: (callback) => callback?.({}),
      sendMessage: (message) => handleMessage(message, sender),
    },
  };
  return { state, writes, badges };
}

const sender = { id: "test-extension", url: "chrome-extension://test-extension/sidepanel.html" };
const full = (runId, timestamp = new Date().toISOString()) => ({
  runId, runType: "full", timestamp, checks: {}, customer: { firstName: runId },
});
const individual = (operationId) => ({
  operationId, runType: "individual", timestamp: new Date().toISOString(),
  customer: { firstName: operationId }, checks: { ofac: { passed: true } },
});
const completed = (runId) => ({
  activeRunId: runId, stateRunId: runId, searchStatus: "complete", currentResults: full(runId),
});
const start = (runId) => handleRunAllChecks({
  runId, customer: { hasCoBuyer: false }, hasTrade: false,
  plan: { buyer: false, coBuyer: false, title: false },
});
const persist = (results, expectedResultId = null) => handleMessage({
  type: RESULT_STATE_MESSAGES.persist, data: { results, expectedResultId },
}, sender);

test("another panel's save queued during initial publication cannot replace the active or completed results", async () => {
  const entered = deferred();
  const release = deferred();
  const { state } = install({}, async (values) => {
    if (values.searchStatus === "running") { entered.resolve(); await release.promise; }
  });
  const running = start("owner-a");
  await entered.promise;
  const saving = persist(individual("panel-b"));
  release.resolve();
  assert.equal((await saving).persisted, false);
  assert.equal((await running).success, true);
  assert.equal(state.currentResults.runId, "owner-a");
  assert.equal(state.currentResults.customer.firstName, undefined);
  assert.equal((await persist(individual("panel-b"))).persisted, false);
  assert.equal(state.searchStatus, "complete");
  assert.equal(state.activeRunId, "owner-a");
});

test("an individual save completes before a queued new run claims the shared results", async () => {
  const entered = deferred();
  const release = deferred();
  const { state } = install({}, async (values) => {
    if (values.currentResults?.operationId === "panel-b") { entered.resolve(); await release.promise; }
  });
  const saving = persist(individual("panel-b"));
  await entered.promise;
  const running = start("owner-a");
  release.resolve();
  assert.equal((await saving).persisted, true);
  assert.equal((await running).success, true);
  assert.equal(state.currentResults.runId, "owner-a");
});

test("cancellation cannot erase a new run while its durable tombstone is pending", async () => {
  const entered = deferred();
  const release = deferred();
  const { state, badges } = install(completed("old"), async (values) => {
    if (values.cancelledRunId === "old") { entered.resolve(); await release.promise; }
  });
  const cancelling = cancelCurrentRun("old");
  await entered.promise;
  const running = start("new");
  release.resolve();
  await cancelling;
  assert.equal((await running).success, true);
  const before = structuredClone(state);
  const badgeCount = badges.length;
  await cancelCurrentRun("old");
  assert.deepEqual(state, before);
  assert.equal(badges.length, badgeCount);
  assert.equal(state.currentResults.runId, "new");
});

test("a delayed start stays cancelled even after another window cancels a different run", async () => {
  const { state } = install();
  await cancelCurrentRun("delayed-a");
  await cancelCurrentRun("delayed-b");
  assert.equal((await start("delayed-a")).cancelled, true);
  assert.equal(isCheckCancelled(state, "run:delayed-a"), true);
  assert.notEqual(state.searchStatus, "running");
});

test("unidentified cancellation is rejected and cannot clear another panel", async () => {
  const { state, badges } = install(completed("owner"));
  const before = structuredClone(state);
  for (const runId of [undefined, null, ""]) {
    const result = await handleMessage({ type: "CANCEL_CURRENT_RUN", runId }, sender);
    assert.equal(result.success, false);
  }
  assert.deepEqual(state, before);
  assert.deepEqual(badges, []);
});

test("a completed owner's triage edit preserves completion and a new individual check can replace its own previous result", async () => {
  const { state } = install(completed("owner"));
  const revised = full("owner");
  revised.checks.ofac = { disposition: "false_positive" };
  assert.equal((await persist(revised, "run:owner")).persisted, true);
  assert.equal(state.searchStatus, "complete");
  const panel = await import("../src/sidepanel/state.js?owner-test");
  panel.setCurrentResults(revised);
  panel.mergeIntoCurrentResults({}, "ofac", { passed: true }, { replace: true, operationId: "new-individual" });
  assert.equal(await panel.persistCurrentResults(), true);
  assert.equal(state.currentResults.operationId, "new-individual");
  assert.equal(state.activeRunId, null);
});

test("a cancelled individual result cannot be saved by a delayed panel even after a second cancellation", async () => {
  const { state } = install();
  await cancelIndividualOperation("operation-a");
  await cancelIndividualOperation("operation-b");
  assert.equal((await persist(individual("operation-a"))).persisted, false);
  assert.equal(state.currentResults, undefined);
});

test("saving an owned Michigan result releases its slot for the next individual check", async () => {
  const { state } = install({ activeIndividualOperationId: "mdos", currentResults: null });
  const mdos = individual("mdos");
  assert.equal((await persist(mdos, "run:previous")).persisted, true);
  assert.equal(state.activeIndividualOperationId, null);
  assert.equal((await persist(individual("next-ofac"), "operation:mdos")).persisted, true);
  assert.equal(state.currentResults.operationId, "next-ofac");
});

test("restoring a cleared history entry creates a fresh reopenable working identity", async () => {
  const { state } = install({ cancelledRunId: "old" });
  const panel = await import("../src/sidepanel/state.js?restore-test");
  panel.setCurrentResults(full("old"));
  assert.equal(await panel.persistCurrentResults({ restore: true }), true);
  assert.notEqual(state.currentResults.runId, "old");
  assert.equal(panel.getCurrentResults().runId, state.currentResults.runId);
  assert.equal((await panel.loadPersistedResults()).state, "complete");
});

test("an individual cancel cannot remove a full run's screenshots or badge", async () => {
  const { state, badges } = install({ ...completed("full-new"),
    activeIndividualOperationId: "individual-old", titleScreenshot: "new-image",
  });
  await cancelIndividualOperation("individual-old");
  assert.equal(state.titleScreenshot, "new-image");
  assert.equal(state.currentResults.runId, "full-new");
  assert.deepEqual(badges, []);
});

test("failed individual initialization releases the in-memory slot", async () => {
  install({}, async () => { throw new Error("quota"); });
  await assert.rejects(handleTitleCheck({ vin: "1HGBH41JXMN109186", operationId: "failed" }), /quota/);
  assert.equal(isIndividualMdosInFlight(), false);
});

test("expired-result cleanup arriving after a new run is a no-op", async () => {
  const old = full("old", "2000-01-01T00:00:00.000Z");
  const { state } = install(completed("new"));
  const reply = await handleMessage({ type: RESULT_STATE_MESSAGES.discard,
    data: { resultId: "run:old", timestamp: old.timestamp },
  }, sender);
  assert.equal(reply.discarded, false);
  assert.equal(state.currentResults.runId, "new");
});

test("reopening stale state delegates exact-run cancellation and never directly clears shared storage", async () => {
  const old = full("old", "2000-01-01T00:00:00.000Z");
  const { state } = install({ ...completed("old"), searchStatus: "running", currentResults: old });
  const sendMessage = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = async (message) => {
    // Another window started after this panel read the expired record.
    Object.assign(state, completed("new"));
    return sendMessage(message);
  };
  const panel = await import("../src/sidepanel/state.js?stale-test");
  assert.equal((await panel.loadPersistedResults()).state, "idle");
  assert.equal(state.currentResults.runId, "new");
  assert.equal(state.searchStatus, "complete");
});

test("restart reconciliation fences orphaned individual replies and full-run statuses by identity", async () => {
  const { state } = install({ ...completed("orphan"), searchStatus: "running", activeIndividualOperationId: "orphan-individual" });
  await reconcileInterruptedRun();
  assert.equal(state.searchStatus, "error");
  assert.equal(state.activeIndividualOperationId, null);
  assert.equal((await persist(individual("orphan-individual"))).persisted, false);
  assert.equal(acceptsRunStatusUpdate(state, "orphan", "error"), true);
  assert.equal(acceptsRunStatusUpdate(state, "other", "error"), false);
  const panel = await import("../src/sidepanel/state.js?restart-test");
  assert.equal((await panel.loadPersistedResults()).state, "idle");
});

test("a failed state publication does not poison the queue or report durable success", async () => {
  let failing = true;
  const { state } = install(completed("owner"), async () => {
    if (failing) throw new Error("quota");
  });
  await assert.rejects(cancelCurrentRun("owner"), /quota/);
  assert.equal(state.activeRunId, "owner");
  failing = false;
  assert.equal((await atomicStateUpdate(() => ({ searchProgress: 25 }))).applied, true);
  assert.equal(state.searchProgress, 25);
});

test("service worker refuses messages if restart reconciliation could not be persisted", async () => {
  let attempts = 0;
  const { state } = install({ ...completed("orphan"), searchStatus: "running" }, async () => {
    attempts++;
    if (attempts === 1) throw new Error("startup storage unavailable");
  });
  let onMessage;
  chrome.runtime.onMessage = { addListener(listener) { onMessage = listener; } };
  chrome.runtime.onStartup = chrome.runtime.onInstalled = { addListener() {} };
  chrome.sidePanel = { async setPanelBehavior() {} };
  chrome.alarms = { onAlarm: { addListener() {} } };
  await import("../service-worker.js?failed-startup-test");
  const reply = await new Promise((resolve) => onMessage({
    type: RESULT_STATE_MESSAGES.persist,
    data: { results: individual("new"), expectedResultId: "run:orphan" },
  }, sender, resolve));
  assert.equal(reply.success, false);
  assert.match(reply.error, /recover the previous check state/);
  assert.equal(state.currentResults.runId, "orphan");
  assert.equal(attempts, 1);
});

test("SOS owners cannot cancel or supersede another panel's quote", async () => {
  const pending = deferred();
  let signal;
  let calls = 0;
  const runner = createSosFeeRunner({ requestQuote: async (_data, options) => {
    calls++; signal = options.signal; return pending.promise;
  } });
  const fields = [{ kind: "text", label: "MSRP", value: "40000" }];
  const first = runner.calculate("new_plate", fields, "panel-a");
  assert.equal(runner.cancel("panel-b").cancelled, false);
  assert.equal(signal.aborted, false);
  assert.equal((await runner.calculate("new_plate", fields, "panel-c")).busy, true);
  assert.equal(calls, 1);
  pending.resolve({ success: true, quote: { feeCents: 10000 } });
  assert.deepEqual(await first, { success: true, requestId: "panel-a", quote: { feeCents: 10000 } });
});

test("SOS cancel fences a delayed start and an old response cannot release the replacement slot", async () => {
  const firstResult = deferred();
  const secondResult = deferred();
  let calls = 0;
  const runner = createSosFeeRunner({ requestQuote: () => ++calls === 1 ? firstResult.promise : secondResult.promise });
  const fields = [{ kind: "text", label: "MSRP", value: "40000" }];
  runner.cancel("delayed");
  assert.equal((await runner.calculate("new_plate", fields, "delayed")).cancelled, true);
  const first = runner.calculate("new_plate", fields, "first");
  assert.equal(runner.cancel("first").cancelled, true);
  const second = runner.calculate("new_plate", fields, "second");
  firstResult.resolve({ success: true, quote: {} });
  assert.equal((await first).cancelled, true);
  assert.equal(runner.isInFlight(), true);
  secondResult.resolve({ success: true, quote: {} });
  assert.equal((await second).requestId, "second");
  assert.equal(runner.isInFlight(), false);
});

test("SOS router requires an explicit request owner for start and cancellation", async () => {
  install();
  for (const type of ["SOS_FEE_CALCULATE", "SOS_FEE_CANCEL"]) {
    const response = await handleMessage({ type, data: { mode: "new_plate", fields: [{ kind: "text", label: "MSRP", value: "40000" }] } }, sender);
    assert.equal(response.success, false);
    assert.match(response.error, /Invalid/);
  }
});
