import assert from "node:assert/strict";
import test from "node:test";
import { collectCustomerValidationErrors, planChecksForData } from "../src/sidepanel/form.js";

const coBuyer = { firstName: "Alex", lastName: "Taylor", dob: "03/14/1985", dlnPid: "T123456789012" };

test("a complete co-buyer can run without inventing a buyer or trade", () => {
  const data = { hasCoBuyer: true, coBuyer };
  assert.deepEqual(collectCustomerValidationErrors(data, planChecksForData(data)), []);
});

test("VIN-only planning still validates a partially entered co-buyer", () => {
  const data = { tradeVin: "1FTFW1E84PFA10397", hasCoBuyer: true, coBuyer: { firstName: "Alex" } };
  assert.deepEqual(collectCustomerValidationErrors(data, planChecksForData(data)).map(e => e.fieldId), ["cbLastName", "cbDob", "cbDlnPid"]);
});

test("invalid co-buyer identity is not bypassed when the buyer is empty", () => {
  const data = { hasCoBuyer: true, coBuyer: { ...coBuyer, dob: "02/31/1985", dlnPid: "123" } };
  assert.deepEqual(collectCustomerValidationErrors(data, planChecksForData(data)).map(e => e.fieldId), ["cbDob", "cbDlnPid"]);
});

test("a middle name by itself is incomplete identity, not a skipped person", () => {
  const data = { middleName: "Alex", tradeVin: "1FTFW1E84PFA10397" };
  assert.equal(planChecksForData(data).buyerPartial, true);
  assert.deepEqual(collectCustomerValidationErrors(data, planChecksForData(data)).map(e => e.fieldId), ["firstName", "lastName", "dob", "dlnPid"]);
});
