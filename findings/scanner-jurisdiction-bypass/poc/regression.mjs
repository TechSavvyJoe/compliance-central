import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { calls, resetCalls } from "./stub-state.mjs";

const repoPath = resolve(process.argv[2] || process.cwd());
const moduleUrl = (relativePath) =>
  pathToFileURL(resolve(repoPath, relativePath)).href;

await Promise.all([
  access(resolve(repoPath, "src/sidepanel/scan-pairing.js")),
  access(resolve(repoPath, "src/worker/orchestrator.js")),
  access(resolve(repoPath, "src/sidepanel/checks.js")),
]);

const [{ sanitizeScanPayload }, { handleRunAllChecks }, { calculateFinalDecision }] =
  await Promise.all([
    import(moduleUrl("src/sidepanel/scan-pairing.js")),
    import(moduleUrl("src/worker/orchestrator.js")),
    import(moduleUrl("src/sidepanel/checks.js")),
  ]);

const sessionState = {};
globalThis.chrome = {
  storage: {
    session: {
      async get(keys) {
        const result = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          result[key] = sessionState[key];
        }
        return result;
      },
      async set(values) {
        Object.assign(sessionState, values);
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionState[key];
      },
    },
  },
  action: {
    async setBadgeText() {},
    async setBadgeBackgroundColor() {},
  },
};

resetCalls();
const sanitized = sanitizeScanPayload({
  buyer: {
    firstName: "PAT",
    middleName: "ALEX",
    lastName: "SAMPLE",
    dob: "08/08/1985",
    dlnPid: "S 123 456 789 012",
    isMichigan: false,
  },
});

assert.ok(sanitized, "the synthetic record should be accepted by the sanitizer");
assert.equal(sanitized.buyer.isMichigan, false);

const response = await handleRunAllChecks({
  customer: {
    ...sanitized.buyer,
    buyerIsMichigan: sanitized.buyer.isMichigan,
    hasCoBuyer: false,
  },
  hasTrade: false,
  runId: "local-jurisdiction-regression",
});

assert.equal(response.success, true);
assert.equal(calls.ofac, 1);
assert.equal(calls.repeatOffender, 0);
assert.equal(calls.title, 0);

const checks = sessionState.currentResults.checks;
assert.equal(checks.repeatOffender.status, "not_applicable");
assert.equal(checks.repeatOffender.passed, null);

const decision = calculateFinalDecision(checks);
assert.equal(decision.level, "APPROVED");
assert.equal(decision.approved, true);

console.log(JSON.stringify({ calls, repeatOffender: checks.repeatOffender, decision }, null, 2));
