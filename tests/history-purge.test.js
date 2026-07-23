import assert from "node:assert/strict";
import test from "node:test";

import { CONFIG } from "../lib/config.js";
import {
  minimizeHistoryEntry,
  retainAuditHistory,
} from "../lib/history-retention.js";
import { STORAGE_KEYS } from "../lib/storage-keys.js";
import { purgeOldHistoryEntries } from "../src/sidepanel/history.js";
import { handleHistoryMessage } from "../src/worker/history.js";

test("purge keeps recent entries, drops expired and corrupt-timestamp entries", async () => {
  const day = 24 * 60 * 60 * 1000;
  const recentIso = new Date().toISOString();
  const expiredIso = new Date(
    Date.now() - (CONFIG.limits.dataRetentionDays + 5) * day
  ).toISOString();

  const stored = {
    [STORAGE_KEYS.complianceHistory]: [
      { id: 1, timestamp: recentIso, customer: "Recent Keep" },
      { id: 2, timestamp: expiredIso, customer: "Old Drop" },
      { id: 3, timestamp: "not-a-real-date", customer: "Corrupt Drop" },
    ],
  };

  globalThis.chrome = {
    runtime: {
      sendMessage(message) {
        return handleHistoryMessage(message.type, message.data);
      },
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: stored[key] };
        },
        async set(update) {
          Object.assign(stored, update);
        },
      },
      session: {
        async get() {
          return {};
        },
      },
    },
  };

  const purged = await purgeOldHistoryEntries();
  const remaining = stored[STORAGE_KEYS.complianceHistory];

  assert.equal(purged, 2);
  assert.equal(remaining.length, 1);
  assert.match(remaining[0].reference, /^CC-\d{8}-\d{6}$/);
  assert.equal("customer" in remaining[0], false);
  assert.doesNotMatch(JSON.stringify(remaining[0]), /Recent Keep/);
});

test("legacy PII-bearing history is migrated to typed anonymous outcomes", () => {
  const migrated = minimizeHistoryEntry({
    id: 123,
    timestamp: "2026-06-16T14:30:00.000Z",
    decision: "APPROVED",
    customer: "Jane Doe",
    vin: "1HGBH41JXMN109186",
    fullResults: {
      customer: {
        firstName: "Jane",
        lastName: "Doe",
        dob: "1980-01-01",
        dlnPid: "S123456789012",
        tradeVin: "1HGBH41JXMN109186",
        hasCoBuyer: true,
      },
      checks: {
        ofac: { passed: true },
        repeatOffender: { passed: false, status: "error", error: "Unavailable" },
        coBuyerOfac: { passed: false, hasMatch: true, matchCount: 2 },
        coBuyerRepeatOffender: { status: "not_applicable" },
        title: { passed: true, titleBrand: "CLEAN", hasLien: true },
      },
    },
  });

  assert.deepEqual(migrated.checks, {
    ofac: "clear",
    repeatOffender: "error",
    coBuyerOfac: "match",
    coBuyerRepeatOffender: "na",
    title: "lien",
  });
  assert.equal(migrated.hasCoBuyer, true);
  assert.equal(migrated.hasTrade, true);
  const serialized = JSON.stringify(migrated);
  for (const privateValue of [
    "Jane",
    "Doe",
    "1980-01-01",
    "S123456789012",
    "1HGBH41JXMN109186",
    "Unavailable",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue));
  }
});

test("retention sorts newest first, caps entries, and rejects invalid timestamps", () => {
  const now = new Date("2026-06-20T12:00:00.000Z").getTime();
  const entries = [
    { id: 1, timestamp: "2026-06-18T12:00:00.000Z", decision: "APPROVED" },
    { id: 2, timestamp: "not-a-date", decision: "APPROVED" },
    { id: 3, timestamp: "2026-06-19T12:00:00.000Z", decision: "REVIEW" },
    { id: 4, timestamp: "2026-06-17T12:00:00.000Z", decision: "DENIED" },
  ];
  const retained = retainAuditHistory(entries, {
    now,
    retentionDays: 30,
    maxEntries: 2,
  });
  assert.deepEqual(retained.map((entry) => entry.id), [3, 1]);
});
