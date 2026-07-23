import assert from "node:assert/strict";
import test from "node:test";

import { ensureDataUrl, imageDataUrlExtension } from "../lib/data-url.js";
import { sanitizeScanPayload } from "../src/sidepanel/scan-pairing.js";
import { getApiKey } from "../lib/api-client.js";
import { CONFIG } from "../lib/config.js";
import { STORAGE_KEYS } from "../lib/storage-keys.js";
import { createOperationFence, isCurrentRunState } from "../lib/run-fence.js";
import { clearAllHistory } from "../src/sidepanel/history.js";

test("ensureDataUrl accepts png/jpeg/webp data URLs and raw base64", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(ensureDataUrl(png), png);

  const jpeg = "data:image/jpeg;base64,/9j/4AAQ=";
  assert.equal(ensureDataUrl(jpeg), jpeg);

  const raw = "iVBORw0KGgoAAAA=";
  assert.equal(ensureDataUrl(raw), `data:image/png;base64,${raw}`);
});

test("ensureDataUrl rejects XSS breakout and non-image schemes", () => {
  assert.equal(
    ensureDataUrl('data:image/png;base64,abc" onerror="alert(1)'),
    null
  );
  assert.equal(ensureDataUrl("data:text/html;base64,PHNjcmlwdD4="), null);
  assert.equal(ensureDataUrl("javascript:alert(1)"), null);
  assert.equal(ensureDataUrl(""), null);
  assert.equal(ensureDataUrl(null), null);
});

test("screenshot downloads preserve the validated image format", () => {
  assert.equal(imageDataUrlExtension("data:image/jpeg;base64,QUJDRA=="), "jpg");
  assert.equal(imageDataUrlExtension("data:image/webp;base64,QUJDRA=="), "webp");
  assert.equal(imageDataUrlExtension("data:image/png;base64,QUJDRA=="), "png");
  assert.equal(imageDataUrlExtension("javascript:alert(1)"), null);
});

test("sanitizeScanPayload clips fields and rejects incomplete identities", () => {
  assert.equal(sanitizeScanPayload(null), null);
  assert.equal(sanitizeScanPayload({ firstName: "", lastName: "" }), null);
  assert.equal(
    sanitizeScanPayload({
      firstName: "Jane",
      lastName: "Doe",
      dob: "13/40/1990",
      dlnPid: "S123456789012",
    }),
    null
  );

  const ok = sanitizeScanPayload({
    buyer: {
      firstName: "  Jane  ",
      lastName: "Doe",
      dlnPid: "A".repeat(100),
      dob: "01/01/1990",
    },
    coBuyer: {
      firstName: "Bob",
      lastName: "Smith",
      dob: "02/02/1991",
      dlnPid: "B123456789012",
    },
  });
  assert.equal(ok.buyer.firstName, "Jane");
  assert.equal(ok.buyer.dlnPid.length, 32);
  assert.equal(ok.buyer.dob, "01/01/1990");
  assert.equal(ok.coBuyer.firstName, "Bob");

  assert.equal(
    sanitizeScanPayload({
      buyer: {
        firstName: "Jane",
        lastName: "Doe",
        dob: "01/01/1990",
        dlnPid: "S123456789012",
      },
      coBuyer: { firstName: "Partial" },
    }),
    null
  );
});

test("sanitizeScanPayload derives jurisdiction from AAMVA issuer provenance", () => {
  const result = sanitizeScanPayload({
    buyer: {
      firstName: "Jane",
      lastName: "Doe",
      dob: "01/01/1990",
      dlnPid: "S123456789012",
      iin: "636032",
      jurisdiction: "OH",
      isMichigan: false,
    },
    coBuyer: {
      firstName: "John",
      lastName: "Doe",
      dob: "02/02/1991",
      dlnPid: "B123456789012",
      iin: "636023",
      jurisdiction: "MI",
      isMichigan: true,
    },
  });
  // The six-digit issuer ID wins over contradictory transported booleans or
  // address-state text.
  assert.equal(result.buyer.isMichigan, true);
  assert.equal(result.coBuyer.isMichigan, false);

  const jurisdictionFallback = sanitizeScanPayload({
    firstName: "Alex",
    lastName: "Taylor",
    dob: "03/03/1992",
    dlnPid: "C123456789012",
    jurisdiction: "mi",
  });
  assert.equal(jurisdictionFallback.buyer.isMichigan, true);

  const unverifiedBoolean = sanitizeScanPayload({
    firstName: "Alex",
    lastName: "Taylor",
    dob: "03/03/1992",
    dlnPid: "C123456789012",
    isMichigan: false,
  });
  assert.equal("isMichigan" in unverifiedBoolean.buyer, false);
});

test("run fence rejects cancelled and stale run state", () => {
  const active = {
    activeRunId: "run-new",
    stateRunId: "run-new",
    cancelledRunId: "run-old",
  };
  assert.equal(isCurrentRunState(active, "run-new"), true);
  assert.equal(isCurrentRunState(active, "run-old"), false);
  assert.equal(
    isCurrentRunState({
      activeRunId: "run-old",
      stateRunId: "run-old",
      cancelledRunId: "run-old",
    }),
    false
  );
  assert.equal(
    isCurrentRunState({
      activeRunId: "run-new",
      stateRunId: "run-old",
      cancelledRunId: null,
    }),
    false
  );
});

test("operation fence invalidates stale and cancelled individual checks", () => {
  const fence = createOperationFence();
  const first = fence.start();
  assert.equal(fence.isCurrent(first), true);

  const second = fence.start();
  assert.equal(fence.isCurrent(first), false);
  assert.equal(fence.isCurrent(second), true);

  fence.cancel();
  assert.equal(fence.isCurrent(second), false);
});

test("Clear All removes current and legacy history keys", async () => {
  const removed = [];
  globalThis.confirm = () => true;
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        if (message.type !== "CLEAR_HISTORY") {
          return { success: false, error: "Unexpected message" };
        }
        await globalThis.chrome.storage.local.remove([
          STORAGE_KEYS.complianceHistory,
          STORAGE_KEYS.searchHistory,
        ]);
        return { success: true, cleared: true };
      },
    },
    storage: {
      local: {
        async remove(keys) {
          removed.push(...keys);
        },
        async get() {
          return {};
        },
      },
    },
  };
  const historyList = { innerHTML: "" };
  const historyCount = { textContent: "" };

  assert.equal(await clearAllHistory(historyList, historyCount), true);
  assert.deepEqual(removed, [
    STORAGE_KEYS.complianceHistory,
    STORAGE_KEYS.searchHistory,
  ]);
});

test("getApiKey ignores retired or injected Settings overrides", async () => {
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          throw new Error("getApiKey must not read local storage");
        },
      },
    },
  };
  assert.equal(await getApiKey(), CONFIG.backend.defaultApiKey);
});
