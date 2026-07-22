import assert from "node:assert/strict";
import test from "node:test";

import {
  collectCustomerValidationErrors,
  validateField,
} from "../src/sidepanel/form.js";

function dobYearsAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

test("DOB in the future is rejected", () => {
  const r = validateField("dob", "01/01/2999", "Date of Birth");
  assert.equal(r.valid, false);
  assert.match(r.error, /future/i);
});

test("DOB under the minimum age is rejected", () => {
  const r = validateField("dob", dobYearsAgo(5), "Date of Birth");
  assert.equal(r.valid, false);
  assert.match(r.error, /at least/i);
});

test("DOB over the maximum age is rejected", () => {
  const r = validateField("dob", "01/01/1850", "Date of Birth");
  assert.equal(r.valid, false);
});

test("a normal adult DOB is accepted in both US and ISO formats", () => {
  assert.equal(validateField("dob", dobYearsAgo(40), "Date of Birth").valid, true);
  assert.equal(validateField("dob", "1985-06-15", "Date of Birth").valid, true);
});

test("an impossible calendar date is rejected", () => {
  const r = validateField("dob", "02/31/1990", "Date of Birth");
  assert.equal(r.valid, false);
});

test("a four-digit year is validated literally instead of being remapped by Date", () => {
  const r = validateField("dob", "01/01/0099", "Date of Birth");
  assert.equal(r.valid, false);
});

test("DLN/PID accepts valid forms and rejects malformed ones", () => {
  assert.equal(validateField("dlnPid", "S123456789012", "DLN/PID").valid, true);
  assert.equal(validateField("dlnPid", "123456789", "DLN/PID").valid, true);
  assert.equal(validateField("dlnPid", "12345", "DLN/PID").valid, false);
});

test("an explicitly out-of-state scan accepts a conservative alphanumeric DLN", () => {
  assert.equal(
    validateField("dlnPid", "OH1234567", "DLN/PID", true, {
      isMichigan: false,
    }).valid,
    true
  );
  assert.equal(
    validateField("dlnPid", "OH-123", "DLN/PID", true, {
      isMichigan: false,
    }).valid,
    false
  );
});

test("Michigan and unknown/manual entries keep strict Michigan DLN validation", () => {
  assert.equal(
    validateField("dlnPid", "OH1234567", "DLN/PID", true, {
      isMichigan: true,
    }).valid,
    false
  );
  assert.equal(
    validateField("dlnPid", "OH1234567", "DLN/PID").valid,
    false
  );
});

test("VIN rejects I/O/Q and wrong length, accepts a valid 17-char VIN", () => {
  assert.equal(validateField("tradeVin", "1HGBH41JXMN109186", "VIN", false).valid, true);
  assert.equal(validateField("tradeVin", "1HGBH41JXMN10918I", "VIN", false).valid, false);
  assert.equal(validateField("tradeVin", "1HGBH41JXMN10918", "VIN", false).valid, false);
});

test("optional empty fields pass; required empty fields fail", () => {
  assert.equal(validateField("tradeVin", "", "VIN", false).valid, true);
  assert.equal(validateField("firstName", "", "First Name", true).valid, false);
});

test("customer validation issues identify the fields the UI must highlight", () => {
  const issues = collectCustomerValidationErrors({
    firstName: "",
    middleName: "A".repeat(101),
    lastName: "",
    dob: "02/31/1990",
    dlnPid: "123",
    tradeVin: "",
    hasCoBuyer: true,
    coBuyer: {
      firstName: "",
      middleName: "",
      lastName: "Doe",
      dob: dobYearsAgo(40),
      dlnPid: "S123456789012",
    },
  });

  assert.deepEqual(
    issues.map((issue) => issue.fieldId),
    ["firstName", "middleName", "lastName", "dob", "dlnPid", "cbFirstName"]
  );
});

test("an out-of-state scanned buyer reaches checks without weakening other fields", () => {
  const issues = collectCustomerValidationErrors({
    firstName: "JOHN",
    middleName: "LEE",
    lastName: "SMITH",
    dob: "12/15/1978",
    dlnPid: "OH1234567",
    buyerIsMichigan: false,
    tradeVin: "",
    hasCoBuyer: false,
  });

  assert.deepEqual(issues, []);
});
