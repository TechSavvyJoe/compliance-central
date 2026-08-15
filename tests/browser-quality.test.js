import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidepanelHtml = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const datePickerSource = readFileSync(
  new URL("../src/sidepanel/date-picker.js", import.meta.url),
  "utf8"
);
const resultsSource = readFileSync(
  new URL("../src/sidepanel/results.js", import.meta.url),
  "utf8"
);

test("DOB fields avoid browser autofill warnings in the extension panel", () => {
  assert.doesNotMatch(sidepanelHtml, /autocomplete="bday"/);
  assert.match(sidepanelHtml, /id="dob"[\s\S]*?autocomplete="off"/);
});

test("generated date-picker month controls have unique form identifiers", () => {
  assert.match(
    datePickerSource,
    /<select id="\$\{state\.input\.id\}MonthSelect" name="\$\{state\.input\.id\}Month" class="date-month-select"/
  );
});

test("data-use disclosure ties remote checks to an affirmative user action", () => {
  assert.match(sidepanelHtml, /OFAC stays on this computer/);
  assert.match(sidepanelHtml, /Submitted customer fields and completed reports[\s\S]*?up to 30 days/);
  assert.match(sidepanelHtml, /State checks send the name, birth date/);
  assert.match(sidepanelHtml, /license\/ID number,[\s\S]*?trade-in VIN when used/);
  assert.match(sidepanelHtml, /Compliance Central over HTTPS/);
  assert.match(sidepanelHtml, /Running a check means you agree/);
  assert.match(sidepanelHtml, />Details<\/a>/);
  for (const id of [
    "runAllChecksBtn",
    "runOfacBtn",
    "runRepeatOffenderBtn",
    "runTitleBtn",
  ]) {
    assert.match(
      sidepanelHtml,
      new RegExp(`id="${id}"[^>]*aria-describedby="dataUseNote"`)
    );
  }
});

test("evidence controls are explicit and completed rows identify their own timestamp", () => {
  assert.match(sidepanelHtml, /class="evidence-heading"/);
  assert.match(sidepanelHtml, /Print selected/);
  assert.match(sidepanelHtml, /Download selected PDF/);
  for (const id of [
    "ofacResultTimestamp",
    "repeatResultTimestamp",
    "titleResultTimestamp",
    "cbOfacResultTimestamp",
    "cbRepeatResultTimestamp",
  ]) {
    assert.match(sidepanelHtml, new RegExp(`id="${id}"`));
  }
  assert.match(resultsSource, /function setResultTimestamp/);
  assert.match(resultsSource, /Completed \$\{date\.toLocaleString\(\)\}/);
});

test("bulk exports expose accessible per-document selection and all three actions", () => {
  assert.match(sidepanelHtml, /<fieldset id="reportSelectionPanel"/);
  assert.match(sidepanelHtml, /id="selectAllReports"/);
  for (const key of [
    "decision",
    "buyer-ofac",
    "buyer-repeat",
    "title",
    "co-buyer-ofac",
    "co-buyer-repeat",
  ]) {
    assert.match(sidepanelHtml, new RegExp(`data-report-row="${key}"`));
  }
  assert.match(sidepanelHtml, /id="printAllBtn"/);
  assert.match(sidepanelHtml, /id="downloadPdfBtn"/);
  assert.match(sidepanelHtml, /id="downloadAllPdfsBtn"/);
  assert.match(sidepanelHtml, /Download All PDFs/);
});
