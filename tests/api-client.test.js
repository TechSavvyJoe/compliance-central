import assert from "node:assert/strict";
import test from "node:test";

import {
  backendRepeatOffenderCheck,
  backendTitleCheck,
  isBackendAvailable,
} from "../lib/api-client.js";
import { CONFIG } from "../lib/config.js";

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

test("with no saved override, requests use the built-in default key", async () => {
  stubStorage(null); // no per-install override saved
  let sentKey = null;
  globalThis.fetch = async (_url, opts) => {
    sentKey = opts.headers["x-api-key"];
    return { ok: true, json: async () => ({ success: true, status: "eligible", passed: true }) };
  };
  const res = await backendRepeatOffenderCheck({ firstName: "A", lastName: "B" });
  assert.equal(sentKey, CONFIG.backend.defaultApiKey);
  assert.equal(res.success, true);
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
    status: 500,
    json: async () => {
      throw new Error("not json");
    },
  });
  await assert.rejects(
    () => backendRepeatOffenderCheck({ firstName: "A", lastName: "B" }),
    /HTTP 500/
  );
});

test("retries on a 503 'busy' response, then succeeds", async () => {
  stubStorage("test-key");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => "0" }, // Retry-After: 0 -> retry immediately
        json: async () => ({ error: "busy" }),
      };
    }
    return {
      ok: true,
      json: async () => ({ success: true, status: "eligible", passed: true }),
    };
  };
  const res = await backendRepeatOffenderCheck({ firstName: "A", lastName: "B" });
  assert.equal(calls, 2, "should retry once after the 503");
  assert.equal(res.success, true);
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
