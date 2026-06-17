import assert from "node:assert/strict";
import test from "node:test";

import { buildAuditCsv } from "../src/sidepanel/audit-csv.js";

const SAMPLE = [
  {
    timestamp: "2026-06-16T14:30:00.000Z",
    customer: "Jane Doe",
    vin: "1HGBH41JXMN109186",
    decision: "APPROVED",
    runType: "full",
    runLabel: "Run All Checks",
    checks: { ofac: true, repeatOffender: true, title: true },
    fullResults: { customer: { dob: "1980-01-01" } },
  },
  {
    timestamp: "2026-06-15T09:00:00.000Z",
    customer: "John Smith",
    vin: null,
    decision: "DENIED",
    runType: "full",
    checks: { ofac: false, repeatOffender: "na", title: undefined },
    fullResults: { customer: { dob: "1975-12-31" } },
  },
];

test("buildAuditCsv emits a header row plus one row per entry", () => {
  const csv = buildAuditCsv(SAMPLE);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3); // header + 2
  assert.match(lines[0], /^Timestamp,Customer,Date of Birth,/);
});

test("buildAuditCsv maps each check result and the final decision", () => {
  const lines = buildAuditCsv(SAMPLE).split("\r\n");
  // Row 1: all clear, approved.
  assert.match(lines[1], /Jane Doe/);
  assert.match(lines[1], /1980-01-01/);
  assert.match(lines[1], /Clear,Eligible,Clear,APPROVED$/);
  // Row 2: OFAC match, RO not-applicable, title not run, denied.
  assert.match(lines[2], /Match,N\/A,—,DENIED$/);
});

test("buildAuditCsv quotes cells containing commas/quotes (no column shift)", () => {
  const csv = buildAuditCsv([
    {
      timestamp: "2026-06-16T00:00:00.000Z",
      customer: 'Doe, "JJ" Jr',
      vin: "V",
      decision: "REVIEW",
      runType: "full",
      checks: { ofac: true, repeatOffender: true, title: true },
      fullResults: { customer: { dob: "1990-02-02" } },
    },
  ]);
  const row = csv.split("\r\n")[1];
  // The comma-and-quote name must be wrapped and its quotes doubled.
  assert.ok(row.includes('"Doe, ""JJ"" Jr"'));
  // Still exactly 9 columns once the quoted field is accounted for.
  assert.equal(csv.split("\r\n")[0].split(",").length, 9);
});

test("buildAuditCsv handles empty history (header only)", () => {
  assert.equal(buildAuditCsv([]).split("\r\n").length, 1);
  assert.equal(buildAuditCsv(undefined).split("\r\n").length, 1);
});
