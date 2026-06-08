import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeName,
  jaroWinkler,
  calculateNameSimilarity,
  checkNameMatch,
  searchSDNEntries,
} from "../ofac/search.js";

test("normalizeName strips punctuation, lowercases, and collapses whitespace", () => {
  assert.equal(normalizeName("  O'Brien-Smith,  Jr. "), "o brien smith jr");
  assert.equal(normalizeName(""), "");
  assert.equal(normalizeName(null), "");
});

test("jaroWinkler is 1.0 for identical strings and rewards shared prefixes", () => {
  assert.equal(jaroWinkler("smith", "smith"), 1.0);
  assert.equal(jaroWinkler("smith", ""), 0.0);
  // Prefix bonus: 'martha' vs 'marhta' scores higher than an unrelated word.
  assert.ok(jaroWinkler("martha", "marhta") > jaroWinkler("martha", "zzzzzz"));
});

test("exact name match scores 100", () => {
  const score = calculateNameSimilarity(
    { firstName: "John", middleName: "", lastName: "Doe" },
    { firstName: "John", middleName: "", lastName: "Doe" }
  );
  assert.equal(score, 100);
});

test("a clearly different last name falls below the 85 threshold", () => {
  const score = calculateNameSimilarity(
    { firstName: "John", middleName: "", lastName: "Doe" },
    { firstName: "John", middleName: "", lastName: "Zimmerman" }
  );
  assert.ok(score < 85, `expected < 85, got ${score}`);
});

test("missing middle name does not unfairly penalize an otherwise exact match", () => {
  const withoutMiddle = calculateNameSimilarity(
    { firstName: "John", middleName: "", lastName: "Doe" },
    { firstName: "John", middleName: "Robert", lastName: "Doe" }
  );
  assert.equal(withoutMiddle, 100);
});

test("checkNameMatch matches against aliases, not just the primary name", () => {
  const entry = {
    firstName: "Saddam",
    middleName: "",
    lastName: "Hussein",
    fullName: "Saddam Hussein",
    aliases: ["Abu Ali"],
  };
  const result = checkNameMatch(
    { firstName: "Abu", middleName: "", lastName: "Ali" },
    entry,
    85
  );
  assert.equal(result.isMatch, true);
  assert.equal(result.matchedName, "Abu Ali");
});

test("searchSDNEntries returns only above-threshold matches, highest score first", () => {
  const entries = [
    { firstName: "John", middleName: "", lastName: "Doe", fullName: "John Doe", aliases: [] },
    { firstName: "Jane", middleName: "", lastName: "Zimmerman", fullName: "Jane Zimmerman", aliases: [] },
    { firstName: "Jon", middleName: "", lastName: "Doe", fullName: "Jon Doe", aliases: [] },
  ];
  const matches = searchSDNEntries(
    { firstName: "John", middleName: "", lastName: "Doe" },
    entries,
    85
  );
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].matchedName, "John Doe");
  // Sorted descending by score.
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i - 1].score >= matches[i].score);
  }
  // The unrelated "Zimmerman" entry must not appear.
  assert.ok(!matches.some((m) => m.matchedName === "Jane Zimmerman"));
});
