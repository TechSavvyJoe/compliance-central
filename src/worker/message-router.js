/**
 * Maps runtime.onMessage types to handlers.
 */

import {
  startRunAllChecks,
  isRunInFlight,
  cancelCurrentRun,
} from "./orchestrator.js";
import {
  handleOfacCheck,
  handleGetDataStatus,
} from "./ofac-check.js";
import {
  cancelIndividualOperation,
  handleRepeatOffenderCheck,
  handleTitleCheck,
  isIndividualMdosInFlight,
} from "./mdos-check.js";
import {
  handleHistoryMessage,
  HISTORY_MESSAGES,
  validateHistoryMessage,
} from "./history.js";
import {
  SOS_FEE_MESSAGES,
  getSosFeeRunner,
  validSosSubmissionFields,
} from "./sos-fee-runner.js";
import {
  handleSosLienCheck,
  isSosLienCheckInFlight,
} from "./sos-lien-check.js";
import { CONFIG } from "../../lib/config.js";
import { RESULT_STATE_MESSAGES, resultIdentity } from "../../lib/run-fence.js";
import { persistResults, discardPersistedResults } from "./state.js";
// These exports are pure: use the form's actual validation rules at the
// worker boundary too, without invoking its DOM feedback helpers.
import { collectCustomerValidationErrors, planChecksForData } from "../sidepanel/form.js";
import {
  FORM_CACHE_MESSAGES,
  validateFormCacheMessage,
  handleFormCacheMessage,
} from "./form-cache.js";

const SOS_QUOTE_MODES = new Set(["new_plate", "plate_transfer"]);

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value, maxLength, required = false) {
  if (value === undefined || value === null || value === "") return !required;
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (!required || value.trim().length > 0)
  );
}

function isValidPerson(value, requireLicense = false) {
  if (!isRecord(value)) return false;
  if (!isBoundedString(value.firstName, CONFIG.validation.nameMaxLength, true)) {
    return false;
  }
  if (!isBoundedString(value.lastName, CONFIG.validation.nameMaxLength, true)) {
    return false;
  }
  if (!isBoundedString(value.middleName, CONFIG.validation.nameMaxLength)) {
    return false;
  }
  if (!isBoundedString(value.suffix, 16)) return false;
  if (!isBoundedString(value.dob, 32)) return false;
  const licenseNumber = value.dlnPid ?? value.dln;
  if (!isBoundedString(licenseNumber, 32, requireLicense)) return false;
  if (
    value.hasCoBuyer !== undefined &&
    typeof value.hasCoBuyer !== "boolean"
  ) {
    return false;
  }
  if (!isOptionalBoolean(value.buyerIsMichigan)) return false;
  if (!isOptionalBoolean(value.coBuyerIsMichigan)) return false;
  return true;
}

function isOptionalBoolean(value) {
  return value === undefined || value === null || typeof value === "boolean";
}

function isValidRunId(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value))
  );
}

function isValidRequiredOperationId(value) {
  return (
    typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
  );
}

function isValidSosMode(value) {
  return typeof value === "string" && SOS_QUOTE_MODES.has(value);
}

function normalizeRunAllPayload(data) {
  if (!isRecord(data) || !isRecord(data.customer) || !isValidRunId(data.runId)) return null;
  const source = data.customer;
  const validShape = (person) => isRecord(person) &&
    ["firstName", "middleName", "lastName"].every((key) =>
      isBoundedString(person[key], CONFIG.validation.nameMaxLength)) &&
    isBoundedString(person.suffix, 16) &&
    isBoundedString(person.dob, 32) &&
    isBoundedString(person.dlnPid ?? person.dln, 32);
  if (!validShape(source) ||
      !isBoundedString(source.tradeVin, CONFIG.validation.vinLength) ||
      !isOptionalBoolean(source.buyerIsMichigan) ||
      !isOptionalBoolean(source.coBuyerIsMichigan) ||
      (source.hasCoBuyer !== undefined && typeof source.hasCoBuyer !== "boolean") ||
      (source.coBuyer !== undefined && !validShape(source.coBuyer)) ||
      (source.hasCoBuyer && !source.coBuyer)) return null;

  const coBuyer = source.coBuyer && { ...source.coBuyer, dlnPid: source.coBuyer.dlnPid ?? source.coBuyer.dln };
  const hasCoBuyer = Boolean(coBuyer &&
    ["firstName", "middleName", "lastName", "suffix", "dob", "dlnPid"].some((key) => coBuyer[key]?.trim()));
  const customer = {
    ...source,
    dlnPid: source.dlnPid ?? source.dln,
    tradeVin: source.tradeVin?.trim().toUpperCase() || "",
    hasCoBuyer,
    ...(coBuyer ? { coBuyer } : {}),
  };
  // A supplied plan or hasTrade flag cannot suppress a filled person/VIN or
  // invent work for an empty one. Partial supplied identities fail validation.
  const plan = planChecksForData(customer);
  if (!(plan.buyer || plan.coBuyer || plan.title) ||
      collectCustomerValidationErrors(customer, plan).length) return null;
  return { customer, runId: data.runId, hasTrade: plan.title, plan };
}

function validatePayload(type, data) {
  switch (type) {
    case FORM_CACHE_MESSAGES.save:
    case FORM_CACHE_MESSAGES.load:
    case FORM_CACHE_MESSAGES.clear:
      return validateFormCacheMessage(type, data);
    case RESULT_STATE_MESSAGES.persist:
      return isRecord(data) && isRecord(data.results) &&
        isRecord(data.results.checks) &&
        isValidRequiredOperationId(data.results.runType === "individual"
          ? data.results.operationId : data.results.runId) &&
        Boolean(resultIdentity(data.results)) &&
        (data.expectedResultId === null ||
          /^(run|operation):[A-Za-z0-9._:-]{1,128}$/.test(data.expectedResultId));
    case RESULT_STATE_MESSAGES.discard:
      return isRecord(data) && typeof data.resultId === "string" &&
        /^(run|operation):[A-Za-z0-9._:-]{1,128}$/.test(data.resultId) &&
        isBoundedString(data.timestamp, 64);
    case "RUN_ALL_CHECKS":
      return Boolean(normalizeRunAllPayload(data));
    case "RUN_OFAC_CHECK":
      return isValidPerson(data, false);
    case "RUN_REPEAT_OFFENDER":
    case "RUN_SEARCH":
      return (
        isValidPerson(data, true) &&
        isValidRequiredOperationId(data.operationId)
      );
    case "RUN_TITLE_CHECK":
      return (
        isRecord(data) &&
        isBoundedString(data.vin, CONFIG.validation.vinLength, true) &&
          isValidRequiredOperationId(data.operationId)
      );
    case "RUN_SOS_LIEN_CHECK":
      return (
        isRecord(data) &&
        isBoundedString(data.vin, CONFIG.validation.vinLength, true) &&
        /^[A-HJ-NPR-Z0-9]{17}$/.test(data.vin)
      );
    case SOS_FEE_MESSAGES.calculate:
      return (
        isRecord(data) &&
        isValidRequiredOperationId(data.requestId) &&
        isValidSosMode(data.mode) &&
        validSosSubmissionFields(data.fields)
      );
    case SOS_FEE_MESSAGES.cancel:
      return isRecord(data) && isValidRequiredOperationId(data.requestId);
    case HISTORY_MESSAGES.append:
    case HISTORY_MESSAGES.remove:
    case HISTORY_MESSAGES.purge:
    case HISTORY_MESSAGES.clear:
      return validateHistoryMessage(type, data);
    default:
      return true;
  }
}

function isTrustedSender(sender) {
  const runtimeId = chrome.runtime.id;
  if (sender?.id && sender.id !== runtimeId) return false;

  // Same-extension content scripts have the same sender.id but inherit the web
  // page URL. Privileged screening actions are only needed by extension pages.
  const extensionRoot = chrome.runtime.getURL?.("");
  if (sender?.url && extensionRoot && !sender.url.startsWith(extensionRoot)) {
    return false;
  }
  return true;
}

export async function handleMessage(message, sender) {
  try {
    if (!message || typeof message.type !== "string") {
      return { success: false, error: "Invalid message" };
    }

    if (!isTrustedSender(sender)) {
      return { success: false, error: "Unauthorized sender" };
    }

    const invalidCancelId =
      message.type === "CANCEL_CURRENT_RUN" && !isValidRequiredOperationId(message.runId);
    const operationId = message.data?.operationId || message.operationId;
    const invalidOperationCancelId =
      message.type === "CANCEL_INDIVIDUAL_OPERATION" &&
      !isValidRequiredOperationId(operationId);
    if (
      invalidCancelId ||
      invalidOperationCancelId ||
      !validatePayload(message.type, message.data)
    ) {
      return { success: false, error: `Invalid ${message.type} payload` };
    }

    switch (message.type) {
      case FORM_CACHE_MESSAGES.save:
      case FORM_CACHE_MESSAGES.load:
      case FORM_CACHE_MESSAGES.clear:
        return handleFormCacheMessage(message.type, message.data);

      case RESULT_STATE_MESSAGES.persist:
        return persistResults(message.data);

      case RESULT_STATE_MESSAGES.discard:
        return discardPersistedResults(message.data);

      case "RUN_ALL_CHECKS":
        // Reject busy before starting so the sidepanel learns the truth.
        if (
          isRunInFlight() ||
          isIndividualMdosInFlight() ||
          isSosLienCheckInFlight()
        ) {
          return {
            success: false,
            error: "A compliance or Michigan state-site check is already in progress.",
          };
        }
        // Acknowledge only after the initial session state is durable. The rest
        // of the run continues in the background and storage events drive UI.
        return startRunAllChecks(normalizeRunAllPayload(message.data));

      case "CANCEL_CURRENT_RUN":
        return cancelCurrentRun(message.runId);

      case "CANCEL_INDIVIDUAL_OPERATION":
        return cancelIndividualOperation(operationId);

      case "RUN_OFAC_CHECK":
        return handleOfacCheck(message.data);

      case "RUN_REPEAT_OFFENDER":
      case "RUN_SEARCH":
        if (isRunInFlight() || isSosLienCheckInFlight()) {
          return {
            success: false,
            error: "A compliance or Michigan state-site check is already in progress.",
          };
        }
        return handleRepeatOffenderCheck(message.data);

      case "RUN_TITLE_CHECK":
        if (isRunInFlight() || isSosLienCheckInFlight()) {
          return {
            success: false,
            error: "A compliance or Michigan state-site check is already in progress.",
          };
        }
        return handleTitleCheck(message.data);

      case "RUN_SOS_LIEN_CHECK":
        if (
          isRunInFlight() ||
          isIndividualMdosInFlight() ||
          isSosLienCheckInFlight()
        ) {
          return {
            success: false,
            error: "A compliance or Michigan state-site check is already in progress.",
          };
        }
        return handleSosLienCheck(message.data);

      case SOS_FEE_MESSAGES.calculate:
        return getSosFeeRunner().calculate(message.data.mode, message.data.fields, message.data.requestId);

      case SOS_FEE_MESSAGES.cancel:
        return getSosFeeRunner().cancel(message.data.requestId);

      case "getDataStatus":
        return handleGetDataStatus();

      case HISTORY_MESSAGES.append:
      case HISTORY_MESSAGES.remove:
      case HISTORY_MESSAGES.purge:
      case HISTORY_MESSAGES.clear:
        return handleHistoryMessage(message.type, message.data);

      default:
        return { success: false, error: `Unknown message type: ${message.type}` };
      }
  } catch (error) {
    console.error("Message handler failed:", error);
    return { success: false, error: "Internal error processing message" };
  }
}
