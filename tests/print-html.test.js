import assert from "node:assert/strict";
import test from "node:test";

import {
  consumePrintPayload,
  createPrintPayload,
  htmlContainsImages,
  createPrintJobId,
  isConsumablePrintPayload,
  PRINT_PAYLOAD_TTL_MS,
  PRINT_STORAGE_PREFIX,
  removeExpiredPrintPayloads,
} from "../lib/print-html.js";
import {
  formatDobForMdos,
  formatDlnForMdos,
  printHtmlDocument,
} from "../src/sidepanel/export.js";

test("htmlContainsImages detects img tags case-insensitively", () => {
  assert.equal(htmlContainsImages('<img src="x">'), true);
  assert.equal(htmlContainsImages("<IMG SRC='x'>"), true);
  assert.equal(htmlContainsImages("<div>no image</div>"), false);
  assert.equal(htmlContainsImages(""), false);
  assert.equal(htmlContainsImages(null), false);
});

test("createPrintJobId uses the storage prefix", () => {
  const id = createPrintJobId();
  assert.ok(id.startsWith(PRINT_STORAGE_PREFIX));
  assert.ok(id.length > PRINT_STORAGE_PREFIX.length + 4);
});

function fakeStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async get(key) {
      if (key === null) return { ...values };
      return { [key]: values[key] };
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete values[key];
      }
    },
  };
}

test("print payloads are time-bounded and consumed exactly once", async () => {
  const now = 1_000_000;
  const id = `${PRINT_STORAGE_PREFIX}one-time`;
  const payload = createPrintPayload("<html>private report</html>", true, now);
  const storage = fakeStorage({ [id]: payload });

  assert.equal(isConsumablePrintPayload(payload, now), true);
  assert.equal(
    isConsumablePrintPayload(payload, now + PRINT_PAYLOAD_TTL_MS),
    false
  );
  assert.deepEqual(await consumePrintPayload(storage, id, now), payload);
  assert.equal(storage.values[id], undefined);
  assert.equal(await consumePrintPayload(storage, id, now), null);
});

test("expired and malformed print jobs are purged without touching other session data", async () => {
  const now = 2_000_000;
  const liveId = `${PRINT_STORAGE_PREFIX}live`;
  const expiredId = `${PRINT_STORAGE_PREFIX}expired`;
  const malformedId = `${PRINT_STORAGE_PREFIX}malformed`;
  const storage = fakeStorage({
    [liveId]: createPrintPayload("<html>live</html>", false, now),
    [expiredId]: createPrintPayload(
      "<html>expired</html>",
      false,
      now - PRINT_PAYLOAD_TTL_MS
    ),
    [malformedId]: { html: "<html>missing bounds</html>" },
    unrelatedSessionValue: "keep",
  });

  const removed = await removeExpiredPrintPayloads(storage, now);
  assert.deepEqual(removed.sort(), [expiredId, malformedId].sort());
  assert.ok(storage.values[liveId]);
  assert.equal(storage.values.unrelatedSessionValue, "keep");
});

test("runner navigation waits until its sensitive payload is stored", async () => {
  const originalChrome = globalThis.chrome;
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const events = [];
  let releaseSet;
  const setGate = new Promise((resolve) => {
    releaseSet = resolve;
  });
  const runner = {
    closed: false,
    location: {
      replace(url) {
        events.push(["navigate", url]);
      },
    },
    close() {
      events.push(["close"]);
    },
  };

  globalThis.window = {
    open(url) {
      events.push(["open", url]);
      return runner;
    },
  };
  globalThis.chrome = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
    },
    storage: {
      session: {
        async set() {
          events.push(["set-start"]);
          await setGate;
          events.push(["set-complete"]);
        },
        async remove() {},
      },
    },
  };
  globalThis.setTimeout = () => 0;

  try {
    const pending = printHtmlDocument("<html>private report</html>");
    await Promise.resolve();
    assert.deepEqual(events, [
      ["open", ""],
      ["set-start"],
    ]);

    releaseSet();
    assert.equal(await pending, true);
    assert.equal(events[2][0], "set-complete");
    assert.equal(events[3][0], "navigate");
    assert.match(events[3][1], /print-runner\.html\?id=/);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.window = originalWindow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("formatDobForMdos and formatDlnForMdos normalize for MDOS print HTML", () => {
  assert.equal(formatDobForMdos(" 08/08/1985 "), "08/08/1985");
  assert.equal(formatDobForMdos(""), "");
  assert.equal(formatDobForMdos(null), "");
  assert.equal(formatDlnForMdos(" s123 456 "), "S123 456");
  assert.equal(formatDlnForMdos(""), "");
});
