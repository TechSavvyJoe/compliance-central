import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidepanelHtml = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const datePickerSource = readFileSync(
  new URL("../src/sidepanel/date-picker.js", import.meta.url),
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
  assert.match(sidepanelHtml, /OFAC stays here/);
  assert.match(sidepanelHtml, /locally for 30 days \(50 records\)/);
  assert.match(sidepanelHtml, /Repeat Offender\/Title checks securely[\s\S]*?send only needed fields/);
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
