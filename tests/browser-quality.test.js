import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidepanelHtml = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const sidepanelCss = readFileSync(new URL("../sidepanel.css", import.meta.url), "utf8");
const sidepanelScript = readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
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

test("the privacy disclosure closes its paragraph inside its disclosure", () => {
  // The </p> and </details> were transposed, so the browser closed the
  // paragraph early and emitted a stray empty <p> as a sibling of the
  // disclosure. Nothing looked wrong, and the consent copy is the one part of
  // this panel that has to stay exactly as written.
  const block = sidepanelHtml.match(
    /<details id="dataUseDetails"[\s\S]*?<\/details>/
  );
  assert.ok(block, "the data-use disclosure should be a <details> block");
  assert.match(block[0], /<p id="dataUseNote"[\s\S]*?<\/p>\s*<\/details>$/);
  assert.doesNotMatch(sidepanelHtml, /<\/details>\s*<\/p>/);
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
  assert.match(sidepanelHtml, /Download all PDFs/);
});

test("the floated export legend is cleared by the row beneath it", () => {
  // "Documents to export" is a <legend>, floated so it does not notch the card
  // border. A full-width float leaves no room beside it, and the "Select all"
  // row is a flex container, so it keeps its own formatting context, refuses
  // to overlap the float, shrinks to a sliver and wraps its label one word per
  // line — a 420px column of empty white between the verdict and the print
  // buttons, on every completed deal. The clear is what keeps the panel 152px
  // instead of 509px. Float and clear ship together or neither ships.
  const floated = /\.report-selection legend\s*\{[^}]*float:\s*left/.test(
    sidepanelCss
  );
  if (floated) {
    assert.match(
      sidepanelCss,
      /\.report-selection \.report-select-all\s*\{[^}]*clear:\s*both/,
      "a floated export legend needs .report-select-all to clear it"
    );
  }
});

test("the sticky tab strip parks at the sticky header's own height", () => {
  // The offset used to be a hand-tuned 99px. Anything that changed the header
  // left the tab strip floating over or under the content beneath it, and the
  // 380px breakpoint carried a second copy of the number that drifted to 98px.
  assert.match(sidepanelCss, /--hub-header-h:\s*\d+px/);
  assert.match(
    sidepanelCss,
    /\.workspace-tabs\s*\{[^}]*top:\s*var\(--hub-header-h\)/,
    "the tab strip should stick at var(--hub-header-h), not a literal"
  );
  assert.doesNotMatch(sidepanelCss, /\.workspace-tabs\s*\{[^}]*top:\s*\d+px/);
});

test("the header carries no second route to the three workspace tabs", () => {
  // A search-shaped header button searched nothing: it opened a menu of
  // Screening / Plate calculator / History, the same three tabs 8px below it,
  // for 50px of a sticky header on every screen.
  assert.doesNotMatch(sidepanelHtml, /id="commandBarBtn"/);
  assert.doesNotMatch(sidepanelHtml, /id="commandMenu"/);
  assert.match(sidepanelHtml, /id="screeningTabBtn"/);
  assert.match(sidepanelHtml, /id="sosTabBtn"/);
  assert.match(sidepanelHtml, /id="viewHistoryBtn"/);
  // Searching saved deals is the History box's job, and it stays.
  assert.match(sidepanelHtml, /id="historySearchInput"/);
});

test("results-view exports are real targets and the icon-only ones say what they do", () => {
  // The row a finished deal opens with had one filled navy chip and two pieces
  // of blue text, and the chip was "New customer" — the control that clears
  // the screen rather than the ones that put the record in the deal jacket.
  // The exports are the chips now, and they clear a 30px target; they used to
  // be 46x24 with 2px of horizontal padding.
  assert.match(
    sidepanelCss,
    /\.evidence-download-btn\s*\{[^}]*min-height:\s*30px/,
    "PDF all / Print all should keep a 30px minimum target"
  );
  // Inside the evidence panel the per-check save collapses to a 30px icon with
  // its label switched off, so the only thing left to explain it is the title.
  for (const id of [
    "downloadOfacBtn",
    "downloadRepeatBtn",
    "downloadTitleBtn",
    "downloadCbOfacBtn",
    "downloadCbRepeatBtn",
  ]) {
    assert.match(
      sidepanelHtml,
      new RegExp(`id="${id}" title="Download [^"]+"`),
      `${id} should name itself on hover`
    );
  }
});

test("clearing the form puts the Trade-in section back the way it starts", () => {
  // Clear resets the buyer, the co-buyer and the SOS owner birthdate, but it
  // used to leave Trade-in expanded over an empty VIN: the next customer began
  // 118px lower, under a chevron pointing up beside a label reading "Add".
  // One helper owns the panel, aria-expanded and the chevron together, so a
  // caller cannot set two of the three and forget the last.
  assert.match(sidepanelScript, /function setTradeSectionOpen\(open\)/);
  assert.match(sidepanelScript, /elements\.tradeVin\.value = "";\s*\n\s*setTradeSectionOpen\(false\);/);
  // No call site should still be writing the three by hand.
  assert.doesNotMatch(
    sidepanelScript,
    /classList\.remove\("collapsed"\)[\s\S]{0,200}?aria-expanded/
  );
});
