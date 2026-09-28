/** Real Chromium IndexedDB checks on an isolated local origin; synthetic entries only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const source = await readFile(new URL("../ofac/storage.js", import.meta.url));
const server = createServer((req, res) => {
  if (req.url === "/storage.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" }).end(source);
  } else res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Isolated storage test</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await puppeteer.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    headless: true,
    args: ["--disable-background-networking"],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results = await page.evaluate(async () => {
    const storage = await import("/storage.js");
    const [first, second] = await Promise.all([storage.initDB(), storage.initDB()]);
    const entries = [{ uid: "synthetic-1", lastName: "FIXTURE ONE" }, { uid: "synthetic-2", lastName: "FIXTURE TWO" }];
    await storage.replaceSDNEntries(entries);
    await storage.saveSetting("fixture", { committed: true });
    const committed = await storage.getSetting("fixture");
    let invalidReplacementRejected = false;
    try { await storage.replaceSDNEntries([{ uid: "synthetic-new" }, { noKey: true }]); }
    catch { invalidReplacementRejected = true; }
    const afterFailure = await storage.getAllSDNEntries();
    const count = await storage.getSDNCount();
    const upgraded = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ComplianceCentralDB", 3);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Old connection blocked the upgrade"));
      request.onsuccess = () => { request.result.close(); resolve(true); };
    });
    // An old module must not keep handing out the now-closed v2 connection.
    let oldVersionRejected = false;
    try { await storage.initDB(); } catch { oldVersionRejected = true; }
    return { sameConnection: first === second, committed, invalidReplacementRejected, afterFailure, count, upgraded, oldVersionRejected };
  });
  assert.deepEqual(results, {
    sameConnection: true,
    committed: { committed: true },
    invalidReplacementRejected: true,
    afterFailure: [{ uid: "synthetic-1", lastName: "FIXTURE ONE" }, { uid: "synthetic-2", lastName: "FIXTURE TWO" }],
    count: 2,
    upgraded: true,
    oldVersionRejected: true,
  });
  console.log("PASS: real IndexedDB single-flight, committed settings, atomic rollback, and version-change release");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
