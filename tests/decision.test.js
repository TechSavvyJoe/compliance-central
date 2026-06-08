import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CONFIG } from "../lib/config.js";
import { STORAGE_KEYS } from "../lib/storage-keys.js";
import { normalizeDateValue } from "../src/sidepanel/date-picker.js";
import { calculateFinalDecision } from "../src/sidepanel/checks.js";
import { saveToHistory } from "../src/sidepanel/history.js";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8")
);

test("OFAC errors require review instead of approval", () => {
  const decision = calculateFinalDecision({
    ofac: { passed: false, status: "error", error: "SDN unavailable" },
    repeatOffender: { passed: true, status: "eligible" },
  });

  assert.equal(decision.level, "REVIEW");
  assert.equal(decision.approved, false);
});

test("missing required checks do not produce approval or false denial", () => {
  const decision = calculateFinalDecision({
    ofac: { passed: true },
  });

  assert.equal(decision.level, "REVIEW");
  assert.match(decision.reason, /Repeat Offender/);
});

test("matches still deny and clean full checks still approve", () => {
  assert.equal(
    calculateFinalDecision({
      ofac: { passed: false, matches: [{ name: "Match" }] },
      repeatOffender: { passed: true, status: "eligible" },
    }).level,
    "DENIED"
  );

  assert.equal(
    calculateFinalDecision({
      ofac: { passed: true },
      repeatOffender: { passed: true, status: "eligible" },
    }).level,
    "APPROVED"
  );
});

test("extension requires a per-install backend key and keeps storage for records", () => {
  assert.equal(CONFIG.backend.defaultApiKey, null);
  assert.equal(manifest.permissions.includes("unlimitedStorage"), true);
});

test("date picker normalizes typed DOB values for existing checks", () => {
  assert.equal(normalizeDateValue("01/31/1980"), "1980-01-31");
  assert.equal(normalizeDateValue("01311980"), "1980-01-31");
  assert.equal(normalizeDateValue("1980-01-31"), "1980-01-31");
});

test("history archives keep printable compliance evidence", async () => {
  const stored = {
    [STORAGE_KEYS.complianceHistory]: [],
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: stored[key] };
        },
        async set(update) {
          Object.assign(stored, update);
        },
      },
    },
  };

  await saveToHistory({
    customer: {
      firstName: "Jane",
      lastName: "Doe",
      dob: "1980-01-01",
      dlnPid: "S123456789012",
      tradeVin: "1HGBH41JXMN109186",
      hasCoBuyer: true,
      coBuyer: {
        firstName: "John",
        lastName: "Doe",
        dob: "1981-02-03",
        dlnPid: "S123456789013",
      },
    },
    timestamp: new Date().toISOString(),
    runType: "individual",
    runLabel: "Repeat Offender",
    checks: {
      ofac: {
        passed: true,
        entriesSearched: 12345,
        lastUpdate: "2026-05-31T00:00:00.000Z",
      },
      repeatOffender: {
        passed: true,
        status: "eligible",
        rawText: "official portal pass information",
        screenshotData: "data:image/png;base64,abc",
      },
    },
  });

  const archived = stored[STORAGE_KEYS.complianceHistory][0];
  assert.equal(archived.decision, "PARTIAL");
  assert.equal(archived.fullResults.customer.dob, "1980-01-01");
  assert.equal(archived.fullResults.customer.dlnPid, "S123456789012");
  assert.equal(archived.fullResults.customer.coBuyer.dob, "1981-02-03");
  assert.equal(archived.fullResults.checks.repeatOffender.rawText, "official portal pass information");
  assert.equal(archived.fullResults.checks.repeatOffender.screenshotData, "data:image/png;base64,abc");
  assert.equal(archived.fullResults.checks.ofac.entriesSearched, 12345);
});
