# Scanner jurisdiction classification can suppress a required screening

## Executive Summary

The scanner-to-extension handoff preserves a scanner-supplied `isMichigan` boolean without reconciling it with the accompanying identity fields. The run-all workflow treats `false` as out of state, records the Repeat Offender result as `not_applicable`, and the final-decision helper treats that status as non-blocking. As a result, a contradictory but otherwise accepted local scan fixture can produce an `APPROVED` decision without invoking the Michigan Repeat Offender check.

This is a constrained jurisdiction-consistency risk, not a finding about transport confidentiality, account access, or provider security. Pairing, encryption, visible notices, and dealer confirmation remain meaningful controls. The defect is that the screened workflow accepts one unverified jurisdiction classification as authoritative for eligibility.

## Background

The phone scanner submits parsed identity data to the extension. The extension sanitizes the received data, then uses `buyerIsMichigan` to decide whether the Michigan Repeat Offender screening applies. The intended out-of-state behavior is valid when the classification is truthful; the integrity concern arises when the classification and the rest of the accepted identity evidence disagree.

We followed the value through the local sanitizer, the run-all branch, and the final decision helper. The regression fixture is deliberately synthetic and uses only deterministic local provider replacements; it does not contact a phone, relay, browser profile, or external provider.

## Vulnerability Details

`sanitizeScanPayload` retains a boolean value without deriving or validating it against the accepted identity fields:

```js
if (typeof buyerSrc.isMichigan === "boolean") {
  buyer.isMichigan = buyerSrc.isMichigan;
}
```

The orchestrator then suppresses the Repeat Offender operation when the value is `false`:

```js
if (customer.buyerIsMichigan === false) {
  results.checks.repeatOffender = {
    passed: null,
    status: "not_applicable",
  };
}
```

Finally, the decision helper converts that skipped status into a passing condition:

```js
const repeatPass =
  checks.repeatOffender.status === "not_applicable"
    ? true
    : checks.repeatOffender.passed;
```

Together, these paths allow a false jurisdiction claim to decide whether a required state-specific screening occurs. The affected state is a single compliance decision and its retained result, rather than credentials, tenants, or application code.

## Exploitability Analysis (constrained jurisdiction-consistency risk)

The issue requires a contradictory but structurally accepted identity record to reach an active dealer workflow and be accepted through the normal review process. It is constrained by the pairing capability, encrypted transport, explicit dealer confirmation, out-of-state notices, continued OFAC screening, and the visible `N/A` result. Those controls reduce likelihood and make the branch observable, but none compares the scanner's jurisdiction boolean with mutually consistent issuer, jurisdiction, license-format, or authoritative evidence before the decision branch.

The deterministic fixture demonstrates only local semantic behavior: the false flag survives sanitization, OFAC is called once, Repeat Offender is called zero times, and the actual final-decision function returns `APPROVED`. It does not establish how frequently a contradictory record could be presented in practice or bypass any review control.

## Proof of Concept (safe synthetic local fixture)

We run the included harness against a repository checkout. It imports the real sanitizer, orchestrator, and decision helper, while an ESM loader replaces only the OFAC and Michigan provider modules with in-process deterministic stubs. The fixture contains fictional names and an explicitly false `isMichigan` flag; it does not create a pairing session or make any network request.

```sh
node --experimental-loader ./findings/scanner-jurisdiction-bypass/poc/mock-loader.mjs \
  ./findings/scanner-jurisdiction-bypass/poc/regression.mjs .
```

Expected assertions are that the synthetic flag remains `false`, OFAC is called once, Repeat Offender is called zero times, the stored Repeat result is `not_applicable`, and the final decision is approved. I reviewed and ran this local regression harness successfully against the supplied checkout; no live phone, relay, or provider interaction was performed.

## Remediation

Treat jurisdiction eligibility as derived, validated data rather than a relayed boolean. Before assigning `buyerIsMichigan`, derive the classification from a canonical issuer/jurisdiction representation and reject or route contradictory fields to explicit review. A conservative approach is to require a completed Repeat Offender check whenever identity evidence is inconsistent or cannot establish an out-of-state classification.

Retain the current encrypted pairing flow, review confirmation, visible status labels, and out-of-state messaging as defense in depth. Add unit coverage for contradictory scanner fields and an integration-level assertion that a Michigan-form identity cannot become `not_applicable` solely because of a relayed boolean.

## Summary

The application correctly supports genuinely out-of-state identities, but the current trust boundary lets an unvalidated scanner classification control that exception. Re-deriving jurisdiction from consistent identity evidence, and failing closed to review on contradictions, prevents a skipped Michigan screening from contributing to an otherwise approved decision.
