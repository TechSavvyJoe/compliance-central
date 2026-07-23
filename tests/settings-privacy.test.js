import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONFIG } from "../lib/config.js";
import { STORAGE_KEYS } from "../lib/storage-keys.js";
import {
  getBackendApiKey,
  removeLegacyBackendApiKey,
} from "../src/sidepanel/settings.js";

const sidepanelHtml = readFileSync(
  new URL("../sidepanel.html", import.meta.url),
  "utf8"
);
const apiClientSource = readFileSync(
  new URL("../lib/api-client.js", import.meta.url),
  "utf8"
);
const alarmSource = readFileSync(
  new URL("../src/worker/alarms.js", import.meta.url),
  "utf8"
);
const workerSource = readFileSync(
  new URL("../service-worker.js", import.meta.url),
  "utf8"
);

test("Settings provides useful controls without a custom backend-key form", () => {
  for (const id of [
    "serviceStatus",
    "rescreenReminderToggle",
    "settingsClearHistoryBtn",
    "settingsPrivacyLink",
    "supportEmailLink",
    "settingsVersion",
  ]) {
    assert.match(sidepanelHtml, new RegExp(`id="${id}"`));
  }
  assert.match(sidepanelHtml, /no setup needed/i);
  assert.doesNotMatch(sidepanelHtml, /type="password"|apiKeyInput|saveApiKey|API key/i);
});

test("service access always uses the built-in key and never reads an override", async () => {
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          throw new Error("custom-key storage must not be read");
        },
      },
    },
  };

  assert.equal(await getBackendApiKey(), CONFIG.backend.defaultApiKey);
  assert.doesNotMatch(apiClientSource, /storage\.local\.get\([^)]*backendApiKey/);
});

test("upgraded installations remove the retired backend-key value safely", async () => {
  const removed = [];
  globalThis.chrome = {
    storage: {
      local: {
        async remove(key) {
          removed.push(key);
        },
      },
    },
  };
  assert.equal(await removeLegacyBackendApiKey(), true);
  assert.deepEqual(removed, [STORAGE_KEYS.backendApiKey]);

  globalThis.chrome.storage.local.remove = async () => {
    throw new Error("storage unavailable");
  };
  assert.equal(await removeLegacyBackendApiKey(), false);
});

test("history retention runs independently of opening the side panel", () => {
  assert.match(alarmSource, /import \{ purgeHistory \}/);
  assert.ok(
    (alarmSource.match(/await purgeHistory\(\)/g) || []).length >= 3,
    "install/update, startup, and daily alarm handlers should enforce retention"
  );
  assert.match(workerSource, /setAccessLevel\(\{ accessLevel: "TRUSTED_CONTEXTS" \}\)/);
});
