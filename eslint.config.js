import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  {
    ignores: [
      "node_modules/**",
      ".cursor/**",
      "lib/jspdf.umd.min.js",
      "lib/qrcode.min.js",
      "lib/html2canvas.min.js",
      "docs/lib/zxing.min.js",
      "docs/lib/zxing-wasm/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        ...globals.webextensions,
        ZXing: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      eqeqeq: ["error", "smart"],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Several boundary adapters intentionally replace transport/provider
      // errors with safe user-facing messages instead of retaining raw causes.
      "preserve-caught-error": "off",
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["docs/lib/aamva.js", "src/sidepanel/scan-pairing.js"],
    rules: {
      // These expressions deliberately strip ASCII control bytes from scanned
      // AAMVA/PDF417 payloads before parsing or transport.
      "no-control-regex": "off",
    },
  },
]);
