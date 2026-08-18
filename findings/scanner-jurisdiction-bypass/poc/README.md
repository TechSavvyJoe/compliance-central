# Offline regression harness

> **This harness no longer passes, and that is the point.** The reported entry point was
> fixed on 2026-07-22 in commit `402941c`. The fixture supplies a bare `isMichigan: false`
> with no AAMVA IIN or jurisdiction code, and `sanitizeScanPayload` now discards an
> underived boolean, so the first assertion fails with `undefined` instead of `false`.
> Kept as a record of the original report. See `../scanner-jurisdiction-bypass.md`.

Run from the repository root, or pass a checkout path as the final argument:

```sh
node --experimental-loader ./findings/scanner-jurisdiction-bypass/poc/mock-loader.mjs \
  ./findings/scanner-jurisdiction-bypass/poc/regression.mjs .
```

The harness imports the checked-out sanitizer, orchestration, and final-decision modules. The loader replaces only the OFAC and Michigan provider modules with deterministic in-process stubs. It creates no browser session, pairing session, relay request, or provider request.

As originally written, passing output confirmed that the synthetic `isMichigan: false` classification reached the out-of-state branch, while the local OFAC stub still ran and the final-decision helper returned approval. This was a regression check for jurisdiction consistency, not an end-to-end workflow test.

The live regression coverage for the fix now lives in `tests/review-fixes.test.js`, under `"sanitizeScanPayload derives jurisdiction from AAMVA issuer provenance"`.
