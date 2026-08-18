# Development notes

Two repos make up Compliance Central:

| Repo | Role | Module system |
| --- | --- | --- |
| `compliance-central` (this repo) | Chrome MV3 extension + GitHub Pages (`docs/`) | **ESM** (`"type": "module"`) |
| `compliance-central-api` | Fly.io Express + Puppeteer backend | **CommonJS** (`require` / `module.exports`); test files under `src/__tests__/` use ESM `import` (Node auto-detects module syntax) |

A backend ESM migration was considered and intentionally deferred — it's high-churn for no functional gain. Keep new backend files CommonJS to match `src/index.js`.

## Commands

Extension (this repo):

```bash
npm run check      # node --check on every .js (skips vendored libs)
npm run lint       # eslint . (no-var, prefer-const errors; unused-vars warns)
npm run lint:fix   # eslint . --fix
npm test           # node --test (unit suites under tests/)
npm run package    # build compliance-central-<version>.zip
npm run assets     # regenerate store screenshots/tiles + icons — SEE BELOW, needs sharp
```

`npm run assets` runs `tools/build-store-assets.mjs`, which drives headless Chrome and
imports `sharp`. **`sharp` is not declared in `package.json` and is not installed**, so the
script fails on its first raster step until you run `npm i -D sharp`. Treat the script as
unavailable out of the box; the checked-in images under `store-assets/` are whatever the
last person to install sharp produced.

Backend (`../compliance-central-api`): `npm run lint`, `npm test` (same conventions).

## Lint config lives in two different formats

This repo uses ESLint **flat config**: `eslint.config.js`. There is no `.eslintrc.json`
here. The backend repo (`../compliance-central-api`) is the one with `.eslintrc.json` —
don't go looking for it in this tree.

## Vendored libraries (not linted / not syntax-checked)

`lib/jspdf.umd.min.js`, `lib/qrcode.min.js`, `docs/lib/zxing.min.js`, and
`docs/lib/zxing-wasm/**` — third-party bundles, excluded in both the `check` script and the
`ignores` array in `eslint.config.js`.

## Pairing crypto must stay in sync

`lib/crypto-pair.js` (extension) and `docs/lib/crypto-pair.js` (phone page) duplicate
the base64url + AES-GCM helpers because they ship to two different roots and can't
share a runtime module. The `PARITY` tests in `tests/crypto-pair.test.js` encrypt with
one and decrypt with the other — change both files together and re-run those tests.

## Deferred refactors (post-launch)

- **Split `src/sidepanel/export.js` (2,838 lines) and `src/sidepanel/results.js` (881).**
  Behavior-preserving reorganization with no user-facing benefit; the code is
  compliance-critical (PDF generation) and currently guarded only by ephemeral
  `/tmp/verify_*.cjs` harnesses. Do this with committed PDF/visual regression tests
  as the guard, not at launch time.
- **Backend ESM migration** (see above).
