import assert from "node:assert/strict";
import test from "node:test";

import { needsUpdate } from "../ofac/data.js";

// The OFAC check refreshes the SDN list before screening whenever needsUpdate()
// is true, so this threshold is what guarantees "always up-to-date" screening.

test("needsUpdate returns true when there is no recorded update", () => {
  assert.equal(needsUpdate(null), true);
  assert.equal(needsUpdate(undefined), true);
  assert.equal(needsUpdate(""), true);
});

test("needsUpdate is false for data refreshed within the last 24 hours", () => {
  const oneHourAgo = new Date(Date.now() - 1 * 3600000).toISOString();
  const twentyThreeHoursAgo = new Date(Date.now() - 23 * 3600000).toISOString();
  assert.equal(needsUpdate(oneHourAgo), false);
  assert.equal(needsUpdate(twentyThreeHoursAgo), false);
});

test("needsUpdate is true once data is 24+ hours old (forces a fresh pull)", () => {
  const exactly24h = new Date(Date.now() - 24 * 3600000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 3600000).toISOString();
  assert.equal(needsUpdate(exactly24h), true);
  assert.equal(needsUpdate(twoDaysAgo), true);
});

test("needsUpdate fails safe on an unparseable timestamp (treats age as unknown)", () => {
  // A garbage or 'Unknown' timestamp must NOT read as fresh — otherwise a
  // corrupted setting would silently suppress the stale-data refresh/warning.
  assert.equal(needsUpdate("Unknown"), true);
  assert.equal(needsUpdate("not-a-date"), true);
  assert.equal(needsUpdate("2026-13-45T99:99:99Z"), true);
});
