import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertPublicationDateDoesNotRegress,
  needsUpdate,
} from "../ofac/data.js";

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

test("needsUpdate treats an implausibly future download timestamp as stale", () => {
  const now = Date.parse("2026-07-22T12:00:00.000Z");
  const harmlessClockSkew = new Date(now + 5 * 60 * 1000).toISOString();
  const implausiblyFuture = new Date(now + 5 * 60 * 1000 + 1).toISOString();

  assert.equal(needsUpdate(harmlessClockSkew, now), false);
  assert.equal(needsUpdate(implausiblyFuture, now), true);
});

test("publication date guard accepts the same or a newer official feed", () => {
  assert.doesNotThrow(() =>
    assertPublicationDateDoesNotRegress(null, "2026-07-20T00:00:00.000Z")
  );
  assert.doesNotThrow(() =>
    assertPublicationDateDoesNotRegress(
      "2026-07-20T00:00:00.000Z",
      "2026-07-20T00:00:00.000Z"
    )
  );
  assert.doesNotThrow(() =>
    assertPublicationDateDoesNotRegress(
      "2026-07-20T00:00:00.000Z",
      "2026-07-21T00:00:00.000Z"
    )
  );
});

test("publication date guard rejects an older or invalid feed after a valid one", () => {
  assert.throws(
    () =>
      assertPublicationDateDoesNotRegress(
        "2026-07-20T00:00:00.000Z",
        "2026-07-19T00:00:00.000Z"
      ),
    /older than the stored list/i
  );
  assert.throws(
    () =>
      assertPublicationDateDoesNotRegress(
        "2026-07-20T00:00:00.000Z",
        "not-a-date"
      ),
    /publication date is invalid/i
  );
  assert.throws(
    () =>
      assertPublicationDateDoesNotRegress(
        "2026-02-28T00:00:00.000Z",
        "2026-02-30T00:00:00.000Z"
      ),
    /publication date is invalid/i
  );
});

test("rollback validation runs before the SDN list or timestamps are replaced", () => {
  const source = readFileSync(
    new URL("../src/worker/ofac-check.js", import.meta.url),
    "utf8"
  );
  const updateStart = source.indexOf("async function runSDNUpdate()");
  const validation = source.indexOf(
    "assertPublicationDateDoesNotRegress(",
    updateStart
  );
  const replaceEntries = source.indexOf("replaceSDNEntries(", updateStart);
  const saveDownloadedAt = source.indexOf(
    'saveSetting("lastUpdate"',
    updateStart
  );
  const savePublishDate = source.indexOf(
    'saveSetting("publishDate"',
    updateStart
  );

  assert.ok(updateStart >= 0);
  assert.ok(validation > updateStart);
  assert.ok(validation < replaceEntries);
  assert.ok(validation < saveDownloadedAt);
  assert.ok(validation < savePublishDate);
});
