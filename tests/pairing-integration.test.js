import assert from "node:assert/strict";
import test from "node:test";

import { encryptPayload } from "../docs/lib/crypto-pair.js";
import {
  cancelPairing,
  renderPairingQr,
  startPairing,
} from "../src/sidepanel/scan-pairing.js";

const SESSION_ONE = "11111111111111111111111111111111";
const SESSION_TWO = "22222222222222222222222222222222";
const originalFetch = globalThis.fetch;
const originalChrome = globalThis.chrome;
const originalSetTimeout = globalThis.setTimeout;

function field() {
  return { value: "", dataset: {} };
}

function makeElements() {
  return {
    firstName: field(),
    middleName: field(),
    lastName: field(),
    suffix: field(),
    dob: field(),
    dlnPid: field(),
    tradeVin: field(),
    hasCoBuyer: { checked: false, dispatchEvent() {} },
    cbFirstName: field(),
    cbMiddleName: field(),
    cbLastName: field(),
    cbSuffix: field(),
    cbDob: field(),
    cbDlnPid: field(),
  };
}

function installChrome() {
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return {};
        },
      },
    },
  };
}

async function waitUntil(predicate, message) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test.afterEach(() => {
  cancelPairing();
  globalThis.chrome = originalChrome;
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

test("cancelling while /pair/new is in flight prevents late polling and autofill", async () => {
  installChrome();
  const calls = [];
  let resolveCreate;
  globalThis.fetch = (url) => {
    calls.push(String(url));
    return new Promise((resolve) => {
      resolveCreate = resolve;
    });
  };

  let rendered = 0;
  let completed = 0;
  const pairing = startPairing(
    makeElements(),
    () => rendered++,
    () => completed++
  );
  await waitUntil(() => !!resolveCreate, "pair creation request did not start");

  // This is the path used when the QR modal closes before session creation
  // finishes. A late backend response must be inert.
  cancelPairing();
  resolveCreate({
    ok: true,
    status: 200,
    async json() {
      return { sessionId: SESSION_ONE };
    },
  });
  await pairing;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  assert.equal(rendered, 0);
  assert.equal(completed, 0);
});

test("pairing rejects malformed session responses before rendering a QR", async () => {
  installChrome();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { sessionId: "not-a-capability" };
    },
  });

  let rendered = false;
  await assert.rejects(
    startPairing(makeElements(), () => {
      rendered = true;
    }, () => {}),
    /invalid session/i
  );
  assert.equal(rendered, false);
});

test("session creation timeout remains active while reading the response body", async () => {
  installChrome();
  globalThis.setTimeout = (callback, delay, ...args) =>
    originalSetTimeout(callback, delay === 15_000 ? 5 : delay, ...args);
  globalThis.fetch = async (_url, options = {}) => ({
    ok: true,
    status: 200,
    json() {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });
    },
  });

  await assert.rejects(
    startPairing(makeElements(), () => {}, () => {}),
    /timed out/i
  );
});

test("a QR renderer failure stops before polling and reports an actionable error", async () => {
  installChrome();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      async json() {
        return { sessionId: SESSION_ONE };
      },
    };
  };

  await assert.rejects(
    startPairing(
      makeElements(),
      (url) => renderPairingQr(undefined, {}, url),
      () => {}
    ),
    /QR code generator is unavailable.*Reload Compliance Central/i
  );
  assert.equal(calls.length, 1);
});

test("cancelling a poll aborts a response body that is still being read", async () => {
  installChrome();
  let bodyStarted = false;
  let pollSignal;
  let completed = 0;

  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/pair/new")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { sessionId: SESSION_ONE };
        },
      };
    }
    pollSignal = options.signal;
    return {
      status: 200,
      json() {
        bodyStarted = true;
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      },
    };
  };

  const cancel = await startPairing(
    makeElements(),
    () => {},
    () => completed++
  );
  await waitUntil(() => bodyStarted, "poll response body was not read");
  cancel();
  await waitUntil(() => pollSignal?.aborted, "poll response body was not aborted");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(completed, 0);
});

test("an older pairing cancel function cannot cancel a newer autofill", async () => {
  installChrome();
  let createCount = 0;
  let resolveSecondPoll;
  let secondPollStarted = false;

  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.endsWith("/pair/new")) {
      const sessionId = createCount++ === 0 ? SESSION_ONE : SESSION_TWO;
      return {
        ok: true,
        status: 200,
        async json() {
          return { sessionId };
        },
      };
    }
    if (value.endsWith(`/pair/${SESSION_ONE}`)) {
      return { status: 204 };
    }
    if (value.endsWith(`/pair/${SESSION_TWO}`)) {
      secondPollStarted = true;
      return new Promise((resolve, reject) => {
        resolveSecondPoll = resolve;
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });
    }
    throw new Error(`Unexpected fetch: ${value}`);
  };

  const firstUrls = [];
  const cancelFirst = await startPairing(
    makeElements(),
    (url) => firstUrls.push(url),
    () => {}
  );
  assert.equal(firstUrls.length, 1);

  const elements = makeElements();
  const secondUrls = [];
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  await startPairing(
    elements,
    (url) => secondUrls.push(url),
    resolveDone
  );
  await waitUntil(() => secondPollStarted, "new pairing did not begin polling");

  // This closure belongs to the superseded first session and must be inert.
  cancelFirst();

  const key = new URL(secondUrls[0]).hash.slice("#k=".length);
  const blob = await encryptPayload(key, {
    buyer: {
      firstName: "Synthetic",
      lastName: "Buyer",
      dob: "01/02/1990",
      dlnPid: "S123456789012",
      iin: "636032",
      jurisdiction: "MI",
    },
  });
  resolveSecondPoll({
    status: 200,
    async json() {
      return { blob };
    },
  });

  const result = await done;
  assert.equal(result.status, "filled");
  assert.equal(result.payload.buyer.isMichigan, true);
  assert.equal(elements.firstName.value, "Synthetic");
  assert.equal(elements.lastName.value, "Buyer");
  assert.equal(elements.dlnPid.value, "S123456789012");
});
