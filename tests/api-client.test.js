import assert from "node:assert/strict";
import test from "node:test";

import {
  MISSING_API_KEY,
  backendRepeatOffenderCheck,
  backendTitleCheck,
  isBackendAvailable,
} from "../lib/api-client.js";

function stubStorage(key) {
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return key ? { backendApiKey: key } : {};
        },
      },
    },
  };
}

test("a check with no API key rejects with the MISSING_API_KEY code", async () => {
  stubStorage(null);
  delete globalThis.fetch; // must fail before any network call
  await assert.rejects(
    () => backendRepeatOffenderCheck({ firstName: "A", lastName: "B" }),
    (err) => err.message === MISSING_API_KEY && err.code === MISSING_API_KEY
  );
});

test("a backend HTTP error surfaces the server's error message", async () => {
  stubStorage("test-key");
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "MDOS portal unavailable" }),
  });
  await assert.rejects(
    () => backendTitleCheck({ vin: "1HGBH41JXMN109186" }),
    /MDOS portal unavailable/
  );
});

test("a backend HTTP error with no JSON body falls back to the status code", async () => {
  stubStorage("test-key");
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => {
      throw new Error("not json");
    },
  });
  await assert.rejects(
    () => backendRepeatOffenderCheck({ firstName: "A", lastName: "B" }),
    /HTTP 503/
  );
});

test("isBackendAvailable reflects the health endpoint result", async () => {
  globalThis.chrome = { storage: { local: { async get() { return {}; } } } };
  globalThis.fetch = async () => ({ ok: true });
  assert.equal(await isBackendAvailable(), true);

  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  assert.equal(await isBackendAvailable(), false);
});
