import assert from "node:assert/strict";
import test from "node:test";
import { minimizeHistoryEntry, retainAuditHistory } from "../lib/history-retention.js";
import { problemTitleBrands } from "../lib/title-brands.js";
import { STORAGE_KEYS } from "../lib/storage-keys.js";
import { finalDecisionForResults, historyRowDecision } from "../src/sidepanel/checks.js";
import { saveToHistory, populateHistoryModal } from "../src/sidepanel/history.js";
import { combinedAllReportHTML, reportDecisionSummary } from "../src/sidepanel/export.js";
import { handleHistoryMessage } from "../src/worker/history.js";

const VIN = "1HGBH41JXMN109186";
const cleanChecks = () => ({
  ofac: { passed: true },
  repeatOffender: { passed: true, status: "eligible" },
});

test("unknown title results cannot approve or claim every required check completed", () => {
  for (const title of [
    { passed: true, titleBrand: "UNKNOWN", hasLien: false },
    { passed: true, titleBrand: "CLEAN", titleStatus: "No Record Found", hasLien: false },
    { passed: true, status: "error", titleBrand: "CLEAN", hasLien: false },
  ]) {
    const results = { customer: { tradeVin: VIN }, checks: { ...cleanChecks(), title } };
    assert.equal(finalDecisionForResults(results).level, "REVIEW");
    assert.deepEqual(reportDecisionSummary(results).incomplete.map(row => row.label), ["Title / Lien"]);
    assert.doesNotMatch(combinedAllReportHTML(results), /None\. Every required check/);
  }
});

test("co-buyer flags and orphaned co-buyer checks still require both screenings", () => {
  for (const results of [
    { customer: { hasCoBuyer: true }, checks: cleanChecks() },
    { customer: {}, checks: { ...cleanChecks(), coBuyerOfac: { passed: true } } },
  ]) {
    const summary = reportDecisionSummary(results);
    assert.equal(summary.decision.level, "REVIEW");
    assert.ok(summary.incomplete.some(row => row.label === "Co-buyer Repeat Offender"));
    assert.equal(summary.rows.filter(row => row.label.startsWith("Co-buyer")).length, 2);
  }
});

test("a title result without the saved VIN is still represented on the decision cover", () => {
  const results = { customer: {}, checks: { ...cleanChecks(), title: { error: "Unavailable" } } };
  const row = reportDecisionSummary(results).rows.find(row => row.label === "Title / Lien");
  assert.equal(row.state, "UNAVAILABLE");
  assert.equal(row.incomplete, true);
});

test("VIN-only Run all records describe skipped buyer checks as not run", () => {
  const skipped = { passed: null, status: "skipped", message: "Not run — no buyer details entered." };
  const results = {
    customer: { tradeVin: VIN },
    checks: { ofac: skipped, repeatOffender: skipped, title: { passed: true, titleBrand: "CLEAN", hasLien: false } },
  };
  const summary = reportDecisionSummary(results);
  assert.equal(summary.decision.level, "REVIEW");
  assert.deepEqual(summary.incomplete.map(row => [row.label, row.state]), [
    ["Buyer OFAC", "NOT RUN"], ["Buyer Repeat Offender", "NOT RUN"],
  ]);
});

test("co-buyer-only Run all leaves buyer checks incomplete and an empty selected co-buyer cannot approve", () => {
  const skipped = { passed: null, status: "skipped", message: "Not run — no buyer details entered." };
  const results = {
    customer: { hasCoBuyer: true, coBuyer: { firstName: "Sam", lastName: "Example" } },
    checks: {
      ofac: skipped, repeatOffender: skipped,
      coBuyerOfac: { passed: true }, coBuyerRepeatOffender: { passed: true, status: "eligible" },
    },
  };
  const summary = reportDecisionSummary(results);
  assert.equal(summary.decision.level, "REVIEW");
  assert.deepEqual(summary.incomplete.map(row => [row.label, row.state]), [
    ["Buyer OFAC", "NOT RUN"], ["Buyer Repeat Offender", "NOT RUN"],
  ]);
  assert.equal(summary.rows.find(row => row.label === "Title / Lien").state, "NOT APPLICABLE");
  assert.equal(finalDecisionForResults({ customer: { hasCoBuyer: true, coBuyer: {} }, checks: cleanChecks() }).level, "REVIEW");
});

test("only complete no-brand markers can suppress a reported vehicle brand", () => {
  assert.deepEqual(problemTitleBrands({
    titleBrand: "CLEAN",
    vehicleBrands: ["No brand listed; SALVAGE", "Salvage — no brand removal"],
  }), ["No brand listed; SALVAGE", "Salvage — no brand removal"]);
  for (const marker of ["CLEAN", "none", "no brand", "No brands", "No brands were returned", "No brands were returned for this vehicle."]) {
    assert.deepEqual(problemTitleBrands({ titleBrand: "CLEAN", vehicleBrands: [marker] }), []);
  }
  const title = { passed: true, titleBrand: "CLEAN", hasLien: false, vehicleBrands: ["SALVAGE — no brand removal"] };
  const results = { customer: { tradeVin: VIN }, checks: { ...cleanChecks(), title } };
  assert.equal(finalDecisionForResults(results).level, "REVIEW");
  assert.doesNotMatch(combinedAllReportHTML(results), /CLEAR TITLE|no title brands and no active liens/);
});

test("history re-normalizes saved checks and customer metadata instead of stale badges", () => {
  const entry = {
    auditId: "run:stale-badges", timestamp: new Date().toISOString(), decision: "APPROVED",
    checks: { ofac: "clear", repeatOffender: "eligible", title: "clear" },
    savedResults: {
      customer: { firstName: "Alex", lastName: "Example", coBuyer: { firstName: "Sam", lastName: "Example" }, tradeVin: VIN },
      checks: {
        ofac: { passed: false, status: "error", error: "Unavailable" },
        repeatOffender: { status: "eligible", passed: false },
        title: { passed: true, titleBrand: "UNKNOWN", hasLien: false },
      },
    },
  };
  const normalized = minimizeHistoryEntry(entry);
  assert.equal(normalized.customerName, "Alex Example");
  assert.equal(normalized.coBuyerName, "Sam Example");
  assert.equal(normalized.hasCoBuyer, true);
  assert.equal(normalized.hasTrade, true);
  assert.equal(normalized.tradeVin, VIN);
  assert.deepEqual(normalized.checks, {
    ofac: "error", repeatOffender: "review", title: "review",
    coBuyerOfac: "not_run", coBuyerRepeatOffender: "not_run",
  });
  assert.deepEqual(minimizeHistoryEntry(normalized), normalized);
  assert.equal(historyRowDecision(normalized), "REVIEW");
  assert.deepEqual(retainAuditHistory([entry])[0], normalized);
});

test("history badges preserve incomplete and contradictory Repeat Offender states", () => {
  for (const [result, expected] of [
    [{ status: "eligible", passed: null }, "review"],
    [{ status: "ineligible", passed: true }, "review"],
    [{ status: "not_applicable", passed: false }, "review"],
    [{ status: "not_applicable", error: "Unavailable" }, "error"],
    [{ status: "skipped", passed: null }, "not_run"],
    [{ status: "eligible", passed: true }, "eligible"],
    [{ status: "ineligible", passed: false }, "flagged"],
  ]) {
    const entry = minimizeHistoryEntry({ timestamp: new Date().toISOString(), fullResults: { checks: { repeatOffender: result } } });
    assert.equal(entry.checks.repeatOffender, expected, JSON.stringify(result));
  }
});

test("history retains reported title brands and liens even when the title did not pass", async (t) => {
  const branded = { passed: false, titleBrand: "SALVAGE", titleStatus: "Salvage", hasLien: false };
  const timestamp = new Date().toISOString();
  for (const [title, expected] of [
    [branded, "branded"],
    [{ ...branded, hasLien: true }, "branded"],
    [{ passed: false, titleBrand: "CLEAN", vehicleBrands: ["SALVAGE"], hasLien: false }, "branded"],
    [{ passed: false, titleBrand: "CLEAN", hasLien: true }, "lien"],
    [{ passed: false, titleBrand: "CLEAN", hasLien: false }, "review"],
    [{ ...branded, error: "Unavailable" }, "error"],
    [{ ...branded, status: "error" }, "error"],
    [{ ...branded, titleStatus: "No Record Found" }, "review"],
    [{ ...branded, titleBrand: "UNKNOWN" }, "review"],
  ]) {
    const savedResults = { customer: { tradeVin: VIN }, checks: { ...cleanChecks(), title } };
    const entry = minimizeHistoryEntry({ timestamp, savedResults });
    assert.equal(entry.checks.title, expected, JSON.stringify(title));
    assert.equal(finalDecisionForResults(entry.savedResults).level, "REVIEW");
  }

  const previousChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  globalThis.chrome = { storage: { local: { get: async () => ({
    [STORAGE_KEYS.complianceHistory]: [{ timestamp, savedResults: {
      customer: { tradeVin: VIN }, checks: { ...cleanChecks(), title: branded },
    } }],
  }) } } };
  const list = { innerHTML: "" };
  await populateHistoryModal(list);
  assert.match(list.innerHTML, /Title: Branded/);
});

test("saving then reopening a partial record preserves its review verdict and co-buyer", async (t) => {
  const stored = { [STORAGE_KEYS.complianceHistory]: [] };
  const previousChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  // The service-worker message handler exercises the same save/retention path as the panel.
  globalThis.chrome = {
    runtime: { sendMessage: message => handleHistoryMessage(message.type, message.data) },
    storage: {
      local: {
        get: async key => ({ [key]: structuredClone(stored[key]) }),
        set: async values => Object.assign(stored, structuredClone(values)),
      },
      session: { get: async () => ({}) },
    },
  };
  const results = {
    runId: "partial-record", timestamp: new Date().toISOString(),
    customer: { firstName: "Alex", lastName: "Example", coBuyer: { firstName: "Sam" } },
    checks: cleanChecks(), finalDecision: { level: "APPROVED", approved: true },
  };
  assert.equal(await saveToHistory(results), true);
  const entry = stored[STORAGE_KEYS.complianceHistory][0];
  assert.equal(entry.decision, "REVIEW");
  assert.equal(entry.savedResults.finalDecision.level, "REVIEW");
  assert.equal(entry.hasCoBuyer, true);
  assert.equal(finalDecisionForResults(entry.savedResults).level, "REVIEW");
  const list = { innerHTML: "" };
  await populateHistoryModal(list);
  assert.match(list.innerHTML, /Co-buyer OFAC: Not run/);
  assert.match(list.innerHTML, /data-audit="run:partial-record"/);
});
