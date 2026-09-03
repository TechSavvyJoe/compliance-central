import assert from "node:assert/strict";
import test from "node:test";

import { daysSince, findAgingDeals } from "../src/sidepanel/history.js";

const NOW = new Date("2026-06-16T12:00:00.000Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

test("daysSince counts whole days and fails safe on bad input", () => {
  assert.equal(daysSince(new Date(NOW).toISOString(), NOW), 0);
  assert.equal(daysSince(new Date(NOW - 3 * DAY).toISOString(), NOW), 3);
  assert.equal(daysSince("not-a-date", NOW), null);
});

test("findAgingDeals flags full runs older than the threshold, newest first", () => {
  const history = [
    { timestamp: new Date(NOW - 1 * DAY).toISOString(), runType: "full" }, // fresh
    { timestamp: new Date(NOW - 8 * DAY).toISOString(), runType: "full" }, // aging
    { timestamp: new Date(NOW - 30 * DAY).toISOString(), runType: "full" }, // aging
  ];
  const aging = findAgingDeals(history, 7, NOW);
  assert.equal(aging.length, 2);
  assert.equal(aging[0].timestamp, history[1].timestamp);
});

test("findAgingDeals ignores individual (partial) checks", () => {
  const history = [
    { timestamp: new Date(NOW - 20 * DAY).toISOString(), runType: "individual" },
  ];
  assert.equal(findAgingDeals(history, 7, NOW).length, 0);
});

test("findAgingDeals tolerates empty/undefined history and bad timestamps", () => {
  assert.deepEqual(findAgingDeals([], 7, NOW), []);
  assert.deepEqual(findAgingDeals(undefined, 7, NOW), []);
  assert.deepEqual(
    findAgingDeals([{ timestamp: "garbage", runType: "full" }], 7, NOW),
    []
  );
});

// "Clear local history" and "Export CSV" stayed fully enabled with nothing to
// clear or export, so the only way to learn the list was empty was to press one
// and watch nothing happen.
test("history controls go inert when there is nothing to act on", async () => {
  const { syncHistoryActionState } = await import("../src/sidepanel/history.js");
  const make = () => {
    const attrs = new Map();
    return {
      disabled: false,
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: (k) => attrs.delete(k),
      getAttribute: (k) => attrs.get(k) ?? null,
    };
  };

  const clearBtn = make();
  const exportBtn = make();
  syncHistoryActionState(0, { clearBtn, exportBtn });
  assert.equal(clearBtn.disabled, true);
  assert.equal(exportBtn.disabled, true);
  assert.match(clearBtn.getAttribute("title"), /no saved records to clear/i);
  assert.match(exportBtn.getAttribute("title"), /no saved records to export/i);

  // One record is enough to re-enable both, and the empty-state hint goes away
  // rather than lingering as a stale explanation.
  syncHistoryActionState(1, { clearBtn, exportBtn });
  assert.equal(clearBtn.disabled, false);
  assert.equal(exportBtn.disabled, false);
  assert.equal(clearBtn.getAttribute("title"), null);
  assert.equal(exportBtn.getAttribute("title"), null);

  // Missing elements must not throw — the panel calls this before Settings has
  // ever been opened.
  syncHistoryActionState(0, {});
  syncHistoryActionState(3);
});

// A record saved before 1.4 has no savedResults, so the handler bailed out
// with "cannot be reopened or reprinted" before reaching any of the buttons —
// including Delete. Reopening, printing and re-screening genuinely need those
// details; removing a record does not. So the one record a user could not
// delete individually was the oldest one, which is exactly the one they are
// most likely to want gone, and clearing the entire history was the only way.
test("a record saved before customer details were kept can still be deleted", async () => {
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(
    new URL("../sidepanel.js", import.meta.url),
    "utf8"
  );
  const handler = script.slice(script.indexOf('const auditId = btn.dataset.audit'));
  const deleteAt = handler.indexOf('history-delete-btn');
  const guardAt = handler.indexOf('This record was saved before the app kept customer details');
  const reopenAt = handler.indexOf('history-open-btn');

  assert.ok(deleteAt > 0, "expected a delete branch");
  assert.ok(guardAt > 0, "expected the legacy guard");
  assert.ok(reopenAt > 0, "expected an open branch");
  // Delete runs before the guard; opening still runs after it.
  assert.ok(deleteAt < guardAt, "delete must be reachable for a legacy record");
  assert.ok(reopenAt > guardAt, "opening must still require the saved details");
});
