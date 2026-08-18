/**
 * Measured OFAC name-matching quality.
 *
 * Threshold changes used to be argued rather than demonstrated: the surname
 * floor was last tuned against a handful of pairs chosen by hand. This scores
 * the matcher against a labelled corpus and reports precision and recall, so
 * the next person to touch a threshold can show whether their change helped.
 *
 * Recall is the number that must not regress. A missed sanctions hit is a legal
 * failure; a false positive costs a reviewer a few seconds.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { checkNameMatch } from "../ofac/search.js";

const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/ofac-name-evaluation.json", import.meta.url), "utf8")
);

function score(cases) {
  const outcome = { tp: 0, fp: 0, tn: 0, fn: 0, misses: [] };
  for (const item of cases) {
    const matched = checkNameMatch(item.search, item.entry).isMatch;
    const shouldMatch = item.expected === "match";
    if (matched && shouldMatch) outcome.tp += 1;
    else if (matched && !shouldMatch) {
      outcome.fp += 1;
      outcome.misses.push(`FALSE POSITIVE  ${label(item)} — ${item.reason}`);
    } else if (!matched && shouldMatch) {
      outcome.fn += 1;
      outcome.misses.push(`MISSED MATCH    ${label(item)} — ${item.reason}`);
    } else outcome.tn += 1;
  }
  const precision = outcome.tp / (outcome.tp + outcome.fp || 1);
  const recall = outcome.tp / (outcome.tp + outcome.fn || 1);
  return { ...outcome, precision, recall };
}

function label(item) {
  const name = (person) =>
    [person.firstName, person.lastName].filter(Boolean).join(" ") ||
    (person.aliases || []).join("/") ||
    "(alias only)";
  return `${name(item.search)} vs ${name(item.entry)}`;
}

test("OFAC screening never misses a name a reviewer should see", () => {
  const result = score(corpus.cases);
  const report =
    `\n  recall    ${(result.recall * 100).toFixed(1)}%  (${result.tp}/${result.tp + result.fn} true matches found)` +
    `\n  precision ${(result.precision * 100).toFixed(1)}%  (${result.fp} false positives)` +
    (result.misses.length ? `\n  ${result.misses.join("\n  ")}` : "");
  // Recall is the safety-critical direction and must stay perfect.
  assert.equal(result.fn, 0, `a true match was missed:${report}`);
  assert.equal(result.recall, 1, `recall regressed:${report}`);
});

test("OFAC screening keeps obvious false positives out of review", () => {
  const result = score(corpus.cases);
  // Precision is allowed to be imperfect — flagging is the safe direction — but
  // a drop here means reviewers are being trained to dismiss hits.
  assert.ok(
    result.precision >= 0.9,
    `precision fell to ${(result.precision * 100).toFixed(1)}%: ${result.misses.join("; ")}`
  );
});

test("short surnames are knowingly exempt from the floor, not accidentally", () => {
  // One character dominates an edit-distance score on a 2-3 letter surname, so
  // the floor is skipped there and these deliberately still reach a reviewer.
  // If this ever starts failing, the exemption was removed and real hits on
  // short surnames are now being suppressed.
  for (const item of corpus.knownExemptions) {
    assert.equal(
      checkNameMatch(item.search, item.entry).isMatch,
      true,
      `${label(item)} should still flag — ${item.reason}`
    );
  }
});
