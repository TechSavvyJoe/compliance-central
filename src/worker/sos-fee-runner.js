/**
 * Michigan SOS fee-quote runner.
 *
 * Sidebar edits are entirely local. Only an explicit Calculate action sends one
 * bounded batch of completed choices to the backend, which drives the public
 * SOS calculator with Puppeteer exactly like the Repeat Offender and Title/Lien
 * checks. Nothing opens on the salesperson's machine: the customer is sitting
 * at the desk, so a visible state-site tab — and a "finish this yourself on
 * Michigan SOS" handoff — are not acceptable outcomes.
 */

import { backendSosFeeQuote } from "../../lib/api-client.js";
import { SOS_QUOTE_MODE } from "../sidepanel/sos-fee-quote.js";

const VALID_MODES = new Set(Object.values(SOS_QUOTE_MODE));
const VALID_FIELD_KINDS = new Set(["select", "text", "radio"]);

export const SOS_FEE_MESSAGES = Object.freeze({
  calculate: "SOS_FEE_CALCULATE",
  cancel: "SOS_FEE_CANCEL",
});

// There is no longer a partially completed state form to fall back to, so the
// failure text has to carry the whole recourse itself: retry, and verify before
// the number reaches paperwork.
const GENERIC_FAILURE =
  "Michigan SOS did not return a verified registration fee. Try again in a moment, and confirm the fee with Michigan SOS before quoting the customer.";

function safeError(message) {
  return { success: false, error: message || GENERIC_FAILURE };
}

export function validSosSubmissionFields(fields) {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 20) return false;
  return fields.every((field) => {
    if (!field || typeof field !== "object" || !VALID_FIELD_KINDS.has(field.kind)) {
      return false;
    }
    if (typeof field.label !== "string" || field.label.length < 2 || field.label.length > 160) {
      return false;
    }
    if (
      field.labelIncludes !== undefined &&
      (typeof field.labelIncludes !== "string" || field.labelIncludes.length > 80)
    ) {
      return false;
    }
    if (field.optional !== undefined && typeof field.optional !== "boolean") return false;
    for (const key of ["value", "optionValue", "optionLabel"]) {
      if (field[key] !== undefined && (typeof field[key] !== "string" || field[key].length > 128)) {
        return false;
      }
    }
    return true;
  });
}

export function createSosFeeRunner({ requestQuote = backendSosFeeQuote } = {}) {
  // One quote at a time. A second Calculate — or a workspace edit, mode change,
  // or side-panel teardown — abandons the earlier request so a late response can
  // never repaint the panel with a fee for choices the salesperson has moved on
  // from.
  let inFlight = null;

  function cancel() {
    inFlight?.controller.abort();
    inFlight = null;
    return { success: true };
  }

  async function calculate(mode, fields) {
    if (!VALID_MODES.has(mode) || !validSosSubmissionFields(fields)) {
      return safeError("Complete the required SOS fee fields before calculating.");
    }

    cancel();
    const controller = new AbortController();
    const request = { controller };
    inFlight = request;

    try {
      const response = await requestQuote(
        { mode, fields },
        { signal: controller.signal }
      );

      // A superseded or cancelled request must resolve quietly rather than
      // surface a stale success or a scary error for work nobody is waiting on.
      if (inFlight !== request) {
        return { success: false, cancelled: true, error: "Request cancelled." };
      }
      if (!response?.success || !response.quote) {
        return safeError(response?.error);
      }
      return { success: true, quote: response.quote };
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        return { success: false, cancelled: true, error: "Request cancelled." };
      }
      // Never echo the transport error: backend messages can carry request
      // context, and the salesperson needs an action, not a stack.
      console.error("[SOS fee] backend fee quote failed");
      return safeError();
    } finally {
      if (inFlight === request) inFlight = null;
    }
  }

  return {
    calculate,
    cancel,
    isInFlight: () => inFlight !== null,
  };
}

let singleton = null;

export function getSosFeeRunner() {
  if (!singleton) singleton = createSosFeeRunner();
  return singleton;
}
