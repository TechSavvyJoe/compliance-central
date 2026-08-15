import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
