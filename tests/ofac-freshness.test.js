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

// Bumping the IndexedDB schema runs an upgrade in every existing user's
// browser. Deleting the unused searchHistory store must not take the sanctions
// list with it — an emptied SDN list is the one failure that could turn a real
// match into a silent pass.
test("the v2 upgrade drops the unused store and keeps the sanctions list", async () => {
  const source = readFileSync(
    new URL("../ofac/storage.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /const DB_VERSION = 2;/);
  // The upgrade deletes searchHistory...
  assert.match(source, /deleteObjectStore\(HISTORY_STORE\)/);
  // ...and never deletes or recreates the store holding the SDN entries.
  assert.doesNotMatch(source, /deleteObjectStore\(SDN_STORE\)/);
  assert.doesNotMatch(source, /deleteObjectStore\(SETTINGS_STORE\)/);
  // The SDN store is still only created when absent, so an existing one is
  // left untouched by the upgrade.
  assert.match(
    source,
    /if \(!database\.objectStoreNames\.contains\(SDN_STORE\)\)/
  );

  // The functions that had no callers are gone, not merely unexported.
  for (const dead of [
    "saveSearchHistory",
    "getSearchHistory",
    "clearSearchHistory",
    "clearSDNEntries",
    "storeSDNEntries",
  ]) {
    assert.doesNotMatch(source, new RegExp(`function ${dead}\\b`), `${dead} should be gone`);
  }
});
