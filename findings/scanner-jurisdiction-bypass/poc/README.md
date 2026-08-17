# Offline regression harness

Run from the repository root, or pass a checkout path as the final argument:

```sh
node --experimental-loader ./findings/scanner-jurisdiction-bypass/poc/mock-loader.mjs \
  ./findings/scanner-jurisdiction-bypass/poc/regression.mjs .
```

The harness imports the checked-out sanitizer, orchestration, and final-decision modules. The loader replaces only the OFAC and Michigan provider modules with deterministic in-process stubs. It creates no browser session, pairing session, relay request, or provider request.

Passing output confirms that the synthetic `isMichigan: false` classification reaches the out-of-state branch, while the local OFAC stub still runs and the final-decision helper returns approval. This is a regression check for jurisdiction consistency, not an end-to-end workflow test.
