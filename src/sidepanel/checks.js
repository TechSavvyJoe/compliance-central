/**
 * Sidepanel check helpers. Send messages to the service worker and
 * normalize results for the UI.
 */

import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { problemTitleBrands } from "../../lib/title-brands.js";
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
 *
 * `stale` rides alongside the state rather than replacing it. Staleness is a
 * fact about the list the screening compared against — about the entries that
 * were never compared at all — so it survives whatever the screening found and
 * whatever the dealership decided about it.
 */
export function classifyOfacResult(result) {
  const stale = Boolean(result?.stale);
  if (!result) {
    return { state: "missing", blocker: false, complete: false, stale };
  }
  if (result.error || result.status === "error") {
    return { state: "unavailable", blocker: false, complete: false, stale };
  }
  if (result.passed === true) {
    return {
      state: stale ? "stale" : "clear",
      blocker: false,
      complete: true,
      stale,
    };
  }
  // A check the run never attempted is its own state. It is still incomplete —
  // nothing here can approve a record — but calling it an unrecognized result
  // told the reader the screening had run and come back strange, which is the
  // opposite of what happened.
  if (result.status === "skipped" && result.passed === null) {
    return { state: "not_run", blocker: false, complete: false, stale };
  }
  if (result.passed === false) {
    if (result.disposition === "confirmed_match") {
      return { state: "confirmed_match", blocker: true, complete: true, stale };
    }
    if (result.disposition === "false_positive") {
      return { state: "false_positive", blocker: false, complete: true, stale };
    }
    return { state: "potential_match", blocker: false, complete: false, stale };
  }
  return { state: "review", blocker: false, complete: false, stale };
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

  // Known legal/compliance blockers take precedence over every unresolved
  // check, incomplete or not. An outage must not soften a confirmed denial into
  // a generic review — and neither may an OFAC hit nobody has compared yet.
  // Michigan refusing to register the vehicle is a finding, not a question, so
  // both blockers are settled before anything asks for a comparison.
  if (buyerOfac.blocker || coBuyerOfac?.blocker) {
    return {
      approved: false,
      level: "DENIED",
      reason: "OFAC match confirmed after comparison — do not proceed with the transaction",
    };
  }

  if (buyerRepeat.blocker || coBuyerRepeat?.blocker) {
    return {
      approved: false,
      level: "DENIED",
      reason: "Repeat offender status — registration will be denied",
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
        "Potential OFAC match found — compare the buyer with the SDN entry before deciding",
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
      reason: "OFAC screening could not be completed — review before proceeding",
    };
  }

  if (buyerOfac.state === "not_run" || coBuyerOfac?.state === "not_run") {
    return {
      approved: false,
      level: "REVIEW",
      reason:
        "OFAC screening was not run for this record — screen the buyer before proceeding",
    };
  }

  if (buyerOfac.state === "review" || coBuyerOfac?.state === "review") {
    return {
      approved: false,
      level: "REVIEW",
      reason: "The OFAC screening result could not be read — review before proceeding",
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
      reason: "Repeat Offender check could not be completed — review before proceeding",
    };
  }

  if (buyerRepeat.state === "review" || coBuyerRepeat?.state === "review") {
    return {
      approved: false,
      level: "REVIEW",
      reason:
        "Michigan's repeat-offender answer was unclear or contradictory — review before proceeding",
    };
  }

  // A clean OFAC result against a list that could not be refreshed is not a
  // confident clear — require review rather than silently approving. Gating on
  // the state alone let a triaged hit walk past: a match cleared as a false
  // positive reported state "false_positive", so the same unrefreshed list
  // produced REVIEW with nothing found and APPROVED once something had been
  // found and dismissed. The doubt is about the entries never compared, which
  // no disposition answers, so it is the flag that gates.
  if (buyerOfac.stale || coBuyerOfac?.stale) {
    return {
      approved: false,
      level: "REVIEW",
      reason:
        "The OFAC list could not be refreshed, so this screening used an older copy. Re-run once you are back online, before proceeding.",
    };
  }

  if (checks.title) {
    if (checks.title.error || checks.title.passed !== true) {
      return {
        approved: false,
        level: "REVIEW",
        reason:
          "Title/Lien check could not confirm a clear result — review trade documents before proceeding",
      };
    }

    const problemBrands = problemTitleBrands(checks.title);

    if (problemBrands.length > 0) {
      return {
        approved: false,
        level: "REVIEW",
        reason: `Trade title branded as ${problemBrands.join(", ")} — requires disclosure`,
        warnings: [],
      };
    }

    if (checks.title.hasLien) {
      return {
        approved: true,
        level: "APPROVED",
        reason: "Customer checks passed — trade has an active lien",
        warnings: [lienSummary(checks.title)],
      };
    }
  }

  return {
    approved: true,
    level: "APPROVED",
    reason: "All checks passed — clear to proceed",
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
/**
 * The decision to show for a saved history row.
 *
 * A row stores the verdict that was current when it was written, and older
 * releases wrote it under older rules. Reopening a row recomputes for the panel
 * and the printed report but never rewrites the stored value, so a legacy
 * APPROVED could sit in the History list and in the examiner's audit CSV while
 * both live surfaces said REVIEW for the very same record.
 *
 * Recomputing from the saved checks keeps every surface telling one story. A
 * record saved before the app kept its checks has nothing to recompute from, so
 * its stored decision stands — it is all there is.
 */
export function historyRowDecision(item) {
  const saved = item?.savedResults;
  if (!saved?.checks) return item?.decision || "";
  return finalDecisionForResults(saved).level || item?.decision || "";
}

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
      "One or more required checks are incomplete — review and re-run them before proceeding",
    warnings: base.warnings || [],
  };
}
