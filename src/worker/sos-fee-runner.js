/**
 * Public Michigan SOS fee-calculator runner.
 *
 * The calculator is always opened as an inactive, extension-owned tab. The
 * side panel receives only the official calculator schema, an approved plate
 * design URL, and a verified final fee. The tab is closed after calculation,
 * on cancellation, or when the worker restarts; it is never shown to the
 * salesperson or customer.
 */

import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import {
  SOS_QUOTE_MODE,
  sosCalculatorUrlForMode,
} from "../sidepanel/sos-fee-quote.js";

const VALID_MODES = new Set(Object.values(SOS_QUOTE_MODE));
const RECEIVER_RETRY_DELAY_MS = 200;
const RECEIVER_RETRY_COUNT = 75;

export const SOS_FEE_MESSAGES = Object.freeze({
  start: "SOS_FEE_START",
  updateField: "SOS_FEE_UPDATE_FIELD",
  calculate: "SOS_FEE_CALCULATE",
  close: "SOS_FEE_CLOSE",
  discover: "SOS_DISCOVER_CALCULATOR",
  applyField: "SOS_APPLY_CALCULATOR_FIELD",
  calculateInTab: "SOS_CALCULATE_IN_TAB",
});

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function receiverNotReady(error) {
  return /Receiving end does not exist|Could not establish connection/i.test(
    String(error?.message || error || "")
  );
}

function safeError(message) {
  return {
    success: false,
    error:
      message ||
      "Michigan SOS could not complete this fee calculation. Please try again.",
  };
}

function validFieldPayload(data) {
  return (
    data &&
    typeof data.fieldId === "string" &&
    /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(data.fieldId) &&
    typeof data.value === "string" &&
    data.value.length <= 128
  );
}

/**
 * Create an independently testable runner. `chromeApi` is injected in tests;
 * production uses the extension's Chrome APIs when the singleton is requested.
 */
export function createSosFeeRunner(chromeApi, { sleep = pause } = {}) {
  let session = null;

  async function clearTabMetadata() {
    await chromeApi.storage.session.remove(STORAGE_KEYS.sosFeeActiveTabId);
  }

  async function removeTab(tabId) {
    if (!Number.isInteger(tabId)) return;
    try {
      await chromeApi.tabs.remove(tabId);
    } catch {
      // A tab closed by the browser is already safely gone.
    }
  }

  async function close() {
    const tabId = session?.tabId;
    session = null;
    await removeTab(tabId);
    await clearTabMetadata();
    return { success: true };
  }

  async function sendToCalculator(tabId, message) {
    let lastError = null;
    for (let attempt = 0; attempt < RECEIVER_RETRY_COUNT; attempt += 1) {
      try {
        return await chromeApi.tabs.sendMessage(tabId, message);
      } catch (error) {
        lastError = error;
        if (!receiverNotReady(error)) throw error;
        await sleep(RECEIVER_RETRY_DELAY_MS);
      }
    }
    throw lastError || new Error("The public SOS calculator did not become ready.");
  }

  async function start(mode) {
    if (!VALID_MODES.has(mode)) return safeError("Choose a valid SOS fee quote type.");

    await close();
    try {
      const createdTab = await chromeApi.tabs.create({
        url: sosCalculatorUrlForMode(mode),
        active: false,
      });
      if (!Number.isInteger(createdTab?.id)) {
        return safeError("Michigan SOS could not start the public fee calculator.");
      }

      // Never continue if Chrome did not honor inactive creation. Removing the
      // tab immediately is safer than risking the state page becoming visible.
      if (createdTab.active) {
        await removeTab(createdTab.id);
        return safeError(
          "Michigan SOS could not be opened in the background. No calculator was shown; please try again."
        );
      }

      session = { tabId: createdTab.id, mode };
      await chromeApi.storage.session.set({
        [STORAGE_KEYS.sosFeeActiveTabId]: createdTab.id,
      });

      const response = await sendToCalculator(createdTab.id, {
        type: SOS_FEE_MESSAGES.discover,
      });
      if (!response?.success || response?.calculator?.calculationMode !== mode) {
        await close();
        return safeError(
          "Michigan SOS did not open the requested public calculator. No SOS page was shown; try again shortly."
        );
      }
      return response;
    } catch (error) {
      await close();
      console.error("[SOS fee] could not start calculator:", error);
      return safeError(
        "Michigan SOS could not open the public fee calculator. Check the connection and try again."
      );
    }
  }

  function activeSessionFor(mode) {
    return session && session.mode === mode && Number.isInteger(session.tabId);
  }

  async function updateField(mode, data) {
    if (!VALID_MODES.has(mode) || !validFieldPayload(data)) {
      return safeError("The SOS calculator choice was incomplete.");
    }
    if (!activeSessionFor(mode)) {
      return safeError("Start the official SOS quote before changing calculator choices.");
    }

    try {
      const response = await sendToCalculator(session.tabId, {
        type: SOS_FEE_MESSAGES.applyField,
        data,
      });
      if (!response?.success || response?.calculator?.calculationMode !== mode) {
        return safeError(
          "Michigan SOS could not apply that choice. The official calculator remains in the sidebar only."
        );
      }
      return response;
    } catch (error) {
      console.error("[SOS fee] could not apply calculator field:", error);
      await close();
      return safeError(
        "Michigan SOS lost the calculator session. No SOS page was shown; start the quote again."
      );
    }
  }

  async function calculate(mode) {
    if (!VALID_MODES.has(mode)) return safeError("Choose a valid SOS fee quote type.");
    if (!activeSessionFor(mode)) {
      return safeError("Start the official SOS quote before calculating the fee.");
    }

    try {
      const response = await sendToCalculator(session.tabId, {
        type: SOS_FEE_MESSAGES.calculateInTab,
      });
      if (
        response?.success &&
        response?.quote?.calculationMode === mode &&
        Number.isInteger(response?.quote?.feeCents)
      ) {
        await close();
        return response;
      }

      // The state calculator can ask for an omitted field. Keep the private
      // background tab alive only for that recoverable form-validation state;
      // all other failures close it immediately.
      if (response?.keepOpen && response?.calculator?.calculationMode === mode) {
        return response;
      }

      await close();
      return safeError(
        "Michigan SOS did not return a verified fee. No quote was created; use the unverified manual fallback only if you have a confirmed amount."
      );
    } catch (error) {
      console.error("[SOS fee] calculation failed:", error);
      await close();
      return safeError(
        "Michigan SOS could not calculate the fee. No SOS page was shown; try again or use the unverified manual fallback."
      );
    }
  }

  return {
    start,
    updateField,
    calculate,
    close,
    hasActiveSession: (mode) => activeSessionFor(mode),
  };
}

let singleton = null;

export function getSosFeeRunner() {
  if (!singleton) singleton = createSosFeeRunner(chrome);
  return singleton;
}

/**
 * Worker restarts are a privacy boundary: close only the tab ID that this
 * extension recorded as its own, then discard the metadata. No field values
 * are ever stored in extension storage.
 */
export async function closeInterruptedSosFeeSession(chromeApi = chrome) {
  const stored = await chromeApi.storage.session.get(STORAGE_KEYS.sosFeeActiveTabId);
  const tabId = stored[STORAGE_KEYS.sosFeeActiveTabId];
  if (Number.isInteger(tabId)) {
    try {
      await chromeApi.tabs.remove(tabId);
    } catch {
      // It may already have been closed.
    }
  }
  await chromeApi.storage.session.remove(STORAGE_KEYS.sosFeeActiveTabId);
}
