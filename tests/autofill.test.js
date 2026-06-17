import assert from "node:assert/strict";
import test from "node:test";

import { applyCustomerData } from "../src/sidepanel/form.js";

// Minimal stand-ins for the form inputs applyCustomerData touches. setDateInputValue
// (from date-picker.js) only sets .value/.dataset on inputs it doesn't own, and
// hasCoBuyer.dispatchEvent fires the show/hide handler — a no-op here.
function field() {
  return { value: "", dataset: {} };
}
function makeElements() {
  return {
    firstName: field(),
    middleName: field(),
    lastName: field(),
    suffix: field(),
    dob: field(),
    dlnPid: field(),
    tradeVin: field(),
    hasCoBuyer: { checked: false, dispatchEvent() {} },
    cbFirstName: field(),
    cbMiddleName: field(),
    cbLastName: field(),
    cbSuffix: field(),
    cbDob: field(),
    cbDlnPid: field(),
  };
}

test("applyCustomerData fills buyer fields and strips DLN spaces", () => {
  const els = makeElements();
  applyCustomerData(els, {
    firstName: "Wendy",
    lastName: "Upcott",
    dob: "08/18/1969",
    dlnPid: "U 123 456 789 012",
    tradeVin: "1HGBH41JXMN109186",
  });
  assert.equal(els.firstName.value, "Wendy");
  assert.equal(els.lastName.value, "Upcott");
  assert.equal(els.dlnPid.value, "U123456789012"); // spaces stripped
  assert.equal(els.tradeVin.value, "1HGBH41JXMN109186");
});

test("applyCustomerData fills the co-buyer and checks the box when present", () => {
  const els = makeElements();
  applyCustomerData(els, {
    firstName: "Wendy",
    lastName: "Upcott",
    dlnPid: "",
    coBuyer: { firstName: "John", lastName: "Upcott", dlnPid: "S 987 654 321 000" },
  });
  assert.equal(els.hasCoBuyer.checked, true);
  assert.equal(els.cbFirstName.value, "John");
  assert.equal(els.cbDlnPid.value, "S987654321000"); // spaces stripped
});

test("applyCustomerData clears a stale co-buyer when the new fill has none", () => {
  const els = makeElements();
  // Pre-fill a co-buyer (as a prior scan would have).
  els.hasCoBuyer.checked = true;
  els.cbFirstName.value = "STALE";
  els.cbLastName.value = "PERSON";
  els.cbDlnPid.value = "X999";

  applyCustomerData(els, { firstName: "Solo", lastName: "Buyer", dlnPid: "S111" });

  assert.equal(els.hasCoBuyer.checked, false);
  assert.equal(els.cbFirstName.value, "");
  assert.equal(els.cbLastName.value, "");
  assert.equal(els.cbDlnPid.value, "");
});
