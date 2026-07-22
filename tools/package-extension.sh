#!/usr/bin/env bash
#
# Build the Chrome Web Store upload zip — runtime files only.
# Usage: npm run package   (or: bash tools/package-extension.sh)
#
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="compliance-central-${VERSION}.zip"
rm -f "$OUT"

# Only the files Chrome actually runs. Everything else (tests/, store-assets/,
# docs/, tools/, .git, .remember, package.json, icon masters) is excluded by
# omission.
zip -r -X "$OUT" \
  manifest.json \
  service-worker.js \
  sidepanel.html sidepanel.js sidepanel.css \
  print-runner.html print-runner.js \
  src lib ofac \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  -x "**/.DS_Store" >/dev/null

node tools/verify-extension-package.mjs "$OUT"

echo "Created $OUT ($(du -h "$OUT" | cut -f1))"
echo "Contents:"
unzip -l "$OUT"
