import assert from "node:assert/strict";
import test from "node:test";

import { runOfacCheck, runTitleCheck } from "../src/sidepanel/checks.js";

test("runOfacCheck passes through stale and dataAgeHours", async () => {
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({
        success: true,
        result: {
          hasMatch: false,
          matches: [],
          matchCount: 0,
          entriesSearched: 10,
          lastUpdate: "2026-01-01T00:00:00.000Z",
          stale: true,
          dataAgeHours: 48,
        },
      }),
    },
  };

  const result = await runOfacCheck({
    firstName: "Test",
    lastName: "User",
    dob: "01/01/1990",
  });
  assert.equal(result.passed, true);
  assert.equal(result.stale, true);
  assert.equal(result.dataAgeHours, 48);
});

test("runOfacCheck handles undefined response without throwing a TypeError", async () => {
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => undefined,
    },
  };

  await assert.rejects(
    () =>
      runOfacCheck({
        firstName: "Test",
        lastName: "User",
      }),
    /OFAC check failed/
  );
});

test("runTitleCheck rejects a malformed success response instead of assuming CLEAN", async () => {
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({ success: true, result: {} }),
    },
    storage: {
      session: {
        async get() {
          return {};
        },
      },
    },
  };

  await assert.rejects(
    () => runTitleCheck({ tradeVin: "1HGBH41JXMN109186" }),
    /incomplete result/i
  );
});
