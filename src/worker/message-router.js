/**
 * Maps runtime.onMessage types to handlers.
 */

import { handleRunAllChecks } from "./orchestrator.js";
import {
  handleOfacCheck,
  handleGetDataStatus,
  handleGetSDNEntries,
  performSDNUpdate,
} from "./ofac-check.js";
import {
  handleRepeatOffenderCheck,
  handleTitleCheck,
} from "./mdos-check.js";

export async function handleMessage(message) {
  switch (message.type) {
    case "RUN_ALL_CHECKS":
      // Fire-and-forget; storage listeners drive UI updates.
      handleRunAllChecks(message.data);
      return { success: true, status: "started" };

    case "RUN_OFAC_CHECK":
      return handleOfacCheck(message.data);

    case "RUN_REPEAT_OFFENDER":
    case "RUN_SEARCH":
      return handleRepeatOffenderCheck(message.data);

    case "RUN_TITLE_CHECK":
      return handleTitleCheck(message.data);

    case "getDataStatus":
      return handleGetDataStatus();

    case "forceUpdate":
      return performSDNUpdate();

    case "getSDNEntries":
      return handleGetSDNEntries();

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
