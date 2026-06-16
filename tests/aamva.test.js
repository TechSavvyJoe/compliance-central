import test from "node:test";
import assert from "node:assert/strict";
import { parseAAMVA } from "../docs/lib/aamva.js";

// Minimal but realistic AAMVA PDF417 payloads. Element separator is LF; the
// data segment starts with the 2-char subfile type ("DL"/"ID") then elements.
// DOB element DBB is MMDDCCYY. Michigan Issuer ID Number (IIN) = 636032.
const MI_DL =
  "@\n\rANSI 636032100002DL00410234\nDLDAQS123456789012\nDCSGALLANT\nDACJOSEPH\nDADJOHN\nDCUJR\nDBB08081985\nDAJMI\n\r";

const MI_ID =
  "@\n\rANSI 636032100002ID00410200\nIDDAQI987654321000\nDCSDOE\nDACJANE\nDADMARIE\nDBB03221990\nDAJMI\n\r";

const OH_DL =
  "@\n\rANSI 636023100002DL00410234\nDLDAQOH1234567\nDCSSMITH\nDACJOHN\nDADLEE\nDBB12151978\nDAJOH\n\r";

test("parses a Michigan driver's license, isMichigan true", () => {
  const r = parseAAMVA(MI_DL);
  assert.equal(r.firstName, "JOSEPH");
  assert.equal(r.middleName, "JOHN");
  assert.equal(r.lastName, "GALLANT");
  assert.equal(r.suffix, "JR");
  assert.equal(r.dob, "1985-08-08");
  assert.equal(r.dlnPid, "S123456789012");
  assert.equal(r.iin, "636032");
  assert.equal(r.jurisdiction, "MI");
  assert.equal(r.isMichigan, true);
});

test("parses a Michigan state ID, isMichigan true", () => {
  const r = parseAAMVA(MI_ID);
  assert.equal(r.lastName, "DOE");
  assert.equal(r.firstName, "JANE");
  assert.equal(r.middleName, "MARIE");
  assert.equal(r.dob, "1990-03-22");
  assert.equal(r.dlnPid, "I987654321000");
  assert.equal(r.isMichigan, true);
});

test("parses an out-of-state license, isMichigan false", () => {
  const r = parseAAMVA(OH_DL);
  assert.equal(r.lastName, "SMITH");
  assert.equal(r.firstName, "JOHN");
  assert.equal(r.dob, "1978-12-15");
  assert.equal(r.jurisdiction, "OH");
  assert.equal(r.isMichigan, false);
});

test("returns null for non-AAMVA text", () => {
  assert.equal(parseAAMVA("not a license"), null);
  assert.equal(parseAAMVA(""), null);
  assert.equal(parseAAMVA(null), null);
});
