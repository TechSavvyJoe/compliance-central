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
  handleRepeatOffenderCheck,
  handleTitleCheck,
} from "./mdos-check.js";
import { CONFIG } from "../../lib/config.js";

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
  return true;
}

function isValidRunId(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value))
  );
}

function validatePayload(type, data) {
  switch (type) {
    case "RUN_ALL_CHECKS":
      return (
        isRecord(data) &&
        typeof data.hasTrade === "boolean" &&
        isValidRunId(data.runId) &&
        isValidPerson(data.customer, true) &&
        (!data.customer.hasCoBuyer || isValidPerson(data.customer.coBuyer, true)) &&
        (!data.hasTrade ||
          isBoundedString(data.customer.tradeVin, CONFIG.validation.vinLength, true))
      );
    case "RUN_OFAC_CHECK":
      return isValidPerson(data, false);
    case "RUN_REPEAT_OFFENDER":
    case "RUN_SEARCH":
      return isValidPerson(data, true);
    case "RUN_TITLE_CHECK":
      return (
        isRecord(data) &&
        isBoundedString(data.vin, CONFIG.validation.vinLength, true)
      );
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
  if (!message || typeof message.type !== "string") {
    return { success: false, error: "Invalid message" };
  }

  if (!isTrustedSender(sender)) {
    return { success: false, error: "Unauthorized sender" };
  }

  const invalidCancelId =
    message.type === "CANCEL_CURRENT_RUN" && !isValidRunId(message.runId);
  if (invalidCancelId || !validatePayload(message.type, message.data)) {
    return { success: false, error: `Invalid ${message.type} payload` };
  }

  switch (message.type) {
    case "RUN_ALL_CHECKS":
      // Reject busy before starting so the sidepanel learns the truth.
      if (isRunInFlight()) {
        return {
          success: false,
          error: "A compliance run is already in progress.",
        };
      }
      // Acknowledge only after the initial session state is durable. The rest
      // of the run continues in the background and storage events drive UI.
      return startRunAllChecks(message.data);

    case "CANCEL_CURRENT_RUN":
      return cancelCurrentRun(message.runId);

    case "RUN_OFAC_CHECK":
      return handleOfacCheck(message.data);

    case "RUN_REPEAT_OFFENDER":
    case "RUN_SEARCH":
      return handleRepeatOffenderCheck(message.data);

    case "RUN_TITLE_CHECK":
      return handleTitleCheck(message.data);

    case "getDataStatus":
      return handleGetDataStatus();

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}
