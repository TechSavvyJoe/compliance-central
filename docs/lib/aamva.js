/**
 * AAMVA PDF417 driver's-license / state-ID parser (client-side, no DOM).
 *
 * Returns the fields Compliance Central needs plus the issuing jurisdiction so
 * the extension can decide which checks a subject is eligible for (OFAC = any
 * state; Michigan Repeat Offender = Michigan-issued only).
 *
 * The barcode text is a header ("ANSI" + 6-digit Issuer ID Number + versions +
 * subfile directory) followed by a subfile whose elements are LF-separated,
 * each a 3-letter code immediately followed by its value. We parse element-by-
 * element (anchored to element starts) rather than searching codes anywhere, so
 * a code sequence inside another field's value (e.g. last name "DaCosta" -> DAC)
 * can't be mistaken for an element.
 */

const MICHIGAN_IIN = "636032";

// IIN → USPS state, used only to label the jurisdiction when the card omits the
// address-state element (DAJ). Not exhaustive; DAJ is preferred when present.
const IIN_TO_STATE = {
  "636032": "MI",
  "636023": "OH",
};

/**
 * Decoder implementations do not agree on how AAMVA control separators are
 * represented. Canonicalize those separators without changing field content.
 */
export function normalizeAamvaText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/[\x01-\x09\x0b\x0c\x0e-\x1f]+/g, "\n")
    .replace(/\r\n?/g, "\n");
}

// Split the payload into a { CODE: value } map. Elements are LF/CR-separated;
// each begins with a 3-letter code. The first element of a subfile is prefixed
// by the 2-char subfile type ("DL"/"ID"), which we strip.
function parseElements(text) {
  const map = {};
  for (const segRaw of normalizeAamvaText(text).split(/\n+/)) {
    let seg = segRaw.trim();
    if (!seg) continue;

    // Some real AAMVA cards place the first DL/ID element immediately after
    // the subfile directory with no newline, for example
    // `ANSI ... DL00410279DLDAQ...`. The directory entry is followed by
    // digits, while the actual subfile prefix is followed by a 3-letter field
    // code, so this extracts the field boundary without scanning field values.
    if (/^ANSI\b/.test(seg)) {
      const subfile = seg.match(/(?:DL|ID)(?=[A-Z]{3})/);
      if (!subfile || subfile.index == null) continue;
      seg = seg.slice(subfile.index);
    }
    let m = seg.match(/^(?:DL|ID)([A-Z]{3})(.*)$/); // first element w/ subfile prefix
    if (!m) m = seg.match(/^([A-Z]{3})(.*)$/);
    if (!m) continue;
    const code = m[1];
    if (!(code in map)) map[code] = m[2].trim();
  }
  return map;
}

function splitGiven(given) {
  const parts = String(given).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", middle: "" };
  if (parts.length === 1) return { first: parts[0], middle: "" };
  return { first: parts[0], middle: parts.slice(1).join(" ") };
}

function cleanMiddle(m) {
  const v = String(m || "").trim();
  return v.toUpperCase() === "NONE" ? "" : v;
}

// First/middle/last with fallbacks across AAMVA versions:
// - DAC/DAD/DCS (current standard)
// - DCT carries combined given names ("FIRST MIDDLE") on older cards
// - DAA carries the full name ("LAST,FIRST,MIDDLE" or "LAST FIRST MIDDLE")
function extractNames(map) {
  let first = (map.DAC || "").trim();
  let middle = cleanMiddle(map.DAD);
  let last = (map.DCS || "").trim();

  if (!first && map.DCT) {
    const g = splitGiven(map.DCT);
    first = g.first;
    if (!middle) middle = g.middle;
  }

  if ((!last || !first) && map.DAA) {
    let parts = map.DAA.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) parts = map.DAA.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      if (!last) last = parts[0];
      if (!first) {
        const g = splitGiven(parts.slice(1).join(" "));
        first = g.first;
        if (!middle) middle = g.middle;
      }
    }
  }

  return { firstName: first, middleName: cleanMiddle(middle), lastName: last };
}

// AAMVA US date of birth is MMDDCCYY (e.g. 08081985 -> 08/08/1985). Canadian
// jurisdictions use CCYYMMDD; detect that when the first 4 digits are a year.
function parseDob(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length !== 8) return String(raw || "").trim();
  const first4 = parseInt(d.slice(0, 4), 10);
  if (first4 >= 1900 && first4 <= 2100) {
    return `${d.slice(4, 6)}/${d.slice(6, 8)}/${d.slice(0, 4)}`; // CCYYMMDD
  }
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}`; // MMDDCCYY
}

/**
 * True when raw barcode text is worth attempting an AAMVA parse.
 * Used by the camera loop to reject pairing-QR URLs, empty frames, and other
 * non-license payloads without stopping the camera.
 */
export function looksLikeAamva(text) {
  if (typeof text !== "string") return false;
  const t = normalizeAamvaText(text).trim();
  if (t.length < 40) return false;
  // Pairing QR / plain URLs must never be treated as a license.
  if (/^https?:\/\//i.test(t)) return false;
  return /ANSI\s*\d{6}/.test(t);
}

/**
 * Prefer the longest AAMVA-looking symbol when a decoder sees more than one
 * barcode. This prevents the neighboring 1D symbol (or short partial output)
 * from winning merely because it was returned first.
 */
export function rankDecodedPayloads(payloads) {
  const seen = new Set();
  return (Array.isArray(payloads) ? payloads : [])
    .filter((payload) => typeof payload === "string" && looksLikeAamva(payload))
    .map((payload) => normalizeAamvaText(payload))
    .filter((payload) => {
      if (seen.has(payload)) return false;
      seen.add(payload);
      return true;
    })
    .sort((a, b) => b.length - a.length);
}

export function selectBestDecodedPayload(payloads) {
  return rankDecodedPayloads(payloads)[0] || "";
}

function hasValidDob(dob) {
  const match = String(dob || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1900 &&
    year <= new Date().getUTCFullYear() &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Parse and require the identity fields needed by Compliance Central. A DAQ
 * alone is not enough: partial PDF417 reads commonly contain a valid header
 * and license number while dropping a name or DOB element.
 */
export function acceptLicenseScan(raw) {
  if (!looksLikeAamva(raw)) return null;
  const parsed = parseAAMVA(raw);
  if (
    !parsed ||
    !parsed.dlnPid ||
    !parsed.firstName ||
    !parsed.lastName ||
    !hasValidDob(parsed.dob)
  ) {
    return null;
  }
  return parsed;
}

/**
 * Camera-loop gate: classify a detector hit without touching the DOM.
 * @returns {{ ok: true, person: object, raw: string } | { ok: false, reason: string }}
 */
export function evaluateDetection(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, reason: "empty" };
  }
  if (!looksLikeAamva(raw)) {
    return { ok: false, reason: "not-aamva" };
  }
  const person = acceptLicenseScan(raw);
  if (!person) {
    return { ok: false, reason: "incomplete" };
  }
  return { ok: true, person, raw: normalizeAamvaText(raw) };
}

export function parseAAMVA(text) {
  const normalized = normalizeAamvaText(text);
  if (!normalized.includes("ANSI")) return null;

  const map = parseElements(normalized);
  const iinMatch = normalized.match(/ANSI\s*(\d{6})/);
  const iin = iinMatch ? iinMatch[1] : "";
  const { firstName, middleName, lastName } = extractNames(map);

  return {
    firstName,
    middleName,
    lastName,
    suffix: (map.DCU || "").trim(),
    dob: parseDob(map.DBB),
    dlnPid: (map.DAQ || "").trim(),
    iin,
    jurisdiction: (map.DAJ || IIN_TO_STATE[iin] || "").toUpperCase(),
    isMichigan: iin === MICHIGAN_IIN,
  };
}

// Privacy-safe diagnostic: the element codes present (no values), so a real
// card's structure can be confirmed without exposing the holder's PII.
export function aamvaElementCodes(text) {
  if (typeof text !== "string") return [];
  return Object.keys(parseElements(text)).filter((c) => c !== "ANS");
}
