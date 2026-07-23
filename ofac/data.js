/**
 * Official U.S. Treasury / OFAC SDN data fetcher and parser.
 *
 * OFAC's legacy SDN.XML contains the complete SDN list, including primary
 * names, aliases, programs, dates of birth, and country. The file is parsed
 * locally in the extension service worker; no subject data is sent to Treasury.
 * Only fields used by screening or result display are retained in IndexedDB.
 */

import { CONFIG } from "../lib/config.js";

const SDN_XML_URL = CONFIG.ofac.sdnDataUrl;
const SDN_FETCH_TIMEOUT_MS = 60000;
const MAX_SDN_XML_BYTES = 64 * 1024 * 1024;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

function assertAllowedHost(finalUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(finalUrl);
  } catch {
    throw new Error("SDN download redirected to an invalid URL.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("SDN download blocked: HTTPS is required.");
  }

  const allowed = CONFIG.ofac.allowedHosts || [];
  if (!allowed.includes(parsedUrl.hostname)) {
    throw new Error(
      `SDN download blocked: unexpected host "${parsedUrl.hostname}".`
    );
  }
}

async function readTextWithLimit(response) {
  const contentLength = Number(response.headers?.get?.("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SDN_XML_BYTES) {
    throw new Error("SDN download is unexpectedly large.");
  }

  // response.text() lets the browser decode into one backing string. Building
  // an array of decoded stream chunks and joining it nearly doubles peak memory
  // for this ~29 MB list, which is undesirable in a Manifest V3 worker.
  const text = await response.text();
  if (text.length > MAX_SDN_XML_BYTES) {
    throw new Error("SDN download is unexpectedly large.");
  }
  return text;
}

async function fetchSDNXML() {
  let response;
  try {
    response = await fetch(SDN_XML_URL, {
      method: "GET",
      headers: { Accept: "application/xml, text/xml;q=0.9, */*;q=0.1" },
      signal: AbortSignal.timeout(SDN_FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (err) {
    if (err?.name === "TimeoutError") {
      throw new Error("SDN download timed out. Check your internet connection.");
    }
    if (err?.name === "AbortError") {
      throw new Error("SDN download was cancelled.");
    }
    if (err instanceof TypeError) {
      throw new Error(
        "Could not reach the official OFAC data source. Check your internet connection."
      );
    }
    throw err;
  }

  assertAllowedHost(response.url || SDN_XML_URL);

  if (!response.ok) {
    throw new Error(`SDN download failed: HTTP ${response.status}`);
  }

  const contentType = response.headers?.get?.("Content-Type") || "";
  if (contentType && !/\b(?:application|text)\/xml\b/i.test(contentType)) {
    throw new Error(`SDN download returned unexpected content type "${contentType}".`);
  }

  return response;
}

function decodeXMLText(value) {
  const text = String(value || "").trim();
  return text.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi,
    (entity, decimal, hex, named) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      return {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      }[named.toLowerCase()];
    }
  );
}

function tagPattern(tagName, flags = "") {
  return new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}\\s*>`,
    flags
  );
}

function firstTagValue(xml, tagName) {
  const match = tagPattern(tagName).exec(xml);
  return match ? decodeXMLText(match[1]) : "";
}

function allTagValues(xml, tagName) {
  const values = [];
  const pattern = tagPattern(tagName, "g");
  let match;
  while ((match = pattern.exec(xml))) {
    const value = decodeXMLText(match[1]);
    if (value) values.push(value);
  }
  return values;
}

function allTagBlocks(xml, tagName) {
  const blocks = [];
  const pattern = tagPattern(tagName, "g");
  let match;
  while ((match = pattern.exec(xml))) blocks.push(match[1]);
  return blocks;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parsePublicationDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) {
    throw new Error("Unexpected SDN XML publication date.");
  }
  const [, monthText, dayText, yearText] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Unexpected SDN XML publication date.");
  }
  return date.toISOString();
}

function parseMetadata(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("Unexpected SDN XML declaration.");
  }
  if (!/<sdnList(?:\s[^>]*)?>/.test(xml)) {
    throw new Error("Unexpected SDN XML schema (missing sdnList root).");
  }

  const recordCountText = firstTagValue(xml, "Record_Count");
  if (!/^\d+$/.test(recordCountText) || Number(recordCountText) <= 0) {
    throw new Error("Unexpected SDN XML schema (invalid record count).");
  }
  return {
    expectedCount: Number(recordCountText),
    publishDate: parsePublicationDate(firstTagValue(xml, "Publish_Date")),
  };
}

function splitGivenNames(givenNames) {
  const parts = givenNames.split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || "",
    middleName: parts.join(" "),
  };
}

function joinName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function parseEntry(block, recordNumber) {
  const uid = firstTagValue(block, "uid");
  const givenNames = firstTagValue(block, "firstName");
  const lastName = firstTagValue(block, "lastName");
  const fullName = joinName(givenNames, lastName);

  if (!uid || !fullName) {
    throw new Error(`Unexpected SDN XML record ${recordNumber}: missing UID or name.`);
  }

  const aliases = [];
  for (const aliasBlock of allTagBlocks(block, "aka")) {
    const aliasFirstName = firstTagValue(aliasBlock, "firstName");
    const aliasLastName = firstTagValue(aliasBlock, "lastName");
    const name = joinName(aliasFirstName, aliasLastName);
    if (!name) continue;
    aliases.push(name);
  }

  const nationalityBlock = allTagBlocks(block, "nationalityList")[0] || "";
  const countries = unique([
    ...allTagValues(nationalityBlock, "country"),
    ...allTagBlocks(block, "address").map((address) =>
      firstTagValue(address, "country")
    ),
  ]);
  const { firstName, middleName } = splitGivenNames(givenNames);

  return {
    uid,
    firstName,
    middleName,
    lastName,
    fullName,
    type: firstTagValue(block, "sdnType") || "Entity",
    program: unique(allTagValues(block, "program")).join("; "),
    country: countries[0] || "",
    birthDate: unique(allTagValues(block, "dateOfBirth")).join("; "),
    aliases: unique(aliases),
  };
}

/**
 * Parse OFAC's documented legacy SDN XML format without DOMParser (which is
 * unavailable in Manifest V3 service workers).
 */
export function parseSDNXML(xmlText) {
  const xml = String(xmlText || "").replace(/^\uFEFF/, "");
  if (!xml.trim()) throw new Error("SDN download was empty.");
  if (!/<\/sdnList\s*>/.test(xml)) {
    throw new Error("Unexpected SDN XML schema (missing sdnList root).");
  }

  const { expectedCount, publishDate } = parseMetadata(xml);

  const entries = [];
  const uids = new Set();
  const entryPattern = tagPattern("sdnEntry", "g");
  let match;
  while ((match = entryPattern.exec(xml))) {
    const entry = parseEntry(match[1], entries.length + 1);
    if (uids.has(entry.uid)) {
      throw new Error(`Unexpected SDN XML: duplicate UID "${entry.uid}".`);
    }
    uids.add(entry.uid);
    entries.push(entry);
  }

  if (entries.length !== expectedCount) {
    throw new Error(
      `SDN XML record count mismatch: expected ${expectedCount}, parsed ${entries.length}.`
    );
  }

  return { entries, count: entries.length, publishDate };
}

async function parseSDNResponse(response) {
  if (!response.body?.getReader) {
    return parseSDNXML(await readTextWithLimit(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const entries = [];
  const uids = new Set();
  let buffer = "";
  let bytesRead = 0;
  let metadata = null;

  function consumeCompleteEntries() {
    while (true) {
      const open = /<sdnEntry(?:\s[^>]*)?>/.exec(buffer);
      if (!open) return;

      if (!metadata) {
        metadata = parseMetadata(buffer.slice(0, open.index));
      }

      const contentStart = open.index + open[0].length;
      const contentEnd = buffer.indexOf("</sdnEntry>", contentStart);
      if (contentEnd < 0) {
        // Discard only leading whitespace/metadata. Preserve the complete open
        // tag and partial record until its closing tag arrives.
        if (open.index > 0) buffer = buffer.slice(open.index);
        return;
      }

      const entry = parseEntry(
        buffer.slice(contentStart, contentEnd),
        entries.length + 1
      );
      if (uids.has(entry.uid)) {
        throw new Error(`Unexpected SDN XML: duplicate UID "${entry.uid}".`);
      }
      uids.add(entry.uid);
      entries.push(entry);
      buffer = buffer.slice(contentEnd + "</sdnEntry>".length);
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_SDN_XML_BYTES) {
        await reader.cancel();
        throw new Error("SDN download is unexpectedly large.");
      }
      buffer += decoder.decode(value, { stream: true });
      consumeCompleteEntries();

      // The metadata header is only a few hundred bytes. A large prefix with
      // no entry indicates an error page or a changed format; do not retain it.
      if (!metadata && buffer.length > 1024 * 1024) {
        throw new Error("Unexpected SDN XML schema (missing SDN entries).");
      }
    }
    buffer += decoder.decode();
    consumeCompleteEntries();
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock?.();
  }

  if (!metadata) {
    throw new Error("Unexpected SDN XML schema (missing SDN entries).");
  }
  if (!/<\/sdnList\s*>/.test(buffer)) {
    throw new Error("Unexpected SDN XML schema (missing sdnList root).");
  }
  if (/<sdnEntry(?:\s[^>]*)?>/.test(buffer)) {
    throw new Error("SDN XML record is truncated.");
  }
  if (entries.length !== metadata.expectedCount) {
    throw new Error(
      `SDN XML record count mismatch: expected ${metadata.expectedCount}, parsed ${entries.length}.`
    );
  }

  return { entries, count: entries.length, publishDate: metadata.publishDate };
}

export async function downloadAndParseSDN() {
  const response = await fetchSDNXML();
  const result = await parseSDNResponse(response);
  return {
    ...result,
    downloadedAt: new Date().toISOString(),
  };
}

export function needsUpdate(lastUpdate, now = Date.now()) {
  if (!lastUpdate) return true;
  const t = new Date(lastUpdate).getTime();
  // Fail safe: an unparseable/unknown timestamp means the age is unknown, so
  // treat it as needing a refresh rather than silently assuming it's fresh.
  if (Number.isNaN(t)) return true;

  // Allow a few minutes of harmless device-clock skew. A timestamp materially
  // in the future, however, could otherwise suppress refreshes indefinitely.
  if (t - now > MAX_FUTURE_CLOCK_SKEW_MS) return true;

  const hoursSince = (now - t) / 3600000;
  return hoursSince >= 24;
}

function parseCanonicalIsoTime(value) {
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return Number.NaN;
  return new Date(time).toISOString() === value ? time : Number.NaN;
}

/**
 * Refuse a feed whose publication date moves backwards (or becomes invalid)
 * once a valid publication date has been stored. This check must run before
 * replacing IndexedDB data so a stale/invalid download cannot overwrite the
 * last known-good SDN list and its timestamps.
 */
export function assertPublicationDateDoesNotRegress(
  previousPublishDate,
  incomingPublishDate
) {
  const previousTime = parseCanonicalIsoTime(previousPublishDate);
  if (Number.isNaN(previousTime)) return;

  const incomingTime = parseCanonicalIsoTime(incomingPublishDate);
  if (Number.isNaN(incomingTime)) {
    throw new Error(
      "SDN update rejected: the incoming publication date is invalid. Keeping the previous list."
    );
  }

  if (incomingTime < previousTime) {
    throw new Error(
      "SDN update rejected: the incoming publication date is older than the stored list. Keeping the previous list."
    );
  }
}
