/**
 * Public Michigan SOS fee-calculator runner.
 *
 * Sidebar edits are entirely local. Only an explicit Calculate action creates
 * one inactive tab in the salesperson's current window and sends one bounded
 * batch of completed choices. It never replaces the active sales tab. A
 * verified result closes the calculator. After bounded failures, the same
 * prefilled page can be shown only by a second explicit salesperson action.
 */

import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import {
  SOS_QUOTE_MODE,
  sosCalculatorUrlForMode,
} from "../sidepanel/sos-fee-quote.js";

const VALID_MODES = new Set(Object.values(SOS_QUOTE_MODE));
const VALID_FIELD_KINDS = new Set(["select", "text", "radio"]);
const RECEIVER_RETRY_DELAY_MS = 200;
const RECEIVER_RETRY_COUNT = 75;
const CALCULATION_ATTEMPTS = 3;

export const SOS_FEE_MESSAGES = Object.freeze({
  calculate: "SOS_FEE_CALCULATE",
  openHandoff: "SOS_FEE_OPEN_HANDOFF",
  close: "SOS_FEE_CLOSE",
  applyAndCalculate: "SOS_APPLY_AND_CALCULATE",
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

function safeError(message, extra = {}) {
  return {
    success: false,
    error:
      message ||
      "Michigan SOS could not complete this fee calculation. Please try again.",
    ...extra,
  };
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

// The official-page capture is supporting evidence, not the result itself. It
// can fail for reasons that say nothing about the fee — html2canvas tainting on
// a cross-origin plate image, or an oversized page exceeding the encode budget.
// Treating a failed screenshot as a failed calculation threw away a correct,
// fully parsed SOS total and pushed the salesperson back onto the state site for
// a number we already had. Every consumer already degrades without the image:
// the print/PDF buttons disable (sidepanel.js) and the evidence section renders
// empty (sos-fee-quote.js), so a quote is verified on the fee alone.
function verifiedQuote(response, mode) {
  return Boolean(
    response?.success &&
      response?.quote?.calculationMode === mode &&
      Number.isInteger(response?.quote?.feeCents)
  );
}

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
      // A browser-closed tab is already safely gone.
    }
  }

  async function close() {
    const tabId = session?.tabId;
    session = null;
    await removeTab(tabId);
    await clearTabMetadata();
    return { success: true };
  }

  async function restoreOriginTab(activeSession = session) {
    if (!Number.isInteger(activeSession?.originTabId)) return;
    try {
      await chromeApi.tabs.update(activeSession.originTabId, { active: true });
    } catch {
      // If the salesperson closed the origin tab, leave Chrome's chosen tab.
    }
  }

  // A remote page should not be able to steal focus from the sales workflow.
  // This guard uses the same Chrome tabs API on Windows, macOS, and ChromeOS.
  chromeApi.tabs.onActivated?.addListener((activeInfo) => {
    const activeSession = session;
    if (!activeSession || activeInfo?.tabId !== activeSession.tabId) return;
    restoreOriginTab(activeSession);
  });

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

  async function calculate(mode, fields) {
    if (!VALID_MODES.has(mode) || !validSosSubmissionFields(fields)) {
      return safeError("Complete the required SOS fee fields before calculating.");
    }

    await close();
    try {
      const [originTab] = await chromeApi.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (!Number.isInteger(originTab?.id) || !Number.isInteger(originTab?.windowId)) {
        return safeError("Chrome could not identify the active sales tab.");
      }
      const createdTab = await chromeApi.tabs.create({
        url: sosCalculatorUrlForMode(mode),
        active: false,
        windowId: originTab.windowId,
      });
      if (!Number.isInteger(createdTab?.id)) {
        return safeError("Michigan SOS could not start the public fee calculator.");
      }
      if (createdTab.active) {
        await restoreOriginTab({ originTabId: originTab.id });
        await removeTab(createdTab.id);
        return safeError(
          "Chrome could not keep the SOS calculator in the background. Nothing was submitted."
        );
      }

      session = {
        tabId: createdTab.id,
        originTabId: originTab.id,
        originWindowId: originTab.windowId,
        mode,
      };
      await chromeApi.storage.session.set({
        [STORAGE_KEYS.sosFeeActiveTabId]: createdTab.id,
      });

      let response = await sendToCalculator(createdTab.id, {
        type: SOS_FEE_MESSAGES.applyAndCalculate,
        data: { mode, fields },
      });
      if (verifiedQuote(response, mode)) {
        await close();
        return response;
      }

      for (let attempt = 1; attempt < CALCULATION_ATTEMPTS; attempt += 1) {
        response = await sendToCalculator(createdTab.id, {
          type: SOS_FEE_MESSAGES.calculateInTab,
        });
        if (verifiedQuote(response, mode)) {
          await close();
          return response;
        }
      }

      return safeError(
        `Michigan SOS did not return a verified total after ${CALCULATION_ATTEMPTS} attempts. Your completed choices remain on the official form for review.`,
        { handoffAvailable: true, attempts: CALCULATION_ATTEMPTS }
      );
    } catch (error) {
      console.error("[SOS fee] background calculation failed:", error);
      if (session?.tabId) {
        return safeError(
          "Michigan SOS could not finish automatically. The partially completed official form is available for review.",
          { handoffAvailable: true }
        );
      }
      await clearTabMetadata();
      return safeError("Michigan SOS could not open the public fee calculator.");
    }
  }

  async function openHandoff(mode) {
    if (
      !VALID_MODES.has(mode) ||
      session?.mode !== mode ||
      !Number.isInteger(session?.tabId)
    ) {
      return safeError("The completed SOS form is no longer available. Calculate again.");
    }
    const tabId = session.tabId;
    const activeSession = session;
    // Disarm the activation guard only for this explicit salesperson handoff.
    // If Chrome cannot activate the tab, remove the exact extension-owned tab
    // instead of leaving a hidden form behind.
    session = null;
    try {
      await chromeApi.tabs.update(tabId, { active: true });
      await clearTabMetadata();
      return { success: true };
    } catch {
      await removeTab(activeSession.tabId);
      await clearTabMetadata();
      return safeError("Chrome could not open the completed SOS form. Calculate again.");
    }
  }

  return {
    calculate,
    openHandoff,
    close,
    hasActiveSession: (mode) =>
      session?.mode === mode && Number.isInteger(session?.tabId),
  };
}

let singleton = null;

export function getSosFeeRunner() {
  if (!singleton) singleton = createSosFeeRunner(chrome);
  return singleton;
}

/** Close only the extension-owned inactive calculator recorded before restart. */
export async function closeInterruptedSosFeeSession(chromeApi = chrome) {
  const stored = await chromeApi.storage.session.get(STORAGE_KEYS.sosFeeActiveTabId);
  const tabId = stored[STORAGE_KEYS.sosFeeActiveTabId];
  if (Number.isInteger(tabId)) {
    try {
      await chromeApi.tabs.remove(tabId);
    } catch {
      // Already closed by Chrome.
    }
  }
  await chromeApi.storage.session.remove(STORAGE_KEYS.sosFeeActiveTabId);
}
