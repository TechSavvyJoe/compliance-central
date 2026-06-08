import assert from "node:assert/strict";
import test from "node:test";

import { CONFIG } from "../lib/config.js";
import { STORAGE_KEYS } from "../lib/storage-keys.js";
import { purgeOldHistoryEntries } from "../src/sidepanel/history.js";

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
    storage: {
      local: {
        async get(key) {
          return { [key]: stored[key] };
        },
        async set(update) {
          Object.assign(stored, update);
        },
      },
    },
  };

  const purged = await purgeOldHistoryEntries();
  const remaining = stored[STORAGE_KEYS.complianceHistory];

  assert.equal(purged, 2);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].customer, "Recent Keep");
});
