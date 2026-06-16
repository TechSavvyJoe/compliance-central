/**
 * AAMVA PDF417 driver's-license / state-ID parser (client-side, no DOM).
 *
 * Returns the fields Compliance Central needs plus the issuing jurisdiction so
 * the extension can decide which checks a subject is eligible for (OFAC = any
 * state; Michigan Repeat Offender = Michigan-issued only).
 *
 * The barcode text is a header ("ANSI" + 6-digit Issuer ID Number + versions +
 * subfile directory) followed by a subfile whose elements are LF-separated,
 * each a 3-letter code immediately followed by its value.
 */

const MICHIGAN_IIN = "636032";

// IIN → USPS state, used only to label the jurisdiction when the card omits the
// address-state element (DAJ). Not exhaustive; DAJ is preferred when present.
const IIN_TO_STATE = {
  "636032": "MI",
  "636023": "OH",
};

// Read a single AAMVA element's value: the first occurrence of the 3-letter
// code, up to the next CR/LF. Codes are unique 3-letter tokens and do not occur
// in the numeric header, so an unanchored first-match is safe and avoids the
// "DL"/"ID" subfile prefix that is glued to the first element.
function readElement(text, code) {
  const m = text.match(new RegExp(code + "([^\\r\\n]*)"));
  return m ? m[1].trim() : "";
}

// AAMVA US date of birth is MMDDCCYY (e.g. 08081985 -> 1985-08-08).
function normalizeDob(raw) {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(4, 8)}-${raw.slice(0, 2)}-${raw.slice(2, 4)}`;
  }
  return raw;
}

export function parseAAMVA(text) {
  if (typeof text !== "string" || !text.includes("ANSI")) return null;

  const iinMatch = text.match(/ANSI\s?(\d{6})/);
  const iin = iinMatch ? iinMatch[1] : "";

  const middleRaw = readElement(text, "DAD");
  const daj = readElement(text, "DAJ");

  return {
    firstName: readElement(text, "DAC"),
    middleName: middleRaw === "NONE" ? "" : middleRaw,
    lastName: readElement(text, "DCS"),
    suffix: readElement(text, "DCU"),
    dob: normalizeDob(readElement(text, "DBB")),
    dlnPid: readElement(text, "DAQ"),
    iin,
    jurisdiction: (daj || IIN_TO_STATE[iin] || "").toUpperCase(),
    isMichigan: iin === MICHIGAN_IIN,
  };
}
