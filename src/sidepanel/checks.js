/**
 * Sidepanel check helpers. Send messages to the service worker and
 * normalize results for the UI.
 */

export async function runOfacCheck(customerData) {
  const response = await chrome.runtime.sendMessage({
    type: "RUN_OFAC_CHECK",
    data: {
      firstName: customerData.firstName,
      middleName: customerData.middleName,
      lastName: customerData.lastName,
      dob: customerData.dob,
    },
  });

  if (!response.success) {
    throw new Error(response.error || "OFAC check failed");
  }

  return {
    passed: !response.result.hasMatch,
    matches: response.result.matches || [],
    matchCount: response.result.matchCount || 0,
    entriesSearched: response.result.entriesSearched || 0,
    lastUpdate: response.result.lastUpdate,
    timestamp: new Date().toISOString(),
  };
}

export async function runRepeatOffenderCheck(customerData) {
  const response = await chrome.runtime.sendMessage({
    type: "RUN_REPEAT_OFFENDER",
    data: {
      firstName: customerData.firstName,
      middleName: customerData.middleName,
      lastName: customerData.lastName,
      suffix: customerData.suffix,
      dob: customerData.dob,
      dlnPid: customerData.dlnPid,
    },
  });

  if (!response.success) {
    throw new Error(response.error || "Repeat Offender check failed");
  }

  let screenshotData = response.result.screenshotData;
  if (!screenshotData) {
    try {
      const stored = await chrome.storage.local.get("repeatOffenderScreenshot");
      if (stored.repeatOffenderScreenshot) {
        screenshotData = stored.repeatOffenderScreenshot;
        chrome.storage.local.remove("repeatOffenderScreenshot");
      }
    } catch {
      // ignore
    }
  }

  return {
    passed: response.result.status === "eligible",
    status: response.result.status,
    rawText: response.result.rawText || "",
    screenshotData,
    timestamp: new Date().toISOString(),
  };
}

export async function runTitleCheck(customerData) {
  const response = await chrome.runtime.sendMessage({
    type: "RUN_TITLE_CHECK",
    data: { vin: customerData.tradeVin },
  });

  if (!response.success) {
    throw new Error(response.error || "Title check failed");
  }

  const result = response.result;
  let screenshotData = result.screenshotData;
  if (!screenshotData) {
    try {
      const stored = await chrome.storage.local.get("titleScreenshot");
      if (stored.titleScreenshot) {
        screenshotData = stored.titleScreenshot;
        chrome.storage.local.remove("titleScreenshot");
      }
    } catch {
      // ignore
    }
  }

  return {
    passed:
      result.passed ??
      (result.titleBrand === "CLEAN" && !result.hasLien),
    year: result.year,
    make: result.make,
    model: result.model,
    unladenWeight: result.unladenWeight,
    titleBrand: result.titleBrand || "CLEAN",
    titleType: result.titleType || "UNKNOWN",
    titleIssued: result.titleIssued,
    lienStatus: result.lienStatus || "UNKNOWN",
    hasLien: result.hasLien || false,
    lienHolder: result.lienHolder,
    vehicleBrands: result.vehicleBrands || [],
    screenshotData,
    rawText: result.rawText,
    timestamp: new Date().toISOString(),
  };
}

export function calculateFinalDecision(checks) {
  const ofacPass = checks.ofac?.passed ?? false;
  const repeatPass = checks.repeatOffender?.passed ?? false;
  const cbOfacPass = checks.coBuyerOfac ? checks.coBuyerOfac.passed : true;
  const cbRepeatPass = checks.coBuyerRepeatOffender
    ? checks.coBuyerRepeatOffender.passed
    : true;

  if (!ofacPass || !cbOfacPass) {
    return {
      approved: false,
      level: "DENIED",
      reason: "OFAC match found - cannot proceed with transaction",
    };
  }

  if (!repeatPass || !cbRepeatPass) {
    return {
      approved: false,
      level: "DENIED",
      reason: "Repeat offender status - registration will be denied",
    };
  }

  if (checks.title) {
    const titleBrand = checks.title.titleBrand;

    const hasProblemBrand =
      titleBrand &&
      titleBrand !== "CLEAN" &&
      titleBrand !== "UNKNOWN" &&
      titleBrand !== "undefined" &&
      titleBrand.toLowerCase() !== "none" &&
      titleBrand.toLowerCase() !== "no brands" &&
      !titleBrand.toLowerCase().includes("no brand");

    if (hasProblemBrand) {
      return {
        approved: false,
        level: "REVIEW",
        reason: `Trade title branded as ${titleBrand} - requires disclosure`,
        warnings: [],
      };
    }

    if (checks.title.hasLien) {
      return {
        approved: true,
        level: "APPROVED",
        reason: "Customer checks passed - trade has active lien",
        warnings: [
          `Trade lien: ${checks.title.lienHolder || "Unknown"} - payoff required`,
        ],
      };
    }
  }

  return {
    approved: true,
    level: "APPROVED",
    reason: "All checks passed - clear to proceed",
    warnings: [],
  };
}
