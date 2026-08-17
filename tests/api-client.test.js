import assert from "node:assert/strict";
import test from "node:test";

import {
  backendRepeatOffenderCheck,
  backendSosFeeQuote,
  backendTitleCheck,
  isBackendAvailable,
} from "../lib/api-client.js";
import { CONFIG } from "../lib/config.js";

const SOS_FIELDS = [
  { label: "Select your vehicle type", kind: "select", optionValue: "Passenger" },
];

function sosQuoteBody(overrides = {}) {
  return {
    success: true,
    quote: {
      calculationMode: "new_plate",
      feeCents: 20500,
      feeBreakdown: [
        { label: "Registration fee", feeCents: 18000 },
        { label: "Plate fee", feeCents: 2500 },
      ],
      vehicleDescription: "2026 · Car / Mini-Van / SUV · 4 Door",
      platePreviewUrl: "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.PAS.PM",
      recreationPassport: false,
      officialPageImage: "data:image/jpeg;base64,QUJDRA==",
      calculatedAt: "2026-08-15T12:00:00.000Z",
      ...overrides,
    },
  };
}

/** Answer one /api/sos-fee-quote POST and record what was actually sent. */
function stubSosBackend(body) {
  const sent = [];
  globalThis.fetch = async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => body };
  };
  return sent;
}

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

test("an incomplete Repeat Offender response fails closed", async () => {
  stubStorage("test-key");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, passed: true }),
  });

  const result = await backendRepeatOffenderCheck({
    firstName: "A",
    lastName: "B",
  });
  assert.equal(result.success, false);
  assert.match(result.error, /incomplete Repeat Offender result/i);
});

test("a contradictory Repeat Offender response fails closed", async () => {
  stubStorage("test-key");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      status: "eligible",
      passed: false,
      details: {},
    }),
  });

  const result = await backendRepeatOffenderCheck({
    firstName: "A",
    lastName: "B",
  });
  assert.equal(result.success, false);
  assert.match(result.error, /incomplete Repeat Offender result/i);
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

test("a branded title cannot pass even if an older backend says it did", async () => {
  stubStorage("test-key");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      passed: true,
      details: {
        titleStatus: "Rebuilt",
        titleBrand: "REBUILT",
        hasLien: false,
      },
    }),
  });

  const result = await backendTitleCheck({ vin: "1HGBH41JXMN109186" });
  assert.equal(result.success, true);
  assert.equal(result.result.passed, false);
  assert.equal(result.result.titleBrand, "REBUILT");
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

test("a SOS fee quote posts the contract payload and returns a verified quote", async () => {
  stubStorage("test-key");
  const sent = stubSosBackend(sosQuoteBody());

  const result = await backendSosFeeQuote({
    mode: "new_plate",
    fields: SOS_FIELDS,
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/api\/sos-fee-quote$/);
  // The wire spelling of the mode is the backend's, not the extension's.
  assert.equal(sent[0].body.mode, "newPlate");
  assert.deepEqual(sent[0].body.fields, SOS_FIELDS);
  assert.equal(result.success, true);
  assert.equal(result.quote.calculationMode, "new_plate");
  assert.equal(result.quote.feeCents, 20500);
  assert.equal(result.quote.feeBreakdown.length, 2);
  assert.equal(result.quote.calculatedAt, "2026-08-15T12:00:00.000Z");
});

test("a plate transfer quote uses the transfer wire mode", async () => {
  stubStorage("test-key");
  const sent = stubSosBackend(
    sosQuoteBody({ calculationMode: "plate_transfer" })
  );

  const result = await backendSosFeeQuote({
    mode: "plate_transfer",
    fields: SOS_FIELDS,
  });

  assert.equal(sent[0].body.mode, "plateTransfer");
  assert.equal(result.success, true);
  assert.equal(result.quote.calculationMode, "plate_transfer");
});

test("a quote echoed in the backend's own mode spelling is still accepted", async () => {
  stubStorage("test-key");
  stubSosBackend(sosQuoteBody({ calculationMode: "newPlate" }));

  const result = await backendSosFeeQuote({
    mode: "new_plate",
    fields: SOS_FIELDS,
  });

  assert.equal(result.success, true);
  // Consumers only ever see the extension's internal mode value.
  assert.equal(result.quote.calculationMode, "new_plate");
});

// A quote for the other registration choice is not incomplete — it is a
// different, wrong price in front of a customer.
test("a quote calculated for the other registration choice fails closed", async () => {
  stubStorage("test-key");
  stubSosBackend(sosQuoteBody({ calculationMode: "plate_transfer" }));

  const result = await backendSosFeeQuote({
    mode: "new_plate",
    fields: SOS_FIELDS,
  });

  assert.equal(result.success, false);
  assert.match(result.error, /incomplete Michigan SOS fee result/i);
});

test("malformed SOS fee quotes fail closed instead of reaching the customer", async () => {
  stubStorage("test-key");
  const malformed = [
    ["no quote at all", { success: true }],
    ["a fractional total", sosQuoteBody({ feeCents: 205.5 })],
    ["a string total", sosQuoteBody({ feeCents: "20500" })],
    ["a zero total", sosQuoteBody({ feeCents: 0, feeBreakdown: [{ label: "Fee", feeCents: 0 }] })],
    ["a negative total", sosQuoteBody({ feeCents: -100, feeBreakdown: [{ label: "Fee", feeCents: -100 }] })],
    ["an absent breakdown", sosQuoteBody({ feeBreakdown: undefined })],
    ["an empty breakdown", sosQuoteBody({ feeBreakdown: [] })],
    ["an unlabelled row", sosQuoteBody({ feeBreakdown: [{ label: "  ", feeCents: 20500 }] })],
    ["a row with no amount", sosQuoteBody({ feeBreakdown: [{ label: "Registration fee" }] })],
    [
      "a breakdown that does not reconcile to the total",
      sosQuoteBody({ feeBreakdown: [{ label: "Registration fee", feeCents: 18000 }] }),
    ],
    ["an unparseable timestamp", sosQuoteBody({ calculatedAt: "not a date" })],
  ];

  for (const [description, body] of malformed) {
    stubSosBackend(body);
    const result = await backendSosFeeQuote({
      mode: "new_plate",
      fields: SOS_FIELDS,
    });
    assert.equal(result.success, false, `${description} must fail closed`);
    assert.match(result.error, /incomplete Michigan SOS fee result/i, description);
  }
});

// Evidence capture is supporting material. Rejecting a correct, reconciled
// total because the screenshot failed is the bug this guards against.
test("a verified SOS total survives a missing official-page capture", async () => {
  stubStorage("test-key");
  stubSosBackend(sosQuoteBody({ officialPageImage: null }));

  const result = await backendSosFeeQuote({
    mode: "new_plate",
    fields: SOS_FIELDS,
  });

  assert.equal(result.success, true);
  assert.equal(result.quote.feeCents, 20500);
  assert.equal(result.quote.officialPageImage, null);
});

test("a SOS fee request is never sent without a mode and fields", async () => {
  stubStorage("test-key");
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, json: async () => sosQuoteBody() };
  };

  for (const payload of [
    undefined,
    {},
    { mode: "sideways", fields: SOS_FIELDS },
    { mode: "new_plate", fields: [] },
    { mode: "new_plate", fields: "fields" },
  ]) {
    const result = await backendSosFeeQuote(payload);
    assert.equal(result.success, false);
    assert.match(result.error, /Complete the required SOS fee fields/i);
  }
  assert.equal(called, false, "an invalid payload must never reach the network");
});

test("a backend-reported SOS failure surfaces its user-safe message", async () => {
  stubStorage("test-key");
  stubSosBackend({
    success: false,
    error: "Michigan SOS is not responding right now.",
  });

  const result = await backendSosFeeQuote({
    mode: "new_plate",
    fields: SOS_FIELDS,
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "Michigan SOS is not responding right now.");
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
