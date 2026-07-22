import assert from "node:assert/strict";
import test from "node:test";

import { STORAGE_KEYS } from "../lib/storage-keys.js";
import {
  cacheFormData,
  extractScanJurisdiction,
  loadCachedFormData,
} from "../src/sidepanel/form.js";

const originalChrome = globalThis.chrome;

function field(value = "") {
  return { value, dataset: {} };
}

function makeElements(values = {}) {
  return {
    firstName: field(values.firstName),
    middleName: field(values.middleName),
    lastName: field(values.lastName),
    suffix: field(values.suffix),
    dob: field(values.dob),
    dlnPid: field(values.dlnPid),
    tradeVin: field(values.tradeVin),
    hasCoBuyer: {
      checked: !!values.hasCoBuyer,
      dispatchEvent() {},
    },
    cbFirstName: field(values.coBuyer?.firstName),
    cbMiddleName: field(values.coBuyer?.middleName),
    cbLastName: field(values.coBuyer?.lastName),
    cbSuffix: field(values.coBuyer?.suffix),
    cbDob: field(values.coBuyer?.dob),
    cbDlnPid: field(values.coBuyer?.dlnPid),
    runTitleBtn: { disabled: false },
  };
}

function installSessionStore() {
  const store = {};
  globalThis.chrome = {
    storage: {
      session: {
        async set(update) {
          Object.assign(store, update);
        },
        async get() {
          return { ...store };
        },
      },
    },
  };
  return store;
}

test.afterEach(() => {
  globalThis.chrome = originalChrome;
});

test("form cache preserves scanner jurisdiction through a side-panel reload", async () => {
  const store = installSessionStore();
  const source = makeElements({
    firstName: "ALEX",
    lastName: "TAYLOR",
    dob: "03/03/1992",
    dlnPid: "OH1234567",
    hasCoBuyer: true,
    coBuyer: {
      firstName: "SAM",
      lastName: "TAYLOR",
      dob: "04/04/1993",
      dlnPid: "S123456789012",
    },
  });

  await cacheFormData(source, {
    buyerIsMichigan: false,
    coBuyerIsMichigan: true,
  });
  assert.equal(
    store[STORAGE_KEYS.cachedFormData].buyerIsMichigan,
    false
  );
  assert.equal(
    store[STORAGE_KEYS.cachedFormData].coBuyerIsMichigan,
    true
  );

  const restoredElements = makeElements();
  const restored = await loadCachedFormData(restoredElements);
  assert.equal(restoredElements.firstName.value, "ALEX");
  assert.equal(restoredElements.dlnPid.value, "OH1234567");
  assert.equal(restoredElements.hasCoBuyer.checked, true);
  assert.deepEqual(extractScanJurisdiction(restored), {
    buyer: false,
    coBuyer: true,
  });
});

test("cached jurisdiction accepts only explicit booleans", async () => {
  assert.deepEqual(
    extractScanJurisdiction({
      buyerIsMichigan: "false",
      coBuyerIsMichigan: 0,
    }),
    { buyer: null, coBuyer: null }
  );

  const store = installSessionStore();
  await cacheFormData(makeElements(), {
    buyerIsMichigan: "false",
    coBuyerIsMichigan: 0,
  });
  assert.equal(store[STORAGE_KEYS.cachedFormData].buyerIsMichigan, null);
  assert.equal(store[STORAGE_KEYS.cachedFormData].coBuyerIsMichigan, null);
});
