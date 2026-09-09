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
  const cache = source.indexOf("await cacheCurrentFormData();");
  const afterCache = source.indexOf("if (!isCurrentRun()) return;", cache);
  const send = source.indexOf("await chrome.runtime.sendMessage", afterCache);
  const afterSend = source.indexOf("if (!isCurrentRun()) return;", send);
  const catchBlock = source.indexOf("} catch (e) {", afterSend);
  const catchFence = source.indexOf("if (!isCurrentRun()) return;", catchBlock);

  // Screenshot cleanup now belongs to the worker's serialized start, not an
  // unowned panel write that can remove another window's evidence.
  assert.doesNotMatch(source, /clearTransientScreenshots|chrome\.storage\.session\.remove/);
  assert.ok(cache >= 0);
  assert.ok(cache < afterCache && afterCache < send);
  assert.ok(send < afterSend && afterSend < catchBlock);
  assert.ok(catchBlock < catchFence);
});

test("Clear cancels only this panel's identities through the worker", () => {
  const source = functionSource("handleClear", "openHistory");
  const cancelMessage = source.indexOf('type: "CANCEL_INDIVIDUAL_OPERATION"');
  assert.ok(cancelMessage >= 0);
  assert.match(source, /activeIndividualOperationId \|\| displayedResults\?\.operationId/);
  assert.match(source, /activeUiRunId \|\| displayedResults\?\.runId/);
  assert.match(source, /if \(cancelledIndividualOperationId\)/);
  assert.match(source, /if \(cancelledRunId\)/);
  assert.match(source, /await cancellationResults/);
  assert.match(source, /!result\.value\?\.success/);
  assert.doesNotMatch(source, /chrome\.storage\.session\.(get|set|remove)|chrome\.action/);
});
