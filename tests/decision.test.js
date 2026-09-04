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
import { handleHistoryMessage } from "../src/worker/history.js";

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

test("confirmed blockers remain denied when an unrelated check is unavailable", () => {
  const ofacBlocker = calculateFinalDecision({
    ofac: {
      passed: false,
      disposition: "confirmed_match",
      matches: [{ name: "Confirmed candidate" }],
    },
    repeatOffender: {
      passed: false,
      status: "error",
      error: "State service unavailable",
    },
  });
  assert.equal(ofacBlocker.level, "DENIED");
  assert.match(ofacBlocker.reason, /OFAC match/i);

  const repeatBlocker = calculateFinalDecision({
    ofac: { passed: false, status: "error", error: "SDN unavailable" },
    repeatOffender: { passed: false, status: "ineligible" },
  });
  assert.equal(repeatBlocker.level, "DENIED");
  assert.match(repeatBlocker.reason, /Repeat offender/i);
});

test("unknown or contradictory Repeat Offender responses require review", () => {
  const base = { ofac: { passed: true } };
  for (const repeatOffender of [
    { passed: false, status: "eligible" },
    { passed: true, status: "ineligible" },
    { passed: false, status: "mystery" },
    { passed: true },
    { passed: true, status: "not_applicable" },
  ]) {
    const decision = calculateFinalDecision({ ...base, repeatOffender });
    assert.equal(decision.level, "REVIEW");
    assert.equal(decision.approved, false);
    // The reason must attribute the ambiguity to the state's answer and must
    // say it was contradictory — not merely that "a check failed", which a
    // salesperson would read as a retryable outage rather than a real
    // disagreement between the status and the eligibility flag.
    assert.match(decision.reason, /contradictory/i);
    assert.match(decision.reason, /repeat-offender/i);
    assert.match(decision.reason, /review before proceeding/i);
  }
});

test("missing required checks do not produce approval or false denial", () => {
  const decision = calculateFinalDecision({
    ofac: { passed: true },
  });

  assert.equal(decision.level, "REVIEW");
  assert.match(decision.reason, /Repeat Offender/);
});

test("potential matches require review, confirmed matches deny, and clean checks approve", () => {
  assert.equal(
    calculateFinalDecision({
      ofac: { passed: false, matches: [{ name: "Match" }] },
      repeatOffender: { passed: true, status: "eligible" },
    }).level,
    "REVIEW"
  );

  assert.equal(
    calculateFinalDecision({
      ofac: {
        passed: false,
        disposition: "confirmed_match",
        matches: [{ name: "Match" }],
      },
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
  // An unreviewed potential match requires human review.
  assert.equal(
    calculateFinalDecision({
      ofac: { passed: false, matches: [{ name: "Match" }] },
      repeatOffender: { passed: null, status: "not_applicable" },
    }).level,
    "REVIEW"
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

test("history persists a restorable local customer and report record", async () => {
  const stored = {
    [STORAGE_KEYS.complianceHistory]: [],
  };
  globalThis.chrome = {
    runtime: {
      sendMessage(message) {
        return handleHistoryMessage(message.type, message.data);
      },
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: stored[key] };
        },
        async set(update) {
          Object.assign(stored, update);
        },
      },
      session: {
        async get() {
          return {};
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
        authToken: "must-not-persist",
      },
    },
  });
  assert.equal(saved, true);

  const archived = stored[STORAGE_KEYS.complianceHistory][0];
  assert.equal(archived.decision, "PARTIAL");
  assert.match(archived.reference, /^CC-\d{8}-\d{6}$/);
  assert.equal(archived.hasCoBuyer, true);
  assert.equal(archived.hasTrade, true);
  assert.equal(archived.checks.ofac, "clear");
  assert.equal(archived.checks.repeatOffender, "eligible");
  assert.equal(archived.customerName, "Jane Doe");
  assert.equal(archived.coBuyerName, "John Doe");
  assert.equal(archived.tradeVin, "1HGBH41JXMN109186");
  assert.equal(archived.savedResults.customer.dob, "1980-01-01");
  assert.equal(archived.savedResults.customer.dlnPid, "S123456789012");
  assert.equal(
    archived.savedResults.checks.repeatOffender.screenshotData,
    "data:image/png;base64,abc"
  );
  const serialized = JSON.stringify(archived);
  assert.doesNotMatch(serialized, /must-not-persist/);
  assert.match(serialized, /official portal pass information/);
});

test("history save reports storage failure to its caller", async () => {
  globalThis.chrome = {
    runtime: {
      sendMessage(message) {
        return handleHistoryMessage(message.type, message.data);
      },
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: [] };
        },
        async set() {
          throw new Error("quota unavailable");
        },
      },
      session: {
        async get() {
          return {};
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

// The panel and the printed report must never disagree about one deal. The
// report always downgraded APPROVED to REVIEW when a required check was
// missing; the screen reused whatever verdict was cached on the record. A
// History row saved under earlier rules therefore read APPROVED in the panel
// and REVIEW REQUIRED on the document printed from that same row.
test("the screen and the printed report reach the same verdict", async () => {
  const { finalDecisionForResults } = await import("../src/sidepanel/checks.js");
  const { reportDecisionSummary } = await import("../src/sidepanel/export.js");

  const clean = {
    ofac: { passed: true },
    repeatOffender: { status: "eligible", passed: true },
  };

  const cases = [
    ["co-buyer screened but their OFAC never arrived", { customer: { coBuyer: { firstName: "B" } }, checks: clean }],
    ["trade VIN entered but no title check", { customer: { tradeVin: "1FTFW1E84PFA10397" }, checks: clean }],
    ["title check errored", { customer: { tradeVin: "1FTFW1E84PFA10397" }, checks: { ...clean, title: { error: "portal down" } } }],
  ];

  for (const [label, results] of cases) {
    const screen = finalDecisionForResults(results);
    const report = reportDecisionSummary(results).decision;
    assert.equal(screen.level, "REVIEW", `${label}: screen must not approve`);
    assert.equal(report.level, "REVIEW", `${label}: report must not approve`);
    assert.equal(screen.level, report.level, `${label}: surfaces must agree`);
  }

  // A complete, clean run still approves on both surfaces.
  const complete = { customer: {}, checks: clean };
  assert.equal(finalDecisionForResults(complete).level, "APPROVED");
  assert.equal(reportDecisionSummary(complete).decision.level, "APPROVED");

  // A stored verdict never overrides a recomputed one.
  const stale = { customer: { tradeVin: "1FTFW1E84PFA10397" }, checks: clean, finalDecision: { level: "APPROVED", approved: true } };
  assert.equal(finalDecisionForResults(stale).level, "REVIEW");
});

// The OFAC triage handler persists its verdict to session BEFORE
// displayResults recomputes it, so a call site that still used the base
// calculateFinalDecision stored an un-downgraded APPROVED while both visible
// surfaces said REVIEW for the same record. No panel call site may bypass the
// shared downgrade.
test("every panel verdict flows through the shared downgrade", async () => {
  const source = await readFile(
    new URL("../sidepanel.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /finalDecisionForResults\(results\)/);
  assert.doesNotMatch(
    source,
    /calculateFinalDecision\s*\(/,
    "sidepanel.js must not compute a verdict without the incomplete-checks downgrade"
  );
});

// "Run all checks" used to demand all four buyer identity fields, so a dealer
// who only wanted a title and lien check on a VIN could not use it: they had to
// expand the trade section, scroll, and press a different button. It now runs
// whatever the entered data supports.
test("run all plans the checks the entered data can support", async () => {
  const { planChecksForData, hasRunnableChecks } = await import(
    "../src/sidepanel/form.js"
  );

  // A VIN on its own is a title-and-lien check, not an error.
  const vinOnly = planChecksForData({ tradeVin: "1FTFW1E84PFA10397" });
  assert.equal(vinOnly.title, true);
  assert.equal(vinOnly.buyer, false);
  assert.equal(vinOnly.buyerPartial, false);
  assert.equal(hasRunnableChecks({ tradeVin: "1FTFW1E84PFA10397" }), true);

  // A buyer on their own screens without needing a trade.
  const buyerOnly = planChecksForData({
    firstName: "Marcus", lastName: "Delaney", dob: "04/12/1986", dlnPid: "D123456789012",
  });
  assert.equal(buyerOnly.buyer, true);
  assert.equal(buyerOnly.buyerPartial, false);
  assert.equal(buyerOnly.title, false);

  // A half-filled person is a mistake, not an instruction to skip them — it
  // must be flagged for correction rather than silently dropped, which is the
  // exact failure this product exists to prevent.
  const partial = planChecksForData({ firstName: "Marcus", lastName: "Delaney" });
  assert.equal(partial.buyer, true);
  assert.equal(partial.buyerPartial, true);

  // A co-buyer is only planned when one was actually added.
  const noCo = planChecksForData({ tradeVin: "1FTFW1E84PFA10397", coBuyer: { firstName: "Dana" } });
  assert.equal(noCo.coBuyer, false);
  const withCo = planChecksForData({
    hasCoBuyer: true,
    coBuyer: { firstName: "Dana", lastName: "Whitfield", dob: "01/02/1990", dlnPid: "W987654321098" },
  });
  assert.equal(withCo.coBuyer, true);
  assert.equal(withCo.coBuyerPartial, false);

  // Nothing entered is nothing to run.
  assert.equal(hasRunnableChecks({}), false);
  assert.equal(hasRunnableChecks({ firstName: "   " }), false);
});

// The whole point of allowing a partial run is that it must never be mistaken
// for a complete one.
test("a partial run can never read as approved", async () => {
  const { finalDecisionForResults } = await import("../src/sidepanel/checks.js");
  const now = Date.now();

  // Everything clear and complete: approved, as a control.
  const full = finalDecisionForResults({
    customer: { firstName: "Marcus", lastName: "Delaney" },
    checks: {
      ofac: { passed: true, timestamp: now },
      repeatOffender: { passed: true, status: "eligible", timestamp: now },
    },
  });
  assert.equal(full.level, "APPROVED");

  // The trade-only run the owner asked for: title clear, buyer never screened.
  // A clear title must not carry the record to APPROVED on its own.
  const tradeOnly = finalDecisionForResults({
    customer: { tradeVin: "1FTFW1E84PFA10397" },
    checks: {
      ofac: { passed: null, status: "skipped", message: "Not run — no buyer details were entered for this check." },
      repeatOffender: { passed: null, status: "skipped", message: "Not run — no buyer details were entered for this check." },
      title: { passed: true, status: "clear", timestamp: now },
    },
  });
  assert.notEqual(tradeOnly.level, "APPROVED");
  assert.equal(tradeOnly.approved, false);
  // And it must say the screening was not run, rather than implying it ran and
  // returned something strange.
  assert.match(tradeOnly.reason, /not run/i);
  assert.doesNotMatch(tradeOnly.reason, /unrecognized/i);
});

// A dealership that cannot reach OFAC screens against the cached SDN list, and
// the app's rule for that is explicit: a clean result on a list it could not
// refresh is not a confident clear. Triaging a fuzzy hit as a false positive
// escaped that rule entirely — the same record read REVIEW with no match and
// APPROVED once a match had been found and cleared, which is the wrong way
// round. Staleness is about the entries that were never compared, so no
// disposition can answer it.
test("a stale SDN list still requires review after a match is cleared", () => {
  const clearedOnStaleList = {
    passed: false,
    matches: [{ name: "Cleared candidate" }],
    matchCount: 1,
    disposition: "false_positive",
    stale: true,
    dataAgeHours: 40,
  };
  const eligible = { passed: true, status: "eligible" };

  const buyer = calculateFinalDecision({
    ofac: clearedOnStaleList,
    repeatOffender: eligible,
  });
  assert.equal(buyer.level, "REVIEW");
  assert.equal(buyer.approved, false);
  assert.match(buyer.reason, /could not be refreshed/i);

  const coBuyer = calculateFinalDecision({
    ofac: { passed: true },
    repeatOffender: eligible,
    coBuyerOfac: clearedOnStaleList,
    coBuyerRepeatOffender: eligible,
  });
  assert.equal(coBuyer.level, "REVIEW");

  // A false positive cleared against a current list still approves.
  assert.equal(
    calculateFinalDecision({
      ofac: { ...clearedOnStaleList, stale: false },
      repeatOffender: eligible,
    }).level,
    "APPROVED"
  );
});

// Michigan will refuse to register the vehicle. That is a finding, not a
// pending question, and an OFAC hit nobody has compared yet must not turn it
// into one: the potential-match branch sat between the two blocker branches
// and softened a denial into "compare before you decide".
test("a repeat-offender denial is not softened by an untriaged OFAC match", () => {
  const untriaged = { passed: false, matches: [{ name: "Candidate" }], matchCount: 1 };

  const buyer = calculateFinalDecision({
    ofac: untriaged,
    repeatOffender: { status: "ineligible", passed: false },
  });
  assert.equal(buyer.level, "DENIED");
  assert.match(buyer.reason, /repeat offender/i);

  const coBuyer = calculateFinalDecision({
    ofac: untriaged,
    repeatOffender: { status: "eligible", passed: true },
    coBuyerOfac: { passed: true },
    coBuyerRepeatOffender: { status: "ineligible", passed: false },
  });
  assert.equal(coBuyer.level, "DENIED");

  // A confirmed OFAC match still names itself first.
  assert.match(
    calculateFinalDecision({
      ofac: { passed: false, disposition: "confirmed_match", matches: [{ name: "X" }] },
      repeatOffender: { status: "ineligible", passed: false },
    }).reason,
    /OFAC match/i
  );

  // With no blocker, an untriaged match still asks for the comparison.
  assert.match(
    calculateFinalDecision({
      ofac: untriaged,
      repeatOffender: { status: "eligible", passed: true },
    }).reason,
    /compare the buyer/i
  );
});

// Michigan reports a brand two ways: the title's own status, and a separate
// vehicle-brand list. The final decision has always read both. Every surface
// that describes the title read only the first, so a salvage trade printed
// "CLEAR TITLE — Michigan reported no title brands and no active liens" on the
// document that goes in the deal jacket, and the audit CSV recorded "Clear".
test("a brand reported only in vehicleBrands never reads as a clear title", async () => {
  const { titlePresentation } = await import("../src/sidepanel/title-format.js");
  const { retainAuditHistory } = await import("../lib/history-retention.js");
  const { reportDecisionSummary } = await import("../src/sidepanel/export.js");

  const title = {
    passed: true,
    titleStatus: "Clear",
    titleBrand: "CLEAN",
    titleType: "Paper",
    hasLien: false,
    lienStatus: "No Active Liens",
    vehicleBrands: ["SALVAGE"],
  };

  const presentation = titlePresentation(title);
  assert.notEqual(presentation.statusKey, "pass");
  assert.notEqual(presentation.state, "clear");
  assert.match(presentation.title, /SALVAGE/i);
  assert.doesNotMatch(presentation.subtitle, /no title brands/i);

  const results = {
    timestamp: "2026-09-03T12:00:00.000Z",
    customer: { firstName: "A", lastName: "B", tradeVin: "1FTFW1E84PFA10397" },
    checks: {
      ofac: { passed: true },
      repeatOffender: { status: "eligible", passed: true },
      title,
    },
  };

  // The decision already refused; the printed check summary must agree.
  assert.equal(calculateFinalDecision(results.checks).level, "REVIEW");
  const row = reportDecisionSummary(results).rows.find(
    (item) => item.label === "Title / Lien"
  );
  assert.notEqual(row.state, "CLEAR");
  assert.doesNotMatch(row.detail, /no title brands/i);

  // And the audit trail must not record it as clear.
  const stored = retainAuditHistory([
    {
      runId: "r-brand",
      timestamp: Date.now(),
      decision: "REVIEW",
      runType: "full",
      fullResults: results,
    },
  ]);
  assert.equal(stored[0].checks.title, "branded");

  // A genuinely clean title is untouched.
  assert.equal(
    titlePresentation({ ...title, vehicleBrands: [] }).statusKey,
    "pass"
  );
});
