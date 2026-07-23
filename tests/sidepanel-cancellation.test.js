import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidepanelSource = readFileSync(
  new URL("../sidepanel.js", import.meta.url),
  "utf8"
);

function functionSource(name, nextName) {
  const start = sidepanelSource.indexOf(`async function ${name}(`);
  const end = sidepanelSource.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return sidepanelSource.slice(start, end);
}

test("Run All rechecks its UI run token after every awaited start step", () => {
  const source = functionSource("handleRunAllChecks", "showHistorySaveWarning");
  const clear = source.indexOf("await clearTransientScreenshots();");
  const afterClear = source.indexOf("if (!isCurrentRun()) return;", clear);
  const cache = source.indexOf("await cacheCurrentFormData();", afterClear);
  const afterCache = source.indexOf("if (!isCurrentRun()) return;", cache);
  const send = source.indexOf("await chrome.runtime.sendMessage", afterCache);
  const afterSend = source.indexOf("if (!isCurrentRun()) return;", send);
  const catchBlock = source.indexOf("} catch (e) {", afterSend);
  const catchFence = source.indexOf("if (!isCurrentRun()) return;", catchBlock);

  assert.ok(clear >= 0);
  assert.ok(clear < afterClear && afterClear < cache);
  assert.ok(cache < afterCache && afterCache < send);
  assert.ok(send < afterSend && afterSend < catchBlock);
  assert.ok(catchBlock < catchFence);
});

test("Clear discovers persisted individual work and waits for worker cancellation", () => {
  const source = functionSource("handleClear", "openHistory");
  const persistedRead = source.indexOf(
    ".get(STORAGE_KEYS.activeIndividualOperationId)"
  );
  const tombstone = source.indexOf(
    "STORAGE_KEYS.cancelledIndividualOperationId"
  );
  const cancelMessage = source.indexOf('type: "CANCEL_INDIVIDUAL_OPERATION"');
  const waitForCancel = source.indexOf(
    "await Promise.allSettled(cancellationMessages);"
  );
  const cleanup = source.indexOf("await chrome.storage.session.remove([");

  assert.ok(persistedRead >= 0);
  assert.ok(persistedRead < tombstone);
  assert.ok(tombstone < cancelMessage);
  assert.ok(cancelMessage < waitForCancel);
  assert.ok(waitForCancel < cleanup);
});
