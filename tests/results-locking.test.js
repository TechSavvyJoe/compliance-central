import assert from "node:assert/strict";
import test from "node:test";

import { setButtonsDisabled } from "../src/sidepanel/results.js";

function control(value = "") {
  return { disabled: false, value };
}

test("active checks lock every submitted identity field but leave Clear alone", () => {
  const elements = {
    runAllChecksBtn: control(),
    runOfacBtn: control(),
    runRepeatOffenderBtn: control(),
    runTitleBtn: control(),
    clearBtn: control(),
    firstName: control(),
    middleName: control(),
    lastName: control(),
    suffix: control(),
    dob: control(),
    dlnPid: control(),
    tradeVin: control("1HGBH41JXMN109186"),
    hasCoBuyer: control(),
    cbFirstName: control(),
    cbMiddleName: control(),
    cbLastName: control(),
    cbSuffix: control(),
    cbDob: control(),
    cbDlnPid: control(),
    scanLicenseBtn: control(),
    inputSummaryBar: control(),
  };

  setButtonsDisabled(elements, true);
  for (const [key, value] of Object.entries(elements)) {
    if (key === "clearBtn") continue;
    assert.equal(value.disabled, true, `${key} should be locked`);
  }
  assert.equal(elements.clearBtn.disabled, false);

  setButtonsDisabled(elements, false);
  assert.equal(elements.firstName.disabled, false);
  assert.equal(elements.inputSummaryBar.disabled, false);
  assert.equal(elements.runTitleBtn.disabled, false);
});
