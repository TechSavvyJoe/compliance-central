import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeName,
  jaroWinkler,
  calculateNameSimilarity,
  checkNameMatch,
  searchSDNEntries,
  dobConfidence,
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

test("dobConfidence: same/near birth year is high, clearly different is low", () => {
  // Customer DOB (YYYY-MM-DD or MM/DD/YYYY) vs SDN free-form birth_date.
  assert.equal(dobConfidence("1969-08-18", "1969-08-18"), "high");
  assert.equal(dobConfidence("1969-08-18", "1969"), "high"); // bare year
  assert.equal(dobConfidence("08/18/1969", "1970-01-01"), "high"); // ±1 slip
  assert.equal(dobConfidence("1969-08-18", "1944-04-28"), "low"); // 25y apart
});

test("dobConfidence: missing DOB on either side is medium (cannot disambiguate)", () => {
  assert.equal(dobConfidence("", "1969-08-18"), "medium");
  assert.equal(dobConfidence("1969-08-18", ""), "medium");
  assert.equal(dobConfidence("", ""), "medium");
});

test("dobConfidence: multi-value SDN birth_date matches if ANY year is near", () => {
  // OpenSanctions can carry several semicolon-separated dates.
  assert.equal(dobConfidence("1969-08-18", "1944-01-01;1969-12-31"), "high");
  assert.equal(dobConfidence("1969-08-18", "1944-01-01;1955-12-31"), "low");
});

test("searchSDNEntries threads DOB into per-match confidence (display-only)", () => {
  const entries = [
    {
      firstName: "John",
      middleName: "",
      lastName: "Doe",
      fullName: "John Doe",
      birthDate: "1980-05-05",
      aliases: [],
    },
  ];
  const sameYear = searchSDNEntries(
    { firstName: "John", middleName: "", lastName: "Doe", dob: "1980-05-05" },
    entries,
    85
  );
  assert.equal(sameYear[0].confidence, "high");
  assert.equal(sameYear[0].sdnBirthDate, "1980-05-05");

  const diffYear = searchSDNEntries(
    { firstName: "John", middleName: "", lastName: "Doe", dob: "1955-05-05" },
    entries,
    85
  );
  // A name match with a clearly different DOB still MATCHES (name is what
  // blocks); confidence merely flags it as a likely false positive.
  assert.equal(diffYear.length, 1);
  assert.equal(diffYear[0].confidence, "low");

  const noDob = searchSDNEntries(
    { firstName: "John", middleName: "", lastName: "Doe" },
    entries,
    85
  );
  assert.equal(noDob[0].confidence, "medium");
});
