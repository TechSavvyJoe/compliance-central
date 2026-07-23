import assert from "node:assert/strict";
import test from "node:test";

import { buildAuditCsv } from "../src/sidepanel/audit-csv.js";

const SAMPLE = [
  {
    timestamp: "2026-06-16T14:30:00.000Z",
    reference: "CC-20260616-123456",
    decision: "APPROVED",
    runType: "full",
    runLabel: "Run All Checks",
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

test("buildAuditCsv emits anonymous, per-subject audit columns", () => {
  const csv = buildAuditCsv(SAMPLE);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Timestamp,Audit Reference,Run,Buyer OFAC,/);
  assert.doesNotMatch(csv, /Customer|Date of Birth|Trade VIN/);
});

test("buildAuditCsv preserves typed outcomes without false clear or match labels", () => {
  const lines = buildAuditCsv(SAMPLE).split("\r\n");
  assert.match(
    lines[1],
    /CC-20260616-123456,Run All Checks,Clear,Eligible,Clear,Eligible,Active lien,APPROVED$/
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
  assert.equal(csv.split("\r\n")[0].split(",").length, 9);
});

test("buildAuditCsv handles empty history (header only)", () => {
  assert.equal(buildAuditCsv([]).split("\r\n").length, 1);
  assert.equal(buildAuditCsv(undefined).split("\r\n").length, 1);
});
