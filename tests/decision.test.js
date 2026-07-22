import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CONFIG } from "../lib/config.js";
import { STORAGE_KEYS } from "../lib/storage-keys.js";
import { normalizeDateValue } from "../src/sidepanel/date-picker.js";
import { calculateFinalDecision } from "../src/sidepanel/checks.js";
import {
  decisionMeta,
  saveToHistory,
} from "../src/sidepanel/history.js";

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

test("a clean but STALE OFAC screen requires review, not silent approval", () => {
  // Stale SDN list (could not refresh) + no match → REVIEW, not APPROVED.
  assert.equal(
    calculateFinalDecision({
      ofac: { passed: true, stale: true, dataAgeHours: 40 },
      repeatOffender: { passed: true, status: "eligible" },
    }).level,
    "REVIEW"
  );
  // Fresh clean screen still approves.
  assert.equal(
    calculateFinalDecision({
      ofac: { passed: true, stale: false },
      repeatOffender: { passed: true, status: "eligible" },
    }).level,
    "APPROVED"
  );
  // A co-buyer stale screen also triggers review.
  assert.equal(
    calculateFinalDecision({
      ofac: { passed: true },
      repeatOffender: { passed: true, status: "eligible" },
      coBuyerOfac: { passed: true, stale: true },
      coBuyerRepeatOffender: { passed: true, status: "eligible" },
    }).level,
    "REVIEW"
  );
});

test("out-of-state subject: Repeat Offender not_applicable is non-blocking (OFAC governs)", () => {
  // Out-of-state buyer: OFAC passed, RO N/A (passed:null) -> APPROVED, not DENIED.
  assert.equal(
    calculateFinalDecision({
      ofac: { passed: true },
      repeatOffender: { passed: null, status: "not_applicable" },
    }).level,
    "APPROVED"
  );
  // But an out-of-state subject who IS an OFAC match still denies.
  assert.equal(
    calculateFinalDecision({
      ofac: { passed: false, matches: [{ name: "Match" }] },
      repeatOffender: { passed: null, status: "not_applicable" },
    }).level,
    "DENIED"
  );
  // Out-of-state co-buyer RO N/A is also non-blocking.
  assert.equal(
    calculateFinalDecision({
      ofac: { passed: true },
      repeatOffender: { passed: true, status: "eligible" },
      coBuyerOfac: { passed: true },
      coBuyerRepeatOffender: { passed: null, status: "not_applicable" },
    }).level,
    "APPROVED"
  );
});

test("an active-lien APPROVED never warns 'Trade lien: Unknown'", () => {
  // Backend gives a lien status but no lienholder name (the common case).
  const decision = calculateFinalDecision({
    ofac: { passed: true },
    repeatOffender: { passed: true, status: "eligible" },
    title: { passed: true, hasLien: true, lienStatus: "Active Lien on Vehicle" },
  });
  assert.equal(decision.level, "APPROVED");
  assert.equal(decision.warnings.length, 1);
  assert.doesNotMatch(decision.warnings[0], /unknown/i);
  assert.match(decision.warnings[0], /payoff/i);

  // When a real lienholder IS known, it is named in the warning.
  const named = calculateFinalDecision({
    ofac: { passed: true },
    repeatOffender: { passed: true, status: "eligible" },
    title: { passed: true, hasLien: true, lienHolder: "Ally Financial" },
  });
  assert.match(named.warnings[0], /Ally Financial/);
});

test("an unconfirmed or unknown title result requires review", () => {
  const base = {
    ofac: { passed: true },
    repeatOffender: { passed: true, status: "eligible" },
  };

  for (const title of [
    { passed: false, titleBrand: "CLEAN", hasLien: false },
    { titleBrand: "CLEAN", hasLien: false },
    { passed: false, titleBrand: "UNKNOWN", hasLien: false },
  ]) {
    const decision = calculateFinalDecision({ ...base, title });
    assert.equal(decision.level, "REVIEW");
    assert.equal(decision.approved, false);
  }
});

test("legacy or corrupt history decisions never render as Approved", () => {
  assert.equal(decisionMeta("APPROVED").label, "Approved");
  assert.equal(decisionMeta("UNKNOWN").label, "Unknown");
  assert.equal(decisionMeta(undefined).label, "Unknown");
  assert.equal(decisionMeta("UNKNOWN").cls, "dec-review");
});

test("ships a built-in backend key so all checks work with no setup", () => {
  assert.ok(CONFIG.backend.defaultApiKey, "a built-in default key should be shipped");
  assert.equal(manifest.permissions.includes("unlimitedStorage"), true);
});

test("date picker normalizes typed DOB values for existing checks", () => {
  assert.equal(normalizeDateValue("01/31/1980"), "1980-01-31");
  assert.equal(normalizeDateValue("01311980"), "1980-01-31");
  assert.equal(normalizeDateValue("1980-01-31"), "1980-01-31");
});

test("history archives keep printable text evidence without screenshot payloads", async () => {
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

  const saved = await saveToHistory({
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
  assert.equal(saved, true);

  const archived = stored[STORAGE_KEYS.complianceHistory][0];
  assert.equal(archived.decision, "PARTIAL");
  assert.equal(archived.fullResults.customer.dob, "1980-01-01");
  assert.equal(archived.fullResults.customer.dlnPid, "S123456789012");
  assert.equal(archived.fullResults.customer.coBuyer.dob, "1981-02-03");
  assert.equal(archived.fullResults.checks.repeatOffender.rawText, "official portal pass information");
  assert.equal(archived.fullResults.checks.repeatOffender.screenshotData, undefined);
  assert.equal(archived.fullResults.checks.ofac.entriesSearched, 12345);
});

test("history save reports storage failure to its caller", async () => {
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: [] };
        },
        async set() {
          throw new Error("quota unavailable");
        },
      },
    },
  };

  const originalError = console.error;
  console.error = () => {};
  try {
    const saved = await saveToHistory({
      customer: { firstName: "Jane", lastName: "Doe", tradeVin: "" },
      timestamp: new Date().toISOString(),
      runType: "individual",
      runLabel: "OFAC Only",
      checks: { ofac: { passed: true } },
    });
    assert.equal(saved, false);
  } finally {
    console.error = originalError;
  }
});
