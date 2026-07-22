#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, posix } from "node:path";

const archive = process.argv[2];
if (!archive) {
  throw new Error("Usage: verify-extension-package.mjs <extension.zip>");
}

const unzip = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
if (unzip.status !== 0) {
  throw new Error(unzip.stderr || `Could not inspect ${archive}`);
}

const entries = unzip.stdout
  .split(/\r?\n/)
  .map((entry) => entry.replace(/^\.\//, ""))
  .filter(Boolean);
const files = new Set(entries.filter((entry) => !entry.endsWith("/")));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

const required = new Set([
  "manifest.json",
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  "sidepanel.js",
  "sidepanel.css",
  "print-runner.html",
  "print-runner.js",
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
].filter(Boolean));

// Literal extension-page URLs are runtime entry points too. A missing target
// can still make window.open() look successful, preventing fallback behavior.
for (const sourcePath of [...files].filter((entry) => entry.endsWith(".js"))) {
  const source = readFileSync(sourcePath, "utf8");
  for (const match of source.matchAll(
    /chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/g
  )) {
    required.add(match[1]);
  }
}

// Local scripts and styles referenced by packaged HTML must also be present.
for (const htmlPath of [...files].filter((entry) => entry.endsWith(".html"))) {
  const html = readFileSync(htmlPath, "utf8");
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const ref = match[1].split(/[?#]/, 1)[0];
    if (!ref || /^(?:https?:|data:|#|mailto:)/i.test(ref)) continue;
    if ([".js", ".css", ".png", ".jpg", ".jpeg", ".webp"].includes(extname(ref))) {
      required.add(
        ref.startsWith("/")
          ? ref.slice(1)
          : posix.normalize(posix.join(posix.dirname(htmlPath), ref))
      );
    }
  }
}

const missing = [...required].filter((entry) => !files.has(entry)).sort();
if (missing.length) {
  throw new Error(`Extension package is missing runtime files: ${missing.join(", ")}`);
}

const forbiddenPrefixes = [
  ".git/",
  ".cursor/",
  "docs/",
  "findings/",
  "node_modules/",
  "specs/",
  "store-assets/",
  "tests/",
  "tools/",
];
const forbiddenFiles = new Set(["package.json", "package-lock.json"]);
const forbidden = [...files].filter(
  (entry) =>
    forbiddenFiles.has(entry) ||
    forbiddenPrefixes.some((prefix) => entry.startsWith(prefix)) ||
    entry.endsWith(".DS_Store")
);
if (forbidden.length) {
  throw new Error(
    `Extension package contains development-only files: ${forbidden.sort().join(", ")}`
  );
}

console.log(
  `Verified ${archive}: ${files.size} files and ${required.size} runtime entry points.`
);
