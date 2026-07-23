import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const contentStart = startIndex + start.length;
  const endIndex = source.indexOf(end, contentStart);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(contentStart, endIndex).trim();
}

const policy = read("docs/index.html");
const description = read("store-assets/chrome-web-store/description.txt").trim();
const listing = read("store-assets/chrome-web-store/listing.md");
const privacyTab = read("store-assets/chrome-web-store/privacy-tab.txt");
const submissionPrompt = read(
  "store-assets/chrome-web-store/SUBMISSION-PROMPT.txt"
);
const assetBuilder = read("tools/build-store-assets.mjs");
const reportBuilder = read("src/sidepanel/export.js");

const LIMITED_USE =
  "Compliance Central's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.";

test("public policy and prepared store materials include the affirmative Limited Use disclosure", () => {
  for (const source of [policy, description, listing, privacyTab, submissionPrompt]) {
    assert.match(source, new RegExp(LIMITED_USE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(
    policy,
    /https:\/\/developer\.chrome\.com\/docs\/webstore\/program-policies\/limited-use/
  );
});

test("store description stays synchronized and within the dashboard limit", () => {
  const listingDescription = between(
    listing,
    "DETAILED DESCRIPTION (≤4000 chars)\n\n",
    "\n\nWHAT'S NEW"
  );
  const promptDescription = between(
    submissionPrompt,
    "-----BEGIN DESCRIPTION-----\n",
    "\n-----END DESCRIPTION-----"
  );

  assert.equal(listingDescription, description);
  assert.equal(promptDescription, description);
  assert.ok([...description].length <= 4000, "description must fit the 4,000-character field");
});

test("release copy describes session data and anonymous persistent audit history", () => {
  for (const source of [policy, description, listing, privacyTab, submissionPrompt]) {
    assert.match(source, /anonymous/i);
    assert.match(source, /session/i);
    assert.doesNotMatch(source, /optional custom backend|custom backend API key|Authentication information/i);
  }

  assert.match(policy, /Downloaded files may contain the details shown in the report/);
  assert.match(description, /Downloaded files remain wherever you choose to save them/);
});

test("store copy avoids timing guarantees and legal-certification language", () => {
  for (const source of [description, listing, submissionPrompt]) {
    assert.doesNotMatch(
      source,
      /Ultimate Tool|in seconds|Instant OFAC|results instantly|proof-of-compliance|never screen against/i
    );
  }
  assert.match(description, /they are not a legal certification/i);
  assert.match(description, /require human review/i);
});

test("generated scanner and history media are transparently instructional and anonymous", () => {
  assert.match(assetBuilder, /Instructional composite · Phone scan/);
  assert.match(assetBuilder, /Anonymous audit history/);
  assert.match(assetBuilder, /CC-20260722-091421/);
  assert.doesNotMatch(assetBuilder, /John Anderson|Maria Gomez|VIN ···09186/);
});

test("OFAC records are clearly app-generated and do not imitate government letterhead", () => {
  assert.match(reportBuilder, /Compliance Central OFAC Screening Record/);
  assert.match(reportBuilder, /Not issued or endorsed by the U\.S\. Treasury or OFAC/);
  assert.match(reportBuilder, /NOT ISSUED OR ENDORSED BY TREASURY \/ OFAC/);
  assert.doesNotMatch(reportBuilder, /Draws the official .* letterhead/);
  assert.doesNotMatch(reportBuilder, /U\.S\. DEPARTMENT OF THE TREASURY/);
});

test("Web Store declarations cover captured Michigan website content", () => {
  assert.match(privacyTab, /Website content[\s\S]*Michigan portal responses and screenshots/);
});
