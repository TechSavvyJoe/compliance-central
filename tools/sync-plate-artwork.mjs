/** Refresh exact public SOS artwork; no customer records or calculator session.
 * Run manually when the state's gallery changes. Images stay byte-for-byte
 * original, with origin URLs and SHA-256 retained in the packaged manifest.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { SOS_PLATE_DESIGNS, SOS_PLATE_SOURCE_PAGES } from "../src/sidepanel/sos-plate-catalog.js";

const directory = new URL("../assets/plates/", import.meta.url);
const stem = (url) => new URL(url).pathname.split("/").at(-1).replace(/\.(?:png|jpe?g|webp)$/i, "").toLowerCase();
const images = new Map();
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
  headless: true,
});
async function request(url) {
  // The public site expects browser navigation. Plain Node/curl requests can
  // be rejected by its CDN even while the public gallery works in Chrome.
  const page = await browser.newPage();
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response.ok()) throw new Error(`HTTP ${response.status()}: ${url}`);
    const bytes = await response.buffer();
    return {
      headers: { get: (key) => response.headers()[key] },
      text: async () => bytes.toString("utf8"),
      arrayBuffer: async () => bytes,
    };
  } finally {
    await page.close();
  }
}
try {
await Promise.all(Object.entries(SOS_PLATE_SOURCE_PAGES).filter(([key]) => key !== "industry").map(async ([, pageUrl]) => {
  const html = await (await request(pageUrl)).text();
  for (const match of html.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
    if (!match[1].includes("/License-plate-images/")) continue;
    const url = new URL(match[1].replaceAll("&amp;", "&"), pageUrl);
    if (url.origin !== "https://www.michigan.gov") throw new Error("Unexpected artwork origin");
    images.set(stem(url), { url: url.href, sourcePage: pageUrl });
  }
  console.log(`Discovered official artwork from ${pageUrl}`);
}));
const wanted = new Map();
for (const design of Object.values(SOS_PLATE_DESIGNS)) {
  const key = stem(design.imageUrl);
  if (!images.has(key) && /^https:\/\/dsvsesvc\.sos\.state\.mi\.us\/TAP\/Image\/ENG\/[A-Za-z0-9._-]+$/.test(design.imageUrl)) {
    images.set(key, { url: design.imageUrl, sourcePage: design.sourceUrl });
  }
  if (!images.has(key)) throw new Error(`No exact official artwork match for ${design.value}: ${key}`);
  const record = wanted.get(key) || { ...images.get(key), designs: [] };
  record.designs.push(design.value);
  wanted.set(key, record);
}
await mkdir(directory, { recursive: true });
const records = [...wanted.entries()];
let cursor = 0;
const manifest = {};
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < records.length) {
    const [key, item] = records[cursor++];
    const response = await request(item.url);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error(`Invalid artwork type ${contentType} for ${key}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100 || bytes.length > 8 * 1024 * 1024) throw new Error(`Invalid image size for ${key}`);
    const extension = bytes[0] === 255 && bytes[1] === 216 ? "jpg"
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
    if (!extension) throw new Error(`Invalid artwork signature for ${key}: ${bytes.subarray(0, 20).toString("hex")}`);
    const path = `${key}.${extension}`;
    await writeFile(new URL(path, directory), bytes);
    manifest[key] = { path: `assets/plates/${path}`, ...item, contentType, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    console.log(`Verified ${path}: ${bytes.length} bytes`);
  }
}));
const ordered = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL("provenance.json", directory), JSON.stringify({ source: "Michigan Secretary of State public license-plate galleries", retrievedAt: new Date().toISOString(), images: ordered }, null, 2) + "\n");
const table = Object.fromEntries(Object.entries(ordered).map(([key, item]) => [key, { path: item.path, url: item.url }]));
await writeFile(new URL("../src/sidepanel/sos-plate-artwork.js", import.meta.url),
  "/** Verified official artwork bundled for offline previews. See assets/plates/provenance.json. */\n" +
  "export const SOS_BUNDLED_PLATE_ARTWORK = Object.freeze(" + JSON.stringify(table, null, 2) + ");\n");
console.log(`Packaged ${records.length} exact official images for ${Object.keys(SOS_PLATE_DESIGNS).length} catalog designs in ${fileURLToPath(directory)}`);
} finally {
  await browser.close();
}
