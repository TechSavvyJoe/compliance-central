import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { acceptsRunStatusUpdate, isCurrentRunState } from "../lib/run-fence.js";
import { SEARCH_STATUS, STORAGE_KEYS } from "../lib/storage-keys.js";

const sidepanelSource = readFileSync(
  new URL("../sidepanel.js", import.meta.url),
  "utf8"
);

function installChrome(sessionSeed = {}) {
  const session = { ...sessionSeed };
  const local = {};
  const area = (bag) => ({
    async setAccessLevel() {},
    async get(keys) {
      if (keys === null || keys === undefined) return { ...bag };
      const out = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) out[key] = bag[key];
      return out;
    },
    async set(obj) {
      Object.assign(bag, obj);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete bag[key];
    },
  });
  globalThis.chrome = {
    runtime: {
      id: "test-ext-id",
      getURL: (path = "") => `chrome-extension://test-ext-id/${path}`,
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
    },
    alarms: {
      async clear() {},
      async create() {},
      onAlarm: { addListener() {} },
    },
    sidePanel: { async setPanelBehavior() {} },
    storage: {
      session: area(session),
      local: area(local),
      onChanged: { addListener() {} },
    },
  };
  return { session, local };
}

async function waitForCondition(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

test("a panel watching a run accepts the interruption the restarted worker publishes", async () => {
  const runId = "run-interrupted-by-worker-restart";
  // Session state exactly as the orchestrator's initial publication leaves it:
  // a full run is in flight and the panel is showing its progress screen.
  const { session } = installChrome({
    [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.running,
    [STORAGE_KEYS.searchProgress]: 45,
    [STORAGE_KEYS.activeRunId]: runId,
    [STORAGE_KEYS.stateRunId]: runId,
    [STORAGE_KEYS.inFlightCheck]: "repeatOffender",
    [STORAGE_KEYS.currentResults]: {
      runId,
      runType: "full",
      checks: {},
      timestamp: new Date().toISOString(),
    },
  });

  // Chrome killed the worker mid-run; this is the replacement worker booting.
  await import("../service-worker.js");
  const reconciled = await waitForCondition(
    () => session[STORAGE_KEYS.searchStatus] === SEARCH_STATUS.error
  );
  assert.ok(reconciled, "the restarted worker must reconcile the orphaned run");

  const runState = {
    activeRunId: session[STORAGE_KEYS.activeRunId],
    stateRunId: session[STORAGE_KEYS.stateRunId],
    cancelledRunId: session[STORAGE_KEYS.cancelledRunId],
  };

  // Reconciliation tears the fence down in the same write that reports the
  // failure, so the run the panel is watching is no longer "current". The
  // panel still has to act on it, or it sits on a spinner that never resolves.
  assert.equal(isCurrentRunState(runState, runId), false);
  assert.equal(
    acceptsRunStatusUpdate(runState, runId, SEARCH_STATUS.error),
    true
  );
  assert.equal(
    typeof session[STORAGE_KEYS.lastError],
    "string",
    "the panel needs an explanation to show"
  );
});

test("run status updates are accepted only for the run the panel is watching", () => {
  const current = {
    activeRunId: "run-a",
    stateRunId: "run-a",
    cancelledRunId: null,
  };
  assert.equal(
    acceptsRunStatusUpdate(current, "run-a", SEARCH_STATUS.running),
    true
  );
  assert.equal(
    acceptsRunStatusUpdate(current, "run-a", SEARCH_STATUS.complete),
    true
  );
  assert.equal(
    acceptsRunStatusUpdate(current, "run-b", SEARCH_STATUS.complete),
    false
  );

  // Idle is the Clear tombstone: every panel returns to rest on it.
  assert.equal(acceptsRunStatusUpdate({}, null, SEARCH_STATUS.idle), true);

  // A failure whose tombstone names another run is not this panel's business.
  const otherRunFailed = {
    activeRunId: null,
    stateRunId: "run-other",
    cancelledRunId: "run-other",
  };
  assert.equal(
    acceptsRunStatusUpdate(otherRunFailed, "run-a", SEARCH_STATUS.error),
    false
  );
  assert.equal(
    acceptsRunStatusUpdate(otherRunFailed, null, SEARCH_STATUS.error),
    false
  );

  // A torn-down fence must not resurrect a running/complete screen.
  const ourRunFailed = {
    activeRunId: null,
    stateRunId: "run-a",
    cancelledRunId: "run-a",
  };
  assert.equal(
    acceptsRunStatusUpdate(ourRunFailed, "run-a", SEARCH_STATUS.error),
    true
  );
  assert.equal(
    acceptsRunStatusUpdate(ourRunFailed, "run-a", SEARCH_STATUS.running),
    false
  );
  assert.equal(
    acceptsRunStatusUpdate(ourRunFailed, "run-a", SEARCH_STATUS.complete),
    false
  );
});

test("the side panel routes published run status through the shared fence", () => {
  assert.match(sidepanelSource, /acceptsRunStatusUpdate/);
  const listener = sidepanelSource.slice(
    sidepanelSource.indexOf("async function handleSessionStorageChanges("),
    sidepanelSource.indexOf("function handleSearchStatusChange(")
  );
  assert.ok(listener.length > 0, "the storage listener must exist");
  assert.match(
    listener,
    /acceptsRunStatusUpdate\(\s*runState,\s*activeUiRunId,\s*status\s*\)/,
    "the searchStatus branch must ask the shared fence"
  );
});
