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

test("release copy describes session data and persistent local customer history", () => {
  for (const source of [policy, description, listing, privacyTab, submissionPrompt]) {
    assert.match(source, /device-local|on your device|local History/i);
    assert.match(source, /30 days/i);
    assert.doesNotMatch(source, /optional custom backend|custom backend API key/i);
    assert.doesNotMatch(source, /Check:\s*Authentication information/i);
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

test("generated scanner and history media are transparently instructional and local", () => {
  assert.match(assetBuilder, /Instructional composite · Phone scan/);
  assert.match(assetBuilder, /Saved customer history/);
  assert.match(assetBuilder, /CC-20260722-091421/);
});

test("OFAC records are clearly app-generated and do not imitate government letterhead", () => {
  assert.match(reportBuilder, /Compliance Central OFAC Screening Record/);
  assert.match(reportBuilder, /Not issued or endorsed by the U\.S\. Treasury or OFAC/);
  // The downloaded PDF now carries the printed page's own notice rather than a
  // shorter paraphrase of it, so one record cannot disclaim itself two ways.
  assert.match(
    reportBuilder,
    /APP-GENERATED RECORD · NOT ISSUED OR ENDORSED BY THE U\.S\. TREASURY OR OFAC/
  );
  assert.doesNotMatch(reportBuilder, /Draws the official .* letterhead/);
  assert.doesNotMatch(reportBuilder, /U\.S\. DEPARTMENT OF THE TREASURY/);
});

test("Web Store declarations cover captured Michigan website content", () => {
  assert.match(privacyTab, /Website content[\s\S]*Michigan Repeat Offender and title\/lien responses and screenshots/);
  assert.match(privacyTab, /Location[\s\S]*request IP address[\s\S]*transiently in memory/);
  assert.match(submissionPrompt, /Check: Website content/);
  assert.match(submissionPrompt, /Check: Location/);
  assert.doesNotMatch(submissionPrompt, /Do NOT check: location/i);
});

// The store screenshots are captures of the real panel with a staged state, so
// every string the staging writes has to be a string the app actually ships.
// It staged "SOS calculated" where the panel says "Calculated by SOS", which
// put copy in a listing image that the product does not contain.
test("store screenshots stage only copy the app really uses", async () => {
  const { readFile } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const capture = await readFile(new URL("tools/capture-store-shots.mjs", root), "utf8");
  // "Shipped" has to mean the whole runtime, not three hand-picked files — a
  // result line lives in results.js and title-format.js, and a guard that
  // cannot see them would report a true string as missing.
  const { readdir } = await import("node:fs/promises");
  const dirs = ["src/sidepanel", "src/worker", "lib"];
  const parts = [
    await readFile(new URL("sidepanel.js", root), "utf8"),
    await readFile(new URL("sidepanel.html", root), "utf8"),
  ];
  for (const dir of dirs) {
    for (const name of await readdir(new URL(`${dir}/`, root))) {
      if (name.endsWith(".js") && !name.endsWith(".min.js")) {
        parts.push(await readFile(new URL(`${dir}/${name}`, root), "utf8"));
      }
    }
  }
  const shipped = parts.join("\n");

  // Every result line the staging writes, not a hand-kept subset — two of these
  // had already drifted from the copy pass and were photographed for the
  // listing showing wording the product no longer used.
  const stagedResultLines = [...capture.matchAll(
    /\["\w+ResultCard", "\w+ResultStatus", "((?:[^"\\]|\\.)*)"\]/g
  )].map((m) =>
    m[1]
      // The staging writes some characters as escapes; compare the text the
      // page would actually receive.
      .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  );
  assert.ok(stagedResultLines.length >= 3, "expected the staged result lines");

  for (const staged of [
    "Calculated by SOS",
    "Official SOS calculation complete.",
    ...stagedResultLines,
  ]) {
    assert.ok(
      capture.includes(staged),
      `capture script should stage "${staged}"`
    );
    assert.ok(
      shipped.includes(staged),
      `staged copy "${staged}" does not appear anywhere the app ships`
    );
  }
  // And the string it used to stage must not come back.
  assert.doesNotMatch(capture, /textContent = "SOS calculated"/);
});
