import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  historyCustomerLabel,
  shortHistoryReference,
} from "../src/sidepanel/history.js";

const root = new URL("../", import.meta.url);

test("screening uses the Claude Design first-run composition", async () => {
  const html = await readFile(new URL("sidepanel.html", root), "utf8");
  const css = await readFile(new URL("sidepanel.css", root), "utf8");

  assert.match(html, /id="firstRunHero" class="first-run-hero"/);
  assert.match(html, /<h2 id="firstRunTitle">Scan the buyer's ID<\/h2>/);
  assert.match(html, /class="typed-buyer-title">Or type it in<\/span>/);
  assert.match(html, /class="required-label">4 required<\/span>/);
  assert.match(css, /\.first-run-hero\s*\{[^}]*background:\s*#0d2b4a/s);
  assert.match(css, /\.first-run-scan-btn\s*\{[^}]*background:\s*#ffcb05/s);
});

test("completed screening is grouped into a verdict, evidence, and deal steps", async () => {
  const html = await readFile(new URL("sidepanel.html", root), "utf8");
  const css = await readFile(new URL("sidepanel.css", root), "utf8");
  const results = await readFile(
    new URL("src/sidepanel/results.js", root),
    "utf8"
  );

  assert.match(html, /class="evidence-panel"/);
  assert.match(html, /id="completedStepsPanel" class="completed-steps-panel"/);
  assert.match(css, /\.evidence-panel \.check-icon\s*\{[^}]*width:\s*26px[^}]*height:\s*26px/s);
  assert.match(results, /eyebrow = "All checks passed"/);
  assert.match(results, /headline = "Clear to deliver"/);
  assert.match(results, /tone = "verdict-action"/);
  assert.match(results, /eyebrow = "Possible match · needs you"/);
  assert.match(results, /hasRepeatFlag/);
  assert.match(results, /MCL 257\.219/);
});

test("redesign keeps customer-controlled screening and saved report actions", async () => {
  const html = await readFile(new URL("sidepanel.html", root), "utf8");
  const js = await readFile(new URL("sidepanel.js", root), "utf8");

  assert.match(html, /id="runAllChecksBtn"/);
  assert.match(html, /Running a check means you agree\./);
  assert.match(html, /id="downloadEvidenceBtn"/);
  assert.match(html, /id="printEvidenceBtn"/);
  assert.match(js, /downloadEvidenceBtn.*downloadAllReportsPDF/s);
  assert.match(js, /history-print-btn/);
  assert.match(js, /history-download-btn/);
});

test("Buyer, co-buyer, and optional workflow rows use full-width controls", async () => {
  const html = await readFile(new URL("sidepanel.html", root), "utf8");
  const css = await readFile(new URL("sidepanel.css", root), "utf8");

  assert.match(
    html,
    /<button[^>]+id="inputSummaryBar"[\s\S]*?<strong>Buyer<\/strong>[\s\S]*?<\/button>/
  );
  assert.match(
    html,
    /<button[^>]+id="editCompletedBuyerBtn"[^>]+class="completed-step-row"[\s\S]*?<strong>Buyer<\/strong>[\s\S]*?Expand[\s\S]*?<\/button>/
  );
  assert.match(css, /\.completed-step-row\s*\{[\s\S]*?cursor:\s*pointer/);
  assert.match(
    html,
    /<label[^>]+class="cobuyer-toggle input-section"[^>]+for="hasCoBuyer"[\s\S]*?aria-controls="coBuyerSection"[\s\S]*?<\/label>/
  );
  assert.match(
    html,
    /<button[^>]+id="tradeSectionHeader"[^>]+aria-controls="tradeSectionContent"/
  );
  assert.match(css, /\.cobuyer-toggle\s*\{[\s\S]*?cursor:\s*pointer/);
});

test("the DOB calendar uses a readable light redesign surface", async () => {
  const css = await readFile(new URL("sidepanel.css", root), "utf8");
  assert.match(css, /\.date-picker-popover\s*\{[\s\S]*?background:\s*#ffffff;[\s\S]*?color:\s*#142b43/);
  assert.match(css, /\.date-day\s*\{[\s\S]*?color:\s*#142b43/);
  assert.match(css, /\.date-day\.is-selected\s*\{[\s\S]*?background:\s*var\(--gold\)[\s\S]*?color:\s*#00274c/);
});

test("saved records lead with the customer name and demote the internal reference", async () => {
  const html = await readFile(new URL("sidepanel.html", root), "utf8");
  const history = await readFile(
    new URL("src/sidepanel/history.js", root),
    "utf8"
  );
  const item = {
    customerName: "Marcus Delaney",
    reference: "CC-20260815-113802",
    savedResults: {
      customer: {
        firstName: "Marcus",
        middleName: "Theodore",
        lastName: "Delaney",
        suffix: "Jr",
      },
    },
  };

  assert.equal(historyCustomerLabel(item), "Delaney, Marcus Theodore Jr");
  assert.equal(shortHistoryReference(item.reference), "ref 02");
  assert.match(html, /placeholder="Search by name, vehicle or date"/);
  assert.match(history, /class="history-customer">\$\{primaryLabel\}/);
  assert.match(history, /title="\$\{sanitizeHTML\(item\.reference\)\}"/);
});

test("the compact fee reference matches current published Michigan amounts", async () => {
  const html = await readFile(new URL("sidepanel.html", root), "utf8");
  for (const copy of [
    "$267 car · $367 truck/bus",
    "$113 car · $183 truck/bus",
    "$55 ($5 + $50 Road Fund)",
    "$35 ($25 donation + $10 service)",
    "$15 one year · $29 two year",
    "$10 + prorated difference",
    "Existing digital plates must be replaced with standard metal plates as of Aug. 9, 2026.",
  ]) {
    assert.ok(html.includes(copy), `missing fee reference: ${copy}`);
  }
  assert.match(html, /The official calculation above remains the amount to use\./);
});

test("the redesigned UI does not expose a Screenshot button", async () => {
  const html = await readFile(new URL("sidepanel.html", root), "utf8");
  const buttonText = Array.from(html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi))
    .map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .join("\n");
  assert.doesNotMatch(buttonText, /screenshot/i);
});
