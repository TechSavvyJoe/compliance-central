import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAAMVA,
  aamvaElementCodes,
  looksLikeAamva,
  acceptLicenseScan,
  evaluateDetection,
  normalizeAamvaText,
} from "../docs/lib/aamva.js";

// Realistic AAMVA PDF417 payloads. Elements are LF-separated; the data segment
// starts with the 2-char subfile type ("DL"/"ID"). DOB element DBB is MMDDCCYY.
// Real cards interleave truncation indicators (DDE/DDF/DDG). Michigan IIN = 636032.
const MI_DL =
  "@\n\rANSI 636032100002DL00410234\nDLDAQS123456789012\nDCSGALLANT\nDDEN\nDACJOSEPH\nDDFN\nDADJOHN\nDDGN\nDCUJR\nDBB08081985\nDAJMI\n\r";

const MI_ID =
  "@\n\rANSI 636032100002ID00410200\nIDDAQI987654321000\nDCSDOE\nDACJANE\nDADMARIE\nDBB03221990\nDAJMI\n\r";

const OH_DL =
  "@\n\rANSI 636023100002DL00410234\nDLDAQOH1234567\nDCSSMITH\nDACJOHN\nDADLEE\nDBB12151978\nDAJOH\n\r";

// Last name that itself starts with the letters "DAC" — must NOT be mistaken
// for the first-name element.
const MI_DACOSTA =
  "@\n\rANSI 636032100002DL00410234\nDLDAQD1\nDCSDACOSTA\nDACMARIA\nDADELENA\nDBB01021990\nDAJMI\n\r";

// Older encoding: given names combined in DCT, no DAC/DAD.
const MI_DCT =
  "@\n\rANSI 636032100002DL00410234\nDLDAQD2\nDCSSMITH\nDCTJOHN ROBERT\nDBB05101975\nDAJMI\n\r";

// Combined full name in DAA, no DCS/DAC/DAD.
const MI_DAA =
  "@\n\rANSI 636032100002DL00410234\nDLDAQD3\nDAAPUBLIC,JOHN,QUINCY\nDBB07041970\nDAJMI\n\r";

test("Michigan DL: full name + MM/DD/YYYY DOB, isMichigan true", () => {
  const r = parseAAMVA(MI_DL);
  assert.equal(r.firstName, "JOSEPH");
  assert.equal(r.middleName, "JOHN");
  assert.equal(r.lastName, "GALLANT");
  assert.equal(r.suffix, "JR");
  assert.equal(r.dob, "08/08/1985");
  assert.equal(r.dlnPid, "S123456789012");
  assert.equal(r.iin, "636032");
  assert.equal(r.jurisdiction, "MI");
  assert.equal(r.isMichigan, true);
});

test("Michigan State ID parses, isMichigan true", () => {
  const r = parseAAMVA(MI_ID);
  assert.equal(r.firstName, "JANE");
  assert.equal(r.middleName, "MARIE");
  assert.equal(r.lastName, "DOE");
  assert.equal(r.dob, "03/22/1990");
  assert.equal(r.dlnPid, "I987654321000");
  assert.equal(r.isMichigan, true);
});

test("out-of-state license: parses, isMichigan false", () => {
  const r = parseAAMVA(OH_DL);
  assert.equal(r.firstName, "JOHN");
  assert.equal(r.lastName, "SMITH");
  assert.equal(r.dob, "12/15/1978");
  assert.equal(r.jurisdiction, "OH");
  assert.equal(r.isMichigan, false);
});

test("last name beginning with 'DAC' is not mistaken for first name", () => {
  const r = parseAAMVA(MI_DACOSTA);
  assert.equal(r.lastName, "DACOSTA");
  assert.equal(r.firstName, "MARIA");
  assert.equal(r.middleName, "ELENA");
  assert.equal(r.dob, "01/02/1990");
});

test("DCT combined given-names fallback (no DAC/DAD)", () => {
  const r = parseAAMVA(MI_DCT);
  assert.equal(r.firstName, "JOHN");
  assert.equal(r.middleName, "ROBERT");
  assert.equal(r.lastName, "SMITH");
});

test("DAA combined full-name fallback (no DCS/DAC/DAD)", () => {
  const r = parseAAMVA(MI_DAA);
  assert.equal(r.lastName, "PUBLIC");
  assert.equal(r.firstName, "JOHN");
  assert.equal(r.middleName, "QUINCY");
});

// Faithful REAL Michigan layout (confirmed on-device 2026-06-16): last name in
// DCS, given names COMBINED in DCT, NO DAC/DAD, DLN spaced, plus other codes a
// Michigan card carries. Synthetic values (not a real person's PII).
const MI_REAL_LAYOUT =
  "@\n\rANSI 636032100102DL00410279ZM03200008\n" +
  "DLDCBNONE\nDCDNONE\nDBA08152030\nDCSSAMPLE\nDDEN\nDCTPAT ALEX\nDDFN\n" +
  "DBD08152022\nDBB08081985\nDBCM\nDAG123 MAIN ST\nDAILANSING\nDAJMI\n" +
  "DAK488010000\nDAQS 123 456 789 012\nDCGUSA\nDCK00000\nZMZMI\n\r";

test("real Michigan layout: DCS + combined DCT given names, no DAC/DAD", () => {
  const r = parseAAMVA(MI_REAL_LAYOUT);
  assert.equal(r.firstName, "PAT");
  assert.equal(r.middleName, "ALEX");
  assert.equal(r.lastName, "SAMPLE");
  assert.equal(r.dob, "08/08/1985");
  assert.equal(r.dlnPid, "S 123 456 789 012");
  assert.equal(r.isMichigan, true);
  const codes = aamvaElementCodes(MI_REAL_LAYOUT);
  assert.ok(codes.includes("DCS") && codes.includes("DCT"));
  assert.ok(!codes.includes("DAC") && !codes.includes("DAD"));
});

test("aamvaElementCodes lists element codes present (no header noise)", () => {
  const codes = aamvaElementCodes(MI_DL);
  assert.ok(codes.includes("DCS"));
  assert.ok(codes.includes("DAC"));
  assert.ok(codes.includes("DAD"));
  assert.ok(codes.includes("DBB"));
  assert.ok(!codes.includes("ANS"));
});

test("returns null for non-AAMVA text", () => {
  assert.equal(parseAAMVA("not a license"), null);
  assert.equal(parseAAMVA(""), null);
  assert.equal(parseAAMVA(null), null);
});

test("looksLikeAamva rejects pairing QR URLs and short junk", () => {
  assert.equal(looksLikeAamva("https://techsavvyjoe.github.io/compliance-central/scan.html?s=abc"), false);
  assert.equal(looksLikeAamva("ANSI"), false);
  assert.equal(looksLikeAamva(MI_DL), true);
  assert.equal(looksLikeAamva(MI_REAL_LAYOUT), true);
});

test("acceptLicenseScan requires DAQ, first and last name, and valid DOB", () => {
  const ok = acceptLicenseScan(MI_DL);
  assert.equal(ok.dlnPid, "S123456789012");
  // ANSI header present but no DAQ element — partial PDF417 read
  const partial =
    "@\n\rANSI 636032100102DL00410279ZM03200008\nDLDCSAMPLE\nDCTPAT\nDBB08081985\nDAJMI\n\r";
  assert.equal(acceptLicenseScan(partial), null);
  assert.equal(
    acceptLicenseScan(
      "@\n\rANSI 636032100102DL00410279\nDLDAQS123\nDCSSAMPLE\nDBB08081985\nDAJMI\n\r"
    ),
    null
  );
  assert.equal(
    acceptLicenseScan(
      "@\n\rANSI 636032100102DL00410279\nDLDAQS123\nDCSSAMPLE\nDCTPAT\nDBB13321985\nDAJMI\n\r"
    ),
    null
  );
  assert.equal(acceptLicenseScan("https://example.com/pair"), null);
});

test("evaluateDetection mode guard: ignore QR, accept MI DL, reject incomplete", () => {
  const qr = evaluateDetection(
    "https://techsavvyjoe.github.io/compliance-central/scan.html?s=sess#k=key"
  );
  assert.equal(qr.ok, false);
  assert.equal(qr.reason, "not-aamva");

  const good = evaluateDetection(MI_REAL_LAYOUT);
  assert.equal(good.ok, true);
  assert.equal(good.person.firstName, "PAT");
  assert.equal(good.person.isMichigan, true);

  const incomplete = evaluateDetection(
    "@\n\rANSI 636032100102DL00410279ZM03200008\nDLDCSAMPLE\nDCTPAT\nDBB08081985\nDAJMI\n\r"
  );
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.reason, "incomplete");

  assert.equal(evaluateDetection("").ok, false);
  assert.equal(evaluateDetection("").reason, "empty");
});

test("malformed ANSI header and separator-delimited payload handling", () => {
  assert.equal(looksLikeAamva("ANSI XXXXXX\nDLDAQS123\nDCSSAMPLE\nDCTPAT\nDBB08081985"), false);
  const separated = MI_DL.replace(/\n/g, "\x1e");
  const result = acceptLicenseScan(separated);
  assert.equal(result.dlnPid, "S123456789012");
  assert.equal(result.isMichigan, true);
});

test("normalizes scanner BOM, NUL, and AAMVA control separators", () => {
  const noisy = `\uFEFF\u0000${MI_DL.replace(/\n/g, "\x1c")}`;
  const normalized = normalizeAamvaText(noisy);
  assert.ok(!normalized.includes("\uFEFF"));
  assert.ok(!normalized.includes("\u0000"));
  assert.equal(acceptLicenseScan(noisy).dlnPid, "S123456789012");
});

test("accepts extra whitespace between ANSI and issuer ID", () => {
  const spaced = MI_DL.replace("ANSI 636032", "ANSI \t 636032");
  assert.equal(looksLikeAamva(spaced), true);
  assert.equal(acceptLicenseScan(spaced).isMichigan, true);
});
