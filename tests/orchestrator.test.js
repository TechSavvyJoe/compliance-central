import assert from "node:assert/strict";
import test from "node:test";

import { handleRunAllChecks } from "../src/worker/orchestrator.js";

test("a second concurrent Run All Checks is rejected while one is in flight", async () => {
  let firstSetSeen = false;
  globalThis.chrome = {
    storage: {
      session: {
        // First write hangs, so the first run stays in flight; later writes resolve.
        set() {
          if (!firstSetSeen) {
            firstSetSeen = true;
            return new Promise(() => {});
          }
          return Promise.resolve();
        },
        async get() {
          return {};
        },
      },
    },
  };

  const customer = { firstName: "John", lastName: "Doe", hasCoBuyer: false };

  // Start the first run (never resolves — intentionally floats).
  handleRunAllChecks({ customer, hasTrade: false });

  // Second call must be refused by the single-flight guard.
  const second = await handleRunAllChecks({ customer, hasTrade: false });
  assert.equal(second.success, false);
  assert.match(second.error, /already in progress/i);
});
