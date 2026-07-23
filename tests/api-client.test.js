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

test("a retired saved override cannot replace the built-in service key", async () => {
  stubStorage("cc_untrusted_override");
  let sentKey = null;
  globalThis.fetch = async (_url, opts) => {
    sentKey = opts.headers["x-api-key"];
    return {
      ok: true,
      json: async () => ({ success: true, status: "eligible", passed: true }),
    };
  };

  await backendRepeatOffenderCheck({ firstName: "A", lastName: "B" });
  assert.equal(sentKey, CONFIG.backend.defaultApiKey);
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
  let cancelledBodies = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => "0" }, // Retry-After: 0 -> retry immediately
        body: { async cancel() { cancelledBodies++; } },
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
  assert.equal(cancelledBodies, 1, "should release the discarded response body");
  assert.equal(res.success, true);
});

test("a successful HTTP response with invalid JSON gets a useful error", async () => {
  stubStorage("test-key");
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
  });

  await assert.rejects(
    () => backendTitleCheck({ vin: "1HGBH41JXMN109186" }),
    /invalid response/i
  );
});

test("an incomplete title response fails closed", async () => {
  stubStorage("test-key");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, passed: true, details: {} }),
  });

  const result = await backendTitleCheck({ vin: "1HGBH41JXMN109186" });
  assert.equal(result.success, false);
  assert.match(result.error, /incomplete title result/i);
});

test("an unknown title status can never become a clean pass", async () => {
  stubStorage("test-key");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      passed: true,
      details: {
        titleStatus: "Unexpected Portal State",
        titleBrand: "CLEAN",
        hasLien: false,
      },
    }),
  });

  const result = await backendTitleCheck({ vin: "1HGBH41JXMN109186" });
  assert.equal(result.success, true);
  assert.equal(result.result.passed, false);
  assert.equal(result.result.titleBrand, "UNKNOWN");
});

test("No Record Found remains review even if an older backend calls it CLEAN", async () => {
  stubStorage("test-key");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      passed: true,
      details: {
        titleStatus: "No Record Found",
        titleBrand: "CLEAN",
        hasLien: false,
      },
    }),
  });

  const result = await backendTitleCheck({ vin: "1HGBH41JXMN109186" });
  assert.equal(result.success, true);
  assert.equal(result.result.passed, false);
  assert.equal(result.result.titleBrand, "UNKNOWN");
});

test("an in-flight backend request can be cancelled", async () => {
  stubStorage("test-key");
  const controller = new AbortController();
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve;
  });
  globalThis.fetch = async (_url, options) => {
    markFetchStarted();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true }
      );
    });
  };

  const pending = backendRepeatOffenderCheck(
    { firstName: "A", lastName: "B" },
    { signal: controller.signal }
  );
  await fetchStarted;
  controller.abort();
  await assert.rejects(() => pending, /cancelled/i);
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
