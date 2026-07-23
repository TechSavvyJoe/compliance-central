import assert from "node:assert/strict";
import test from "node:test";

import { CONFIG } from "../lib/config.js";
import { minimizeHistoryEntry } from "../lib/history-retention.js";
import { STORAGE_KEYS } from "../lib/storage-keys.js";
import {
  appendHistoryEntry,
  clearHistory,
  removeHistoryEntry,
} from "../src/worker/history.js";

function anonymousEntry(auditId, offsetMs = 0) {
  const timestamp = new Date(Date.now() + offsetMs).toISOString();
  return minimizeHistoryEntry({
    id: new Date(timestamp).getTime(),
    auditId,
    timestamp,
    decision: "APPROVED",
    runType: "full",
    runLabel: "Run All Checks",
  });
}

function installStorage(initialHistory = [], { delayedReads = false } = {}) {
  const stored = {
    [STORAGE_KEYS.complianceHistory]: structuredClone(initialHistory),
  };
  const cancelled = {
    [STORAGE_KEYS.cancelledRunId]: null,
    [STORAGE_KEYS.cancelledIndividualOperationId]: null,
  };
  let activeLocalReads = 0;
  let maxConcurrentLocalReads = 0;

  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          activeLocalReads += 1;
          maxConcurrentLocalReads = Math.max(
            maxConcurrentLocalReads,
            activeLocalReads
          );
          if (delayedReads) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          activeLocalReads -= 1;
          return { [key]: structuredClone(stored[key]) };
        },
        async set(update) {
          Object.assign(stored, structuredClone(update));
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete stored[key];
          }
        },
      },
      session: {
        async get(key) {
          return { [key]: cancelled[key] };
        },
      },
    },
  };

  return {
    stored,
    cancelled,
    get maxConcurrentLocalReads() {
      return maxConcurrentLocalReads;
    },
  };
}

test("concurrent panel appends are serialized without losing either record", async () => {
  const storage = installStorage([], { delayedReads: true });
  const first = anonymousEntry("run:panel-a", -1);
  const second = anonymousEntry("run:panel-b");

  const results = await Promise.all([
    appendHistoryEntry(first),
    appendHistoryEntry(second),
  ]);

  assert.equal(results.every((result) => result.success && result.saved), true);
  assert.equal(storage.maxConcurrentLocalReads, 1);
  assert.deepEqual(
    new Set(
      storage.stored[STORAGE_KEYS.complianceHistory].map(
        (entry) => entry.auditId
      )
    ),
    new Set(["run:panel-a", "run:panel-b"])
  );
});

test("the same completed run observed by two panels is stored once", async () => {
  const storage = installStorage();
  const entry = anonymousEntry("run:shared-completion");

  const [first, second] = await Promise.all([
    appendHistoryEntry(entry),
    appendHistoryEntry(structuredClone(entry)),
  ]);

  assert.equal(first.saved, true);
  assert.equal(second.saved, true);
  assert.equal(second.duplicate, true);
  assert.equal(storage.stored[STORAGE_KEYS.complianceHistory].length, 1);
  assert.equal(
    storage.stored[STORAGE_KEYS.complianceHistory][0].auditId,
    "run:shared-completion"
  );
});

test("a cancellation tombstone prevents a late history write", async () => {
  const storage = installStorage();
  storage.cancelled[STORAGE_KEYS.cancelledRunId] = "cancelled-run";

  const result = await appendHistoryEntry(
    anonymousEntry("run:cancelled-run")
  );

  assert.equal(result.success, true);
  assert.equal(result.saved, false);
  assert.equal(result.cancelled, true);
  assert.deepEqual(storage.stored[STORAGE_KEYS.complianceHistory], []);
});

test("queued cancellation cleanup removes only its stable audit ID", async () => {
  const storage = installStorage();
  const keep = anonymousEntry("run:keep", -1);
  const remove = anonymousEntry("operation:cancel-me");

  const [saved, removed] = await Promise.all([
    appendHistoryEntry(remove),
    removeHistoryEntry(remove.auditId),
  ]);
  await appendHistoryEntry(keep);

  assert.equal(saved.saved, true);
  assert.equal(removed.removed, true);
  assert.deepEqual(
    storage.stored[STORAGE_KEYS.complianceHistory].map(
      (entry) => entry.auditId
    ),
    ["run:keep"]
  );
});

test("serialized appends still enforce the configured history bound", async () => {
  const storage = installStorage();
  const entries = Array.from(
    { length: CONFIG.limits.maxHistoryEntries + 5 },
    (_, index) => anonymousEntry(`run:bounded-${index}`, index)
  );

  await Promise.all(entries.map((entry) => appendHistoryEntry(entry)));

  assert.equal(
    storage.stored[STORAGE_KEYS.complianceHistory].length,
    CONFIG.limits.maxHistoryEntries
  );
});

test("clear is ordered after already-queued appends", async () => {
  const storage = installStorage([], { delayedReads: true });

  await Promise.all([
    appendHistoryEntry(anonymousEntry("run:before-clear")),
    clearHistory(),
  ]);

  assert.equal(
    storage.stored[STORAGE_KEYS.complianceHistory],
    undefined
  );
});
