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
