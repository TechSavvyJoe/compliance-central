import assert from "node:assert/strict";
import test from "node:test";

import {
  htmlContainsImages,
  createPrintJobId,
  PRINT_STORAGE_PREFIX,
} from "../lib/print-html.js";
import {
  formatDobForMdos,
  formatDlnForMdos,
} from "../src/sidepanel/export.js";

test("htmlContainsImages detects img tags case-insensitively", () => {
  assert.equal(htmlContainsImages('<img src="x">'), true);
  assert.equal(htmlContainsImages("<IMG SRC='x'>"), true);
  assert.equal(htmlContainsImages("<div>no image</div>"), false);
  assert.equal(htmlContainsImages(""), false);
  assert.equal(htmlContainsImages(null), false);
});

test("createPrintJobId uses the storage prefix", () => {
  const id = createPrintJobId();
  assert.ok(id.startsWith(PRINT_STORAGE_PREFIX));
  assert.ok(id.length > PRINT_STORAGE_PREFIX.length + 4);
});

test("formatDobForMdos and formatDlnForMdos normalize for MDOS print HTML", () => {
  assert.equal(formatDobForMdos(" 08/08/1985 "), "08/08/1985");
  assert.equal(formatDobForMdos(""), "");
  assert.equal(formatDobForMdos(null), "");
  assert.equal(formatDlnForMdos(" s123 456 "), "S123 456");
  assert.equal(formatDlnForMdos(""), "");
});
