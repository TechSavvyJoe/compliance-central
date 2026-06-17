import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanLienHolder,
  formatTitleType,
  titleTypeNote,
  lienSummary,
  formatLienStatus,
} from "../src/sidepanel/title-format.js";

test("formatTitleType labels paper vs electronic clearly", () => {
  assert.equal(formatTitleType("Electronic"), "Electronic (digital e-title)");
  assert.equal(formatTitleType("ELT"), "Electronic (digital e-title)");
  assert.equal(formatTitleType("e-title"), "Electronic (digital e-title)");
  assert.equal(formatTitleType("Paper"), "Paper");
  assert.equal(formatTitleType(""), "");
  assert.equal(formatTitleType("UNKNOWN"), "");
  assert.equal(formatTitleType("Bonded"), "Bonded"); // passthrough for other types
});

test("titleTypeNote explains the transfer implication", () => {
  assert.match(titleTypeNote("Electronic"), /Secretary of State|release/i);
  assert.match(titleTypeNote("Paper"), /physical|assigned/i);
  assert.equal(titleTypeNote(""), "");
});

test("cleanLienHolder accepts real names, rejects status words/garbage", () => {
  assert.equal(cleanLienHolder("Ally Financial"), "Ally Financial");
  assert.equal(cleanLienHolder("  TD Auto Finance "), "TD Auto Finance");
  // Junk / status words / empties never render as a holder.
  assert.equal(cleanLienHolder("Active Lien"), "");
  assert.equal(cleanLienHolder("Unknown"), "");
  assert.equal(cleanLienHolder("N/A"), "");
  assert.equal(cleanLienHolder("Lienholder"), "");
  assert.equal(cleanLienHolder(""), "");
  assert.equal(cleanLienHolder("   "), "");
  assert.equal(cleanLienHolder("123"), ""); // no letters
});

test("cleanLienHolder rejects captured section-header tokens (trailing colon)", () => {
  // The MDOS page can yield "Lienholder Information:" -> the extractor captures
  // "Information:" — the trailing colon must NOT slip past the junk filter.
  assert.equal(cleanLienHolder("Information:"), "");
  assert.equal(cleanLienHolder("Status:"), "");
  assert.equal(cleanLienHolder("Lien Holder:"), "");
  assert.equal(cleanLienHolder("  Information  "), "");
});

test("cleanLienHolder trims trailing tabular label noise to the first column", () => {
  // A same-line layout appends a second label; keep only the holder name.
  assert.equal(
    cleanLienHolder("ALLY FINANCIAL    Address: 123 MAIN ST"),
    "ALLY FINANCIAL"
  );
});

test("formatLienStatus rejects junk tokens / bare affirmatives, keeps real status", () => {
  assert.equal(formatLienStatus("Active Lien on Vehicle", true), "Active Lien on Vehicle");
  assert.equal(formatLienStatus("Yes", true), "Active lien"); // bare affirmative
  assert.equal(formatLienStatus("Information", true), "Active lien"); // junk header
  assert.equal(formatLienStatus("Information:", true), "Active lien");
  assert.equal(formatLienStatus("UNKNOWN", true), "Active lien");
  assert.equal(formatLienStatus("", true), "Active lien");
  assert.equal(formatLienStatus("", false), "No active liens");
});

test("lienSummary never prints 'Unknown' and uses the holder when known", () => {
  assert.equal(lienSummary({ hasLien: false }), "");
  assert.match(
    lienSummary({ hasLien: true, lienHolder: "Ally Financial" }),
    /^Lienholder: Ally Financial/
  );
  // No holder -> generic, actionable, and explicitly NOT "Unknown".
  const generic = lienSummary({ hasLien: true });
  assert.match(generic, /active lien/i);
  assert.match(generic, /payoff/i);
  assert.doesNotMatch(generic, /unknown/i);
  // A status string in the holder field is rejected, falling back to generic.
  assert.doesNotMatch(
    lienSummary({ hasLien: true, lienHolder: "Active Lien on Vehicle" }),
    /unknown/i
  );
});
