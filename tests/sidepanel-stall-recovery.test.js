import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { CONFIG } from "../lib/config.js";
import { SEARCH_STATUS, STORAGE_KEYS } from "../lib/storage-keys.js";
import { acceptsRunStatusUpdate, createOperationFence, isCurrentRunState } from "../lib/run-fence.js";

const source = readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = end ? source.indexOf(end, from) : source.length;
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
const recoverySource = [
  section("// ---------- Slow-check messaging and recovery ----------", "// ---------- Storage listener"),
  section("async function handleRunAllChecks(", "function showHistorySaveWarning("),
  section("async function applyPersistedResults(", "// ---------- SOS fee quote ----------"),
  section("async function handleSessionStorageChanges(", "function handleSearchStatusChange("),
  section("function handleSearchStatusChange("),
].join("\n");

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function harness({ startReply = { success: true }, cancelReply = { success: true }, persisted } = {}) {
  let clock = 0, nextTimer = 0, sequence = 0;
  const timers = new Map();
  const messages = [], notices = [], history = [];
  const customer = { firstName: "Synthetic", lastName: "Test", dob: "1980-01-01", dlnPid: "S123456789012" };
  const field = (...classes) => {
    const names = new Set(classes);
    return {
      value: "", style: {}, dataset: {}, textContent: "",
      classList: {
        add: (name) => names.add(name), remove: (name) => names.delete(name),
        contains: (name) => names.has(name),
      },
      focus() {},
    };
  };
  const elements = {
    firstName: field(), resultsSection: field("hidden"), progressSection: field(),
    progressLabel: field(), progressSpinner: field(), titleCheckItem: field(),
    ofacStatus: field("status-running"), repeatStatus: field("status-waiting"),
    titleStatus: field("status-skipped"),
  };
  const context = vm.createContext({
    CONFIG, SEARCH_STATUS, STORAGE_KEYS, acceptsRunStatusUpdate,
    createOperationFence, isCurrentRunState,
    elements, console,
    activeUiRunId: null, activeIndividualOperationId: null,
    running: false, buttonsDisabled: false, cardsLoading: false,
    currentResults: null, completeRevealTimer: null,
    scanJurisdiction: { buyer: null, coBuyer: null }, inputOpen: true,
    session: {}, renderedResults: 0,
    getFormData: () => customer, validateCustomerFields: () => true,
    planChecksForData: () => ({ buyer: true, coBuyer: false, title: false }),
    cacheCurrentFormData: async () => true,
    createRunId: () => "synthetic-" + ++sequence,
    showToast: (message, type) => notices.push({ message, type }),
    describeError: (error) => error.message,
    resetProgress: () => {},
    setCheckStatus: (el, status) => {
      for (const previous of ["running", "waiting", "warning", "skipped"]) el.classList.remove("status-" + previous);
      el.classList.add("status-" + status);
    },
    updateProgress: (_el, _pct, label) => { if (label) elements.progressLabel.textContent = label; },
    syncReportSelection: () => {},
    resetInputPanel: () => { context.inputOpen = true; },
    setInputCollapsed: (collapsed) => { context.inputOpen = !collapsed; },
    setIsRunning: (running) => { context.running = running; },
    getIsRunning: () => context.running,
    setButtonsDisabled: (_el, value) => { context.buttonsDisabled = value; },
    setCardsLoadingState: (_el, value) => { context.cardsLoading = value; },
    getCurrentResults: () => context.currentResults,
    setCurrentResults: (value) => { context.currentResults = value; },
    loadPersistedResults: async () => persisted,
    applyInFlight: () => {}, statusForCheck: () => "pass",
    displayResults: () => { context.renderedResults++; },
    saveToHistory: async (result) => { history.push(result); return true; },
    refreshHistoryCountAndActions: async () => {},
    announceVerdict: () => {}, showHistorySaveWarning: () => {},
    setTimeout: (fn, delay) => {
      const id = ++nextTimer;
      timers.set(id, { fn, at: clock + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    chrome: {
      runtime: { sendMessage: (message) => {
        messages.push(message);
        return Promise.resolve(message.type === "CANCEL_CURRENT_RUN" ? cancelReply : startReply);
      } },
      storage: { session: { get: async () => context.session } },
    },
  });
  vm.runInContext(recoverySource, context);
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const tick = async (duration) => {
    const target = clock + duration;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      clock = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await settle();
    }
    clock = target;
    await settle();
  };
  const publish = async (runId, status, progress = 20) => {
    const previousStatus = context.session[STORAGE_KEYS.searchStatus];
    context.session = {
      [STORAGE_KEYS.activeRunId]: runId, [STORAGE_KEYS.stateRunId]: runId,
      [STORAGE_KEYS.searchStatus]: status, [STORAGE_KEYS.searchProgress]: progress,
      [STORAGE_KEYS.currentResults]: { runId, customer, checks: {} },
    };
    await context.handleSessionStorageChanges({
      ...(previousStatus === status ? {} : { [STORAGE_KEYS.searchStatus]: { newValue: status } }),
      [STORAGE_KEYS.searchProgress]: { newValue: progress },
      [STORAGE_KEYS.currentResults]: { newValue: context.session[STORAGE_KEYS.currentResults] },
    });
  };
  return { context, elements, messages, notices, customer, history, tick, publish, settle };
}

test("missing start acknowledgment unlocks the form even when cancellation never replies", async () => {
  const start = deferred(), cancel = deferred();
  const h = harness({ startReply: start.promise, cancelReply: cancel.promise });
  const run = h.context.handleRunAllChecks();
  await h.settle();
  const runId = h.context.activeUiRunId;
  await h.tick(15000);
  assert.equal(h.context.running, false);
  assert.equal(h.context.buttonsDisabled, false);
  assert.equal(h.context.inputOpen, true);
  assert.equal(h.elements.progressSpinner.style.display, "none");
  assert.match(h.elements.progressLabel.textContent, /did not confirm the start/);
  assert.equal(h.messages.at(-1).type, "CANCEL_CURRENT_RUN");
  assert.equal(h.messages.at(-1).runId, runId);
  await h.tick(5000);
  assert.match(h.notices.at(-1).message, /cancellation could not be confirmed/);
  assert.equal(h.customer.firstName, "Synthetic");
  assert.equal(h.history.length, 0);
  start.resolve({ success: true });
  await run;
  await h.publish(runId, SEARCH_STATUS.complete, 100);
  assert.equal(h.context.running, false);
  assert.equal(h.context.renderedResults, 0);
  assert.equal(h.history.length, 0);
  assert.equal(h.elements.resultsSection.classList.contains("hidden"), true);
});

test("meaningful progress renews the stall deadline, repeated progress does not", async () => {
  const h = harness();
  await h.context.handleRunAllChecks();
  const runId = h.context.activeUiRunId;
  await h.publish(runId, SEARCH_STATUS.running, 0);
  await h.tick(CONFIG.timeouts.stuckSearchTimeout - 1000);
  await h.publish(runId, SEARCH_STATUS.running, 20);
  await h.tick(CONFIG.timeouts.stuckSearchTimeout - 1000);
  assert.equal(h.context.running, true, "a multi-step run may exceed the total startup age");
  // No new searchStatus event: repeating an unchanged progress snapshot must
  // not make a stuck service look alive forever.
  await h.context.handleSessionStorageChanges({ [STORAGE_KEYS.searchProgress]: { newValue: 20 } });
  await h.tick(1000);
  assert.equal(h.context.running, false);
  assert.match(h.elements.progressLabel.textContent, /did not complete/);
  assert.equal(h.history.length, 0);
});

test("a retry is immune to the old cancellation failure and late completion", async () => {
  const cancel = deferred();
  const h = harness({ cancelReply: cancel.promise });
  await h.context.handleRunAllChecks();
  const expired = h.context.activeUiRunId;
  await h.tick(CONFIG.timeouts.stuckSearchTimeout);
  await h.context.handleRunAllChecks();
  const retry = h.context.activeUiRunId;
  const notices = h.notices.length;
  assert.notEqual(retry, expired);
  cancel.reject(new Error("late cancellation transport error"));
  await h.settle();
  await h.publish(expired, SEARCH_STATUS.complete, 100);
  assert.equal(h.context.activeUiRunId, retry);
  assert.equal(h.context.running, true);
  assert.equal(h.notices.length, notices);
  assert.equal(h.context.renderedResults, 0);
  await h.publish(retry, SEARCH_STATUS.running, 20);
  await h.publish(retry, SEARCH_STATUS.complete, 100);
  await h.tick(CONFIG.timeouts.stuckSearchTimeout);
  assert.equal(h.context.running, false);
  assert.equal(h.context.renderedResults, 1);
  assert.equal(h.history.length, 1);
});

test("restored live and stale runs use bounded recovery without erasing the draft", async () => {
  for (const stalled of [false, true]) {
    const cancel = deferred();
    const h = harness({
      cancelReply: cancel.promise,
      persisted: { state: "running", runId: "restored", stalled, progress: 45, results: { checks: {} } },
    });
    await h.context.applyPersistedResults();
    if (!stalled) {
      assert.equal(h.context.running, true);
      await h.tick(CONFIG.timeouts.stuckSearchTimeout);
    }
    assert.equal(h.context.running, false);
    assert.equal(h.context.buttonsDisabled, false);
    assert.equal(h.messages.at(-1).runId, "restored");
    assert.equal(h.customer.firstName, "Synthetic");
    assert.equal(h.history.length, 0);
    await h.tick(5000);
    assert.match(h.notices.at(-1).message, /cancellation could not be confirmed/);
  }
});
