/**
 * Sidepanel check helpers. Send messages to the service worker and
 * normalize results for the UI.
 */

import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { lienSummary } from "./title-format.js";

/**
 * Remove any leftover MDOS screenshots from a prior run in this session.
 * Guards against a stale screenshot being attached to a new check after an
 * extension reload (session storage survives a reload within the same window).
 */
export async function clearTransientScreenshots() {
  try {
    await chrome.storage.session.remove([
      STORAGE_KEYS.repeatOffenderScreenshot,
      STORAGE_KEYS.coBuyerRepeatOffenderScreenshot,
      STORAGE_KEYS.titleScreenshot,
    ]);
  } catch {
    // ignore
  }
}

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

  if (!response?.success) {
    throw new Error(response?.error || "OFAC check failed");
  }

  const result = response.result;
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    typeof result.hasMatch !== "boolean" ||
    !Array.isArray(result.matches)
  ) {
    throw new Error(
      "The OFAC check returned an incomplete result. Please try again."
    );
  }

  return {
    passed: !result.hasMatch,
    matches: result.matches,
    matchCount: result.matchCount || 0,
    entriesSearched: result.entriesSearched || 0,
    lastUpdate: result.lastUpdate,
    stale: !!result.stale,
    dataAgeHours: result.dataAgeHours,
    timestamp: new Date().toISOString(),
  };
}

export async function runRepeatOffenderCheck(customerData, operationId) {
  const response = await chrome.runtime.sendMessage({
    type: "RUN_REPEAT_OFFENDER",
    data: {
      firstName: customerData.firstName,
      middleName: customerData.middleName,
      lastName: customerData.lastName,
      suffix: customerData.suffix,
      dob: customerData.dob,
      dlnPid: customerData.dlnPid,
      operationId,
    },
  });

  if (!response?.success) {
    throw new Error(response?.error || "Repeat Offender check failed");
  }

  const result = response.result;
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !["eligible", "ineligible"].includes(result.status)
  ) {
    throw new Error(
      "The Repeat Offender check returned an incomplete result. Please try again."
    );
  }

  let screenshotData = result.screenshotData;
  if (!screenshotData) {
    try {
      const stored = await chrome.storage.session.get(
        STORAGE_KEYS.repeatOffenderScreenshot
      );
      if (stored[STORAGE_KEYS.repeatOffenderScreenshot]) {
        screenshotData = stored[STORAGE_KEYS.repeatOffenderScreenshot];
        chrome.storage.session.remove(STORAGE_KEYS.repeatOffenderScreenshot);
      }
    } catch {
      // ignore
    }
  }

  return {
    passed: result.status === "eligible",
    status: result.status,
    rawText: result.rawText || "",
    screenshotData,
    timestamp: new Date().toISOString(),
  };
}

export async function runTitleCheck(customerData, operationId) {
  const response = await chrome.runtime.sendMessage({
    type: "RUN_TITLE_CHECK",
    data: { vin: customerData.tradeVin, operationId },
  });

  if (!response?.success) {
    throw new Error(response?.error || "Title check failed");
  }

  const result = response.result;
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    typeof result.passed !== "boolean" ||
    typeof result.hasLien !== "boolean" ||
    typeof result.titleBrand !== "string" ||
    result.titleBrand.trim().length === 0
  ) {
    throw new Error(
      "The title check returned an incomplete result. Please try again."
    );
  }
  let screenshotData = result.screenshotData;
  if (!screenshotData) {
    try {
      const stored = await chrome.storage.session.get(STORAGE_KEYS.titleScreenshot);
      if (stored[STORAGE_KEYS.titleScreenshot]) {
        screenshotData = stored[STORAGE_KEYS.titleScreenshot];
        chrome.storage.session.remove(STORAGE_KEYS.titleScreenshot);
      }
    } catch {
      // ignore
    }
  }

  return {
    passed: result.passed,
    year: result.year,
    make: result.make,
    model: result.model,
    unladenWeight: result.unladenWeight,
    titleStatus: result.titleStatus,
    titleBrand: result.titleBrand,
    titleType: result.titleType || "UNKNOWN",
    titleIssued: result.titleIssued,
    lienStatus: result.lienStatus || "UNKNOWN",
    hasLien: result.hasLien,
    lienHolder: result.lienHolder,
    vehicleBrands: result.vehicleBrands || [],
    screenshotData,
    rawText: result.rawText,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Normalize an OFAC result before it is used for a final decision or report.
 * A service failure commonly carries `passed: false`; it must never be treated
 * as a confirmed match unless the result is otherwise a valid completed check.
 */
export function classifyOfacResult(result) {
  if (!result) {
    return { state: "missing", blocker: false, complete: false };
  }
  if (result.error || result.status === "error") {
    return { state: "unavailable", blocker: false, complete: false };
  }
  if (result.passed === true) {
    return {
      state: result.stale ? "stale" : "clear",
      blocker: false,
      complete: true,
    };
  }
  if (result.passed === false) {
    if (result.disposition === "confirmed_match") {
      return { state: "confirmed_match", blocker: true, complete: true };
    }
    if (result.disposition === "false_positive") {
      return { state: "false_positive", blocker: false, complete: true };
    }
    return { state: "potential_match", blocker: false, complete: false };
  }
  return { state: "review", blocker: false, complete: false };
}

/**
 * Normalize the Michigan Repeat Offender response. Both the status enum and
 * boolean must agree; unknown or contradictory combinations require review.
 */
export function classifyRepeatOffenderResult(result) {
  if (!result) {
    return { state: "missing", blocker: false, complete: false };
  }
  if (result.error || result.status === "error") {
    return { state: "unavailable", blocker: false, complete: false };
  }
  if (result.status === "eligible" && result.passed === true) {
    return { state: "eligible", blocker: false, complete: true };
  }
  if (result.status === "ineligible" && result.passed === false) {
    return { state: "ineligible", blocker: true, complete: true };
  }
  if (
    result.status === "not_applicable" &&
    (result.passed === null || result.passed === undefined)
  ) {
    return { state: "not_applicable", blocker: false, complete: true };
  }
  return { state: "review", blocker: false, complete: false };
}

export function calculateFinalDecision(checks) {
  const buyerOfac = classifyOfacResult(checks.ofac);
  const coBuyerOfac = checks.coBuyerOfac
    ? classifyOfacResult(checks.coBuyerOfac)
    : null;
  const buyerRepeat = classifyRepeatOffenderResult(checks.repeatOffender);
  const coBuyerRepeat = checks.coBuyerRepeatOffender
    ? classifyRepeatOffenderResult(checks.coBuyerRepeatOffender)
    : null;

  // Known legal/compliance blockers take precedence over unrelated incomplete
  // checks. An outage must not soften a confirmed denial into a generic review.
  if (buyerOfac.blocker || coBuyerOfac?.blocker) {
    return {
      approved: false,
      level: "DENIED",
      reason: "OFAC match confirmed after comparison - do not proceed with the transaction",
    };
  }

  if (
    buyerOfac.state === "potential_match" ||
    coBuyerOfac?.state === "potential_match"
  ) {
    return {
      approved: false,
      level: "REVIEW",
      reason:
        "Potential OFAC match found - compare the buyer with the SDN entry before deciding",
    };
  }

  if (buyerRepeat.blocker || coBuyerRepeat?.blocker) {
    return {
      approved: false,
      level: "DENIED",
      reason: "Repeat offender status - registration will be denied",
    };
  }

  if (buyerOfac.state === "missing") {
    return {
      approved: false,
      level: "REVIEW",
      reason: "OFAC screening has not been completed",
    };
  }

  if (
    buyerOfac.state === "unavailable" ||
    coBuyerOfac?.state === "unavailable"
  ) {
    return {
      approved: false,
      level: "REVIEW",
      reason: "OFAC screening could not be completed - review before proceeding",
    };
  }

  if (buyerOfac.state === "review" || coBuyerOfac?.state === "review") {
    return {
      approved: false,
      level: "REVIEW",
      reason: "OFAC screening returned an unrecognized result - review before proceeding",
    };
  }

  if (buyerRepeat.state === "missing") {
    return {
      approved: false,
      level: "REVIEW",
      reason: "Repeat Offender check has not been completed",
    };
  }

  if (
    buyerRepeat.state === "unavailable" ||
    coBuyerRepeat?.state === "unavailable"
  ) {
    return {
      approved: false,
      level: "REVIEW",
      reason: "Repeat Offender check could not be completed - review before proceeding",
    };
  }

  if (buyerRepeat.state === "review" || coBuyerRepeat?.state === "review") {
    return {
      approved: false,
      level: "REVIEW",
      reason:
        "Repeat Offender check returned an unrecognized or contradictory response - review before proceeding",
    };
  }

  // A clean OFAC result against a list that could not be refreshed is not a
  // confident clear — require review rather than silently approving.
  if (buyerOfac.state === "stale" || coBuyerOfac?.state === "stale") {
    return {
      approved: false,
      level: "REVIEW",
      reason:
        "OFAC SDN list could not be refreshed — screened against cached data. Re-run when back online before proceeding.",
    };
  }

  if (checks.title) {
    if (checks.title.error || checks.title.passed !== true) {
      return {
        approved: false,
        level: "REVIEW",
        reason:
          "Title/Lien check could not confirm a clear result - review trade documents before proceeding",
      };
    }

    const titleBrand = checks.title.titleBrand;
    const allBrands = [titleBrand, ...(checks.title.vehicleBrands || [])].filter(
      (brand) => typeof brand === "string"
    );

    const problemBrands = allBrands.filter(
      (brand) =>
        brand &&
        brand !== "CLEAN" &&
        brand !== "UNKNOWN" &&
        brand !== "undefined" &&
        brand.toLowerCase() !== "none" &&
        brand.toLowerCase() !== "no brands" &&
        !brand.toLowerCase().includes("no brand")
    );

    if (problemBrands.length > 0) {
      return {
        approved: false,
        level: "REVIEW",
        reason: `Trade title branded as ${problemBrands.join(", ")} - requires disclosure`,
        warnings: [],
      };
    }

    if (checks.title.hasLien) {
      return {
        approved: true,
        level: "APPROVED",
        reason: "Customer checks passed - trade has active lien",
        warnings: [lienSummary(checks.title)],
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

/**
 * The verdict for a completed run, including the incomplete-checks downgrade.
 *
 * calculateFinalDecision judges the checks it is given. It cannot know that a
 * check is *missing* — that a co-buyer was screened but their OFAC result never
 * arrived, or that a trade VIN was entered and the title check never ran. The
 * printed report has always applied that downgrade and the screen never did, so
 * a restored History record could read APPROVED in the panel and REVIEW
 * REQUIRED on the legal document printed from the same row. Both call this now.
 *
 * A live Run All backfills every expected check, so this only bites records
 * saved under earlier rules — which is exactly the case where a stale APPROVED
 * is most misleading.
 */
export function finalDecisionForResults(results) {
  const checks = results?.checks || {};
  const customer = results?.customer || {};
  const base = calculateFinalDecision(checks);
  if (base.level !== "APPROVED") return base;

  const incomplete = [
    !classifyOfacResult(checks.ofac).complete,
    !classifyRepeatOffenderResult(checks.repeatOffender).complete,
    Boolean(customer.coBuyer) && !classifyOfacResult(checks.coBuyerOfac).complete,
    Boolean(customer.coBuyer) &&
      !classifyRepeatOffenderResult(checks.coBuyerRepeatOffender).complete,
    // A trade VIN with no title result, or an errored one, is a missing check.
    Boolean(customer.tradeVin) &&
      (!checks.title || Boolean(checks.title.error) || checks.title.status === "error"),
  ].some(Boolean);

  if (!incomplete) return base;
  return {
    approved: false,
    level: "REVIEW",
    reason:
      "One or more required checks are incomplete - review and re-run them before proceeding",
    warnings: base.warnings || [],
  };
}
