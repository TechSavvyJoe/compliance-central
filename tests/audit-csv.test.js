import assert from "node:assert/strict";
import test from "node:test";

import { buildAuditCsv } from "../src/sidepanel/audit-csv.js";

const SAMPLE = [
  {
    timestamp: "2026-06-16T14:30:00.000Z",
    reference: "CC-20260616-123456",
    customerName: "Jamie Dealer",
    coBuyerName: "Taylor Dealer",
    tradeVin: "1HGBH41JXMN109186",
    decision: "APPROVED",
    runType: "full",
    runLabel: "Run all checks",
    hasCoBuyer: true,
    checks: {
      ofac: "clear",
      repeatOffender: "eligible",
      coBuyerOfac: "clear",
      coBuyerRepeatOffender: "eligible",
      title: "lien",
    },
  },
  {
    timestamp: "2026-06-15T09:00:00.000Z",
    reference: "CC-20260615-654321",
    decision: "REVIEW",
    runType: "full",
    hasCoBuyer: false,
    checks: {
      ofac: "error",
      repeatOffender: "na",
      title: "review",
    },
  },
];

test("buildAuditCsv emits identified, per-subject audit columns", () => {
  const csv = buildAuditCsv(SAMPLE);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Timestamp,Audit Reference,Customer,Co-Buyer,Trade VIN,Run,Buyer OFAC,/);
  assert.match(csv, /Jamie Dealer,Taylor Dealer,1HGBH41JXMN109186/);
});

test("buildAuditCsv preserves typed outcomes without false clear or match labels", () => {
  const lines = buildAuditCsv(SAMPLE).split("\r\n");
  assert.match(
    lines[1],
    /CC-20260616-123456,Jamie Dealer,Taylor Dealer,1HGBH41JXMN109186,Run all checks,Clear,Eligible,Clear,Eligible,Active lien,APPROVED$/
  );
  assert.match(
    lines[2],
    /Unavailable,N\/A,N\/A,N\/A,Review,REVIEW$/
  );
  assert.doesNotMatch(lines[2], /Potential match|Flagged/);
});

test("buildAuditCsv neutralizes spreadsheet formulas and preserves columns", () => {
  const csv = buildAuditCsv([
    {
      timestamp: "2026-06-16T00:00:00.000Z",
      reference: "=HYPERLINK(\"https://bad.invalid\")",
      runLabel: "+SUM(1,2)",
      decision: "REVIEW",
      runType: "full",
      hasCoBuyer: false,
      checks: {
        ofac: "clear",
        repeatOffender: "eligible",
        title: "clear",
      },
    },
  ]);
  const row = csv.split("\r\n")[1];
  assert.ok(row.includes("'=HYPERLINK"));
  assert.ok(row.includes("'+SUM"));
  assert.equal(csv.split("\r\n")[0].split(",").length, 12);
});

test("buildAuditCsv handles empty history (header only)", () => {
  assert.equal(buildAuditCsv([]).split("\r\n").length, 1);
  assert.equal(buildAuditCsv(undefined).split("\r\n").length, 1);
});

// The audit trail is the surface that must never soften a result. Three ways
// it disagreed with the decision the salesperson actually saw:
test("the stored record and the CSV agree with the live decision", async () => {
  const { retainAuditHistory } = await import("../lib/history-retention.js");
  const { classifyOfacResult, classifyRepeatOffenderResult } = await import(
    "../src/sidepanel/checks.js"
  );

  const store = (checks) =>
    retainAuditHistory([
      {
        runId: "r1",
        timestamp: Date.now(),
        decision: "X",
        runType: "full",
        fullResults: { customer: { firstName: "A" }, checks },
      },
    ]);

  // A confirmed match found against a cached list was recorded as merely
  // "stale" — DENIED on screen, "list was out of date" in the record.
  const staleConfirmed = {
    passed: false,
    disposition: "confirmed_match",
    stale: true,
    matches: [{ name: "X" }],
  };
  assert.equal(classifyOfacResult(staleConfirmed).state, "confirmed_match");
  assert.equal(store({ ofac: staleConfirmed })[0].checks.ofac, "confirmed_match");

  // A still-stale clear result must keep reporting stale.
  assert.equal(
    store({ ofac: { passed: true, stale: true } })[0].checks.ofac,
    "stale"
  );

  // A contradictory repeat-offender response recorded as a green "eligible"
  // while the report printed REVIEW REQUIRED. The audit trail failed open.
  const contradictory = { status: "eligible", passed: false };
  assert.equal(classifyRepeatOffenderResult(contradictory).state, "review");
  assert.equal(
    store({ repeatOffender: contradictory })[0].checks.repeatOffender,
    "review"
  );
  // An uncontradicted eligible result is still eligible.
  assert.equal(
    store({ repeatOffender: { status: "eligible", passed: true } })[0].checks
      .repeatOffender,
    "eligible"
  );

  // Three OFAC states had no CSV label and fell through to "Review", so the
  // examiner-facing export could not tell a blocked deal from a routine one.
  for (const [disposition, expected] of [
    ["confirmed_match", "Confirmed match — blocked"],
    ["false_positive", "False positive (reviewed)"],
  ]) {
    const csv = buildAuditCsv(
      store({
        ofac: { passed: false, disposition, matches: [{ name: "X" }] },
      })
    );
    assert.ok(
      csv.includes(expected),
      `CSV should label ${disposition} as "${expected}"`
    );
    assert.ok(!/,Review,/.test(csv), `${disposition} must not export as Review`);
  }
});

// A saved row stores the verdict that was current when it was written, and
// older releases wrote it under older rules. Reopening a row recomputes for the
// panel and the printed report but never rewrites the stored value — so a
// legacy APPROVED could sit in the History list and in the examiner's audit CSV
// while both live surfaces said REVIEW for the very same record.
test("the audit CSV reports the verdict the saved checks actually support", async () => {
  const { buildAuditCsv } = await import("../src/sidepanel/audit-csv.js");
  const now = Date.now();

  // Stored APPROVED, but the screening never completed.
  const stale = [
    {
      timestamp: new Date(now).toISOString(),
      reference: "CC-1",
      customerName: "Marcus Delaney",
      runLabel: "Run all checks",
      decision: "APPROVED",
      checks: { ofac: { passed: true } },
      savedResults: {
        customer: { firstName: "Marcus", lastName: "Delaney" },
        checks: { ofac: { passed: true, timestamp: now } },
      },
    },
  ];
  const csv = buildAuditCsv(stale);
  assert.match(csv, /REVIEW/, "an incomplete record must not export as APPROVED");
  assert.doesNotMatch(csv.split("\r\n")[1] || "", /APPROVED/);

  // A genuinely complete, clean record still exports APPROVED.
  const clean = [
    {
      ...stale[0],
      reference: "CC-2",
      savedResults: {
        customer: { firstName: "Marcus", lastName: "Delaney" },
        checks: {
          ofac: { passed: true, timestamp: now },
          repeatOffender: { passed: true, status: "eligible", timestamp: now },
        },
      },
    },
  ];
  assert.match(buildAuditCsv(clean), /APPROVED/);

  // A record saved before the app kept its checks has nothing to recompute
  // from, so its stored decision stands — it is all there is.
  const outcomeOnly = [
    {
      timestamp: new Date(now).toISOString(),
      reference: "CC-3",
      customerName: "Old Record",
      decision: "APPROVED",
    },
  ];
  assert.match(buildAuditCsv(outcomeOnly), /APPROVED/);
});
