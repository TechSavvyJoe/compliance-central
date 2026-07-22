import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CONFIG } from "../lib/config.js";
import { downloadAndParseSDN, parseSDNXML } from "../ofac/data.js";
import { searchSDNEntries } from "../ofac/search.js";

const fixtureUrl = new URL("./fixtures/ofac-sdn-sample.xml", import.meta.url);
const fixture = await readFile(fixtureUrl, "utf8");

function fakeXMLResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    url: CONFIG.ofac.sdnDataUrl,
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-type") return "text/xml";
        return null;
      },
    },
    text: async () => fixture,
    ...overrides,
  };
}

test("official OFAC XML parser emits the compact screening storage schema", () => {
  const result = parseSDNXML(fixture);
  assert.equal(result.count, 2);
  assert.equal(result.publishDate, "2026-07-17T00:00:00.000Z");

  const putin = result.entries.find((entry) => entry.uid === "35096");
  assert.deepEqual(Object.keys(putin).sort(), [
    "aliases",
    "birthDate",
    "country",
    "firstName",
    "fullName",
    "lastName",
    "middleName",
    "program",
    "type",
    "uid",
  ]);
  assert.equal(putin.fullName, "Vladimir Vladimirovich PUTIN");
  assert.equal(putin.firstName, "Vladimir");
  assert.equal(putin.middleName, "Vladimirovich");
  assert.equal(putin.lastName, "PUTIN");
  assert.equal(putin.birthDate, "07 Oct 1952");
  assert.deepEqual(putin.aliases, ["Vladimir PUTIN"]);
  assert.equal(putin.country, "Russia");

  const izzAlDin = result.entries.find((entry) => entry.uid === "6926");
  assert.deepEqual(izzAlDin.aliases, ["GARBAYA, AHMED"]);
  // This record has no nationality list, so display country still falls back
  // to the first address country without retaining the full address object.
  assert.equal(izzAlDin.country, "Lebanon");
  assert.equal(izzAlDin.birthDate, "1963; 01 Aug 1970");
  assert.equal(izzAlDin.program, "SDGT; HIFPAA");
});

test("compact parsed entries preserve primary and alias screening behavior", () => {
  const { entries } = parseSDNXML(fixture);
  const primary = searchSDNEntries(
    { firstName: "Vladimir", middleName: "Vladimirovich", lastName: "Putin" },
    entries
  );
  const alias = searchSDNEntries(
    { firstName: "Ahmed", middleName: "", lastName: "Garbaya" },
    entries
  );

  assert.equal(primary[0].entry.uid, "35096");
  assert.equal(alias[0].entry.uid, "6926");
  assert.equal(alias[0].matchedName, "GARBAYA, AHMED");
});

test("OFAC fetch rejects responses that redirect off the exact allowlist", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    fakeXMLResponse({ url: "https://evil.example/poison.xml" });

  try {
    await assert.rejects(() => downloadAndParseSDN(), /unexpected host/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OFAC fetch rejects an insecure redirect even for an allowlisted host", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    fakeXMLResponse({
      url: `http://${CONFIG.ofac.allowedHosts[0]}/poison.xml`,
    });

  try {
    await assert.rejects(() => downloadAndParseSDN(), /HTTPS is required/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OFAC fetch accepts Treasury SLS and its exact GovCloud redirect host", async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    const hostname = CONFIG.ofac.allowedHosts[call++];
    return fakeXMLResponse({ url: `https://${hostname}/SDN.XML` });
  };

  try {
    const official = await downloadAndParseSDN();
    const redirected = await downloadAndParseSDN();
    assert.equal(official.count, 2);
    assert.equal(redirected.count, 2);
    assert.equal(official.publishDate, "2026-07-17T00:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OFAC streaming parser handles XML tags split across network chunks", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new TextEncoder().encode(fixture);
  let offset = 0;
  const chunkSizes = [1, 7, 31, 3, 127, 11];
  let chunkIndex = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = chunkSizes[chunkIndex++ % chunkSizes.length];
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
  globalThis.fetch = async () =>
    new Response(body, { headers: { "Content-Type": "text/xml" } });

  try {
    const result = await downloadAndParseSDN();
    assert.equal(result.count, 2);
    assert.equal(result.entries[1].fullName, "Hasan IZZ-AL-DIN");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OFAC parser rejects changed or incomplete XML instead of mis-screening", () => {
  assert.throws(
    () => parseSDNXML("<html><body>maintenance</body></html>"),
    /missing sdnList root/i
  );
  assert.throws(
    () => parseSDNXML(fixture.replace("<Record_Count>2", "<Record_Count>3")),
    /record count mismatch/i
  );
  assert.throws(
    () => parseSDNXML(fixture.replace("</sdnList>", "")),
    /missing sdnList root/i
  );
});

test("OFAC parser rejects DTD/entity declarations", () => {
  const withDoctype = fixture.replace(
    '<?xml version="1.0" standalone="yes"?>',
    '<?xml version="1.0"?><!DOCTYPE sdnList [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
  );
  assert.throws(() => parseSDNXML(withDoctype), /unexpected SDN XML declaration/i);
});

test("OFAC fetch rejects a non-XML response from an allowed host", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    fakeXMLResponse({
      headers: { get: () => "text/html" },
      text: async () => "<html>maintenance</html>",
    });

  try {
    await assert.rejects(() => downloadAndParseSDN(), /content type/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
