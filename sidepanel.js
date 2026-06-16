/**
 * Compliance Central — Sidebar entry.
 *
 * Wires DOM, events, message routing, and storage listeners.
 * All UI logic lives in src/sidepanel/.
 */

import { $ } from "./src/sidepanel/dom-utils.js";
import { ICONS } from "./src/sidepanel/icons.js";
import { showToast } from "./src/sidepanel/toast.js";
import {
  STORAGE_KEYS,
  SEARCH_STATUS,
  IN_FLIGHT,
} from "./lib/storage-keys.js";
import { MISSING_API_KEY } from "./lib/api-client.js";
import {
  getFormData,
  validateCustomerFields,
  cacheFormData,
  loadCachedFormData,
} from "./src/sidepanel/form.js";
import {
  initDatePickers,
  setDateInputValue,
} from "./src/sidepanel/date-picker.js";
import {
  runOfacCheck,
  runRepeatOffenderCheck,
  runTitleCheck,
  clearTransientScreenshots,
} from "./src/sidepanel/checks.js";
import {
  resetProgress,
  updateProgress,
  setCheckStatus,
  displayResults,
  displayIndividualResult,
  setButtonsDisabled,
  setCardsLoadingState,
  setSdnWarning,
} from "./src/sidepanel/results.js";
import { initSettings } from "./src/sidepanel/settings.js";
import {
  purgeOldHistoryEntries,
  saveToHistory,
  updateHistoryCount,
  populateHistoryModal,
  clearAllHistory,
} from "./src/sidepanel/history.js";
import {
  printOfacReport,
  printCoBuyerOfacReport,
  printRepeatScreenshot,
  printCoBuyerRepeatScreenshot,
  printTitleScreenshot,
  printAllReports,
  downloadOfacReportPDF,
  downloadCoBuyerOfacReportPDF,
  downloadRepeatOffenderPDF,
  downloadCoBuyerRepeatOffenderPDF,
  downloadTitleReportPDF,
  downloadAllReportsPDF,
} from "./src/sidepanel/export.js";
import { showModal, hideModal } from "./src/sidepanel/modals.js";
import { startPairing } from "./src/sidepanel/scan-pairing.js";
import {
  getCurrentResults,
  setCurrentResults,
  loadPersistedResults,
  mergeIntoCurrentResults,
  persistCurrentResults,
  getIsRunning,
  setIsRunning,
} from "./src/sidepanel/state.js";

// ---------- DOM ----------

const elements = {
  // Buyer
  firstName: $("firstName"),
  middleName: $("middleName"),
  lastName: $("lastName"),
  suffix: $("suffix"),
  dob: $("dob"),
  dlnPid: $("dlnPid"),
  tradeVin: $("tradeVin"),

  // Co-Buyer
  hasCoBuyer: $("hasCoBuyer"),
  coBuyerSection: $("coBuyerSection"),
  cbFirstName: $("cbFirstName"),
  cbMiddleName: $("cbMiddleName"),
  cbLastName: $("cbLastName"),
  cbSuffix: $("cbSuffix"),
  cbDob: $("cbDob"),
  cbDlnPid: $("cbDlnPid"),

  // Buttons
  runAllChecksBtn: $("runAllChecksBtn"),
  clearBtn: $("clearBtn"),
  runOfacBtn: $("runOfacBtn"),
  runRepeatOffenderBtn: $("runRepeatOffenderBtn"),
  runTitleBtn: $("runTitleBtn"),

  viewHistoryBtn: $("viewHistoryBtn"),

  // Collapsible customer/vehicle input
  inputPanel: $("inputPanel"),
  inputSummaryBar: $("inputSummaryBar"),
  inputSummaryText: $("inputSummaryText"),
  inputSummaryAction: $("inputSummaryAction"),

  // Phone license-scan pairing
  scanLicenseBtn: $("scanLicenseBtn"),
  scanPairModal: $("scanPairModal"),
  scanPairQr: $("scanPairQr"),
  scanPairStatus: $("scanPairStatus"),
  scanPairCancel: $("scanPairCancel"),
  scanPairCloseX: $("scanPairCloseX"),

  // Progress
  progressSection: $("progressSection"),
  ofacStatus: $("ofacStatus"),
  repeatStatus: $("repeatStatus"),
  titleStatus: $("titleStatus"),
  titleCheckItem: $("titleCheckItem"),
  progressFill: $("progressFill"),
  progressPercent: $("progressPercent"),
  progressSpinner: $("progressSpinner"),
  progressLabel: $("progressLabel"),

  // Results
  resultsSection: $("resultsSection"),
  finalDecision: $("finalDecision"),
  ofacResultCard: $("ofacResultCard"),
  ofacResultStatus: $("ofacResultStatus"),
  ofacResultDetail: $("ofacResultDetail"),
  repeatResultCard: $("repeatResultCard"),
  repeatResultStatus: $("repeatResultStatus"),
  repeatResultDetail: $("repeatResultDetail"),
  titleResultCard: $("titleResultCard"),
  titleResultStatus: $("titleResultStatus"),
  titleResultDetail: $("titleResultDetail"),
  printOfacBtn: $("printOfacBtn"),
  printRepeatBtn: $("printRepeatBtn"),
  printTitleBtn: $("printTitleBtn"),
  downloadOfacBtn: $("downloadOfacBtn"),
  downloadRepeatBtn: $("downloadRepeatBtn"),
  downloadTitleBtn: $("downloadTitleBtn"),
  printAllBtn: $("printAllBtn"),
  downloadPdfBtn: $("downloadPdfBtn"),

  // Co-Buyer results
  coBuyerResultsSection: $("coBuyerResultsSection"),
  cbOfacResultCard: $("cbOfacResultCard"),
  cbOfacResultStatus: $("cbOfacResultStatus"),
  cbOfacResultDetail: $("cbOfacResultDetail"),
  cbRepeatResultCard: $("cbRepeatResultCard"),
  cbRepeatResultStatus: $("cbRepeatResultStatus"),
  cbRepeatResultDetail: $("cbRepeatResultDetail"),
  printCbOfacBtn: $("printCbOfacBtn"),
  printCbRepeatBtn: $("printCbRepeatBtn"),
  downloadCbOfacBtn: $("downloadCbOfacBtn"),
  downloadCbRepeatBtn: $("downloadCbRepeatBtn"),

  // History
  historyCount: $("historyCount"),
  historyModal: $("historyModal"),
  historyList: $("historyList"),
  closeHistoryModal: $("closeHistoryModal"),
  clearAllHistoryBtn: $("clearAllHistoryBtn"),

  // Screenshot modal
  screenshotModal: $("screenshotModal"),
  screenshotTitle: $("screenshotTitle"),
  screenshotImage: $("screenshotImage"),
  closeScreenshotModal: $("closeScreenshotModal"),
  printScreenshotBtn: $("printScreenshotBtn"),
  downloadScreenshotBtn: $("downloadScreenshotBtn"),

  // Loading
  loadingOverlay: $("loadingOverlay"),
  loadingText: $("loadingText"),

  // SDN data warning
  sdnWarning: $("sdnWarning"),

  // Settings
  settingsBtn: $("settingsBtn"),
  settingsModal: $("settingsModal"),
  closeSettingsModal: $("closeSettingsModal"),
  apiKeyInput: $("apiKeyInput"),
  apiKeyStatus: $("apiKeyStatus"),
  saveApiKeyBtn: $("saveApiKeyBtn"),
  clearApiKeyBtn: $("clearApiKeyBtn"),
  toggleApiKeyVisibility: $("toggleApiKeyVisibility"),
  supportEmailLink: $("supportEmailLink"),
};

// Maps IN_FLIGHT keys to their progress-row status indicators.
const IN_FLIGHT_TO_STATUS_EL = {
  [IN_FLIGHT.ofac]: () => elements.ofacStatus,
  [IN_FLIGHT.coBuyerOfac]: () => elements.ofacStatus,
  [IN_FLIGHT.repeatOffender]: () => elements.repeatStatus,
  [IN_FLIGHT.coBuyerRepeatOffender]: () => elements.repeatStatus,
  [IN_FLIGHT.title]: () => elements.titleStatus,
};

// ---------- Icon injection (replace placeholder spans with SVGs) ----------

function applyIcons() {
  const iconMap = [
    ["icon-user", ICONS.user],
    ["icon-users", ICONS.users],
    ["icon-car", ICONS.car],
    ["icon-globe", ICONS.globe],
    ["icon-ban", ICONS.ban],
    ["icon-file", ICONS.fileText],
    ["icon-calendar", ICONS.calendar],
    ["icon-play", ICONS.play],
    ["icon-trash", ICONS.trash],
    ["icon-history", ICONS.history],
    ["icon-printer", ICONS.printer],
    ["icon-download", ICONS.download],
    ["icon-chevron", ICONS.chevron],
    ["icon-settings", ICONS.settings],
    ["icon-key", ICONS.key],
    ["icon-eye", ICONS.eye],
  ];
  for (const [cls, svg] of iconMap) {
    document.querySelectorAll("." + cls).forEach((el) => {
      el.innerHTML = svg;
    });
  }
}

// ---------- Loading overlay ----------

function showLoading(text = "Processing...") {
  if (!elements.loadingOverlay) return;
  if (elements.loadingText) elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
  elements.loadingOverlay?.classList.add("hidden");
}

// ---------- Initialization ----------

document.addEventListener("DOMContentLoaded", () => {
  // Critical path — must run synchronously so the UI is interactive.
  applyIcons();
  initDatePickers([elements.dob, elements.cbDob]);
  initEventListeners();

  initSettings(elements);

  // Independent async tasks — run in parallel, don't block paint.
  loadCachedFormData(elements);
  applyPersistedResults();
  updateHistoryCount(elements.historyCount);
  checkSdnDataStatus();

  // Truly background — purge old history entries when idle.
  const scheduleIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 250));
  scheduleIdle(() => {
    purgeOldHistoryEntries();
  });
});

// ---------- OFAC data freshness banner ----------

const SDN_STALE_DAYS = 7;

async function checkSdnDataStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "getDataStatus" });
    if (!status?.success) return;

    if (status.updateStatus === "error") {
      setSdnWarning(
        elements,
        "OFAC sanctions list failed to refresh. Screening may use older data — open the extension while online to retry."
      );
      return;
    }

    const ageDays = status.lastUpdate
      ? (Date.now() - new Date(status.lastUpdate).getTime()) / 86400000
      : Infinity;

    if (!status.lastUpdate || status.entryCount === 0) {
      // First run: data will download on the first OFAC check; no warning needed.
      setSdnWarning(elements, null);
    } else if (ageDays > SDN_STALE_DAYS) {
      const days = Math.floor(ageDays);
      setSdnWarning(
        elements,
        `OFAC sanctions list is ${days} days old. Reconnect to the internet so it can refresh before screening.`
      );
    } else {
      setSdnWarning(elements, null);
    }
  } catch {
    // Worker not ready / no data yet — leave the banner hidden.
  }
}

async function applyPersistedResults() {
  const persisted = await loadPersistedResults();

  if (persisted.state === "running") {
    setIsRunning(true);
    setButtonsDisabled(elements, true);
    setInputCollapsed(true);
    elements.resultsSection.classList.add("hidden");
    elements.progressSection.classList.remove("hidden");
    updateProgress(elements, persisted.progress);
    const results = persisted.results;
    if (results) {
      const checks = results.checks || {};
      if (checks.ofac) {
        setCheckStatus(elements.ofacStatus, statusForCheck(checks.ofac));
      }
      if (checks.repeatOffender) {
        setCheckStatus(
          elements.repeatStatus,
          statusForCheck(checks.repeatOffender)
        );
      }
      if (checks.title) {
        setCheckStatus(
          elements.titleStatus,
          statusForCheck(checks.title, "warning")
        );
      }
    }

    // Pick up an in-flight indicator on first paint.
    try {
      const { [STORAGE_KEYS.inFlightCheck]: inFlight } =
        await chrome.storage.session.get(STORAGE_KEYS.inFlightCheck);
      applyInFlight(inFlight);
    } catch {
      // ignore
    }
    return;
  }

  if (persisted.state === "individual" && persisted.results) {
    setCurrentResults(persisted.results);
    displayStoredIndividualResult(persisted.results);
    setInputCollapsed(true);
    elements.resultsSection.classList.remove("hidden");
    elements.progressSection.classList.add("hidden");
    return;
  }

  if (persisted.state === "complete" && persisted.results) {
    displayResults(elements, persisted.results);
    setInputCollapsed(true);
    elements.resultsSection.classList.remove("hidden");
    elements.progressSection.classList.add("hidden");
  }
}

function applyInFlight(key) {
  if (!key) return;
  const factory = IN_FLIGHT_TO_STATUS_EL[key];
  if (factory) {
    setCheckStatus(factory(), "running");
  }
}

function statusForCheck(check, failStatus = "fail") {
  if (!check) return "waiting";
  if (check.error || check.status === "error") return "warning";
  return check.passed ? "pass" : failStatus;
}

function displayStoredIndividualResult(results) {
  const checks = results.checks || {};
  if (checks.ofac) {
    displayIndividualResult(elements, "ofac", checks.ofac);
  } else if (checks.repeatOffender) {
    displayIndividualResult(elements, "repeatOffender", checks.repeatOffender);
  } else if (checks.title) {
    displayIndividualResult(elements, "title", checks.title);
  }
}

// ---------- Event wiring ----------

function initEventListeners() {
  elements.runAllChecksBtn.addEventListener("click", handleRunAllChecks);
  elements.clearBtn.addEventListener("click", handleClear);
  elements.runOfacBtn.addEventListener("click", handleRunOfac);
  elements.runRepeatOffenderBtn.addEventListener("click", handleRunRepeatOffender);
  elements.runTitleBtn.addEventListener("click", handleRunTitle);

  elements.tradeVin.addEventListener("input", (e) => {
    elements.runTitleBtn.disabled = e.target.value.trim().length === 0;
  });

  elements.viewHistoryBtn.addEventListener("click", openHistory);
  elements.closeHistoryModal.addEventListener("click", () =>
    hideModal(elements.historyModal)
  );
  elements.clearAllHistoryBtn.addEventListener("click", async () => {
    const cleared = await clearAllHistory(
      elements.historyList,
      elements.historyCount
    );
    if (cleared) showToast("All history has been cleared.", "success");
  });

  elements.historyList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();

    const index = parseInt(btn.getAttribute("data-index"), 10);
    const { [STORAGE_KEYS.complianceHistory]: history = [] } =
      await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
    if (index < 0 || index >= history.length) return;
    const item = history[index];

    if (btn.classList.contains("history-view-btn")) {
      loadHistoryItem(item);
    } else if (btn.classList.contains("history-print-ofac")) {
      withTempResults(item.fullResults, () => printOfacReport(item.fullResults));
    } else if (btn.classList.contains("history-download-ofac")) {
      withTempResults(item.fullResults, () => downloadOfacReportPDF(item.fullResults));
    } else if (btn.classList.contains("history-print-repeat")) {
      withTempResults(item.fullResults, () => printRepeatScreenshot(item.fullResults));
    } else if (btn.classList.contains("history-download-repeat")) {
      withTempResults(item.fullResults, () => downloadRepeatOffenderPDF(item.fullResults));
    } else if (btn.classList.contains("history-print-title")) {
      withTempResults(item.fullResults, () => printTitleScreenshot(item.fullResults));
    } else if (btn.classList.contains("history-download-title")) {
      withTempResults(item.fullResults, () => downloadTitleReportPDF(item.fullResults));
    } else if (btn.classList.contains("history-print-all")) {
      withTempResults(item.fullResults, () => printAllReports(item.fullResults));
    } else if (btn.classList.contains("history-download-all")) {
      withTempResults(item.fullResults, () => downloadAllReportsPDF(item.fullResults));
    }
  });

  // Screenshot modal
  elements.closeScreenshotModal.addEventListener("click", () =>
    hideModal(elements.screenshotModal)
  );
  elements.printScreenshotBtn.addEventListener("click", printScreenshotModal);
  elements.downloadScreenshotBtn.addEventListener("click", downloadScreenshotModal);

  // Per-check print buttons
  elements.printOfacBtn.addEventListener("click", () =>
    printOfacReport(getCurrentResults())
  );
  elements.printRepeatBtn.addEventListener("click", () =>
    printRepeatScreenshot(getCurrentResults())
  );
  elements.printTitleBtn.addEventListener("click", () =>
    printTitleScreenshot(getCurrentResults())
  );

  // Per-check download buttons
  elements.downloadOfacBtn?.addEventListener("click", () =>
    downloadOfacReportPDF(getCurrentResults())
  );
  elements.downloadRepeatBtn?.addEventListener("click", () =>
    downloadRepeatOffenderPDF(getCurrentResults())
  );
  elements.downloadTitleBtn?.addEventListener("click", () =>
    downloadTitleReportPDF(getCurrentResults())
  );

  // Co-Buyer print buttons
  elements.printCbOfacBtn?.addEventListener("click", () =>
    printCoBuyerOfacReport(getCurrentResults())
  );
  elements.printCbRepeatBtn?.addEventListener("click", () =>
    printCoBuyerRepeatScreenshot(getCurrentResults())
  );

  // Co-Buyer download buttons
  elements.downloadCbOfacBtn?.addEventListener("click", () =>
    downloadCoBuyerOfacReportPDF(getCurrentResults())
  );
  elements.downloadCbRepeatBtn?.addEventListener("click", () =>
    downloadCoBuyerRepeatOffenderPDF(getCurrentResults())
  );

  // Bulk actions
  elements.printAllBtn.addEventListener("click", () =>
    printAllReports(getCurrentResults())
  );
  elements.downloadPdfBtn?.addEventListener("click", () =>
    downloadAllReportsPDF(getCurrentResults())
  );

  // Cache form data on change
  const cacheableFields = [
    "firstName", "middleName", "lastName", "suffix", "dob", "dlnPid", "tradeVin",
    "cbFirstName", "cbMiddleName", "cbLastName", "cbSuffix", "cbDob", "cbDlnPid",
  ];
  for (const id of cacheableFields) {
    elements[id]?.addEventListener("change", () => cacheFormData(elements));
  }

  // Co-Buyer toggle
  elements.hasCoBuyer?.addEventListener("change", (e) => {
    elements.coBuyerSection?.classList.toggle("hidden", !e.target.checked);
  });

  // Trade-In collapse — accessible header
  const tradeHeader = $("tradeSectionHeader");
  const tradeContent = $("tradeSectionContent");
  if (tradeHeader && tradeContent) {
    const toggleTrade = () => {
      const isCollapsed = tradeContent.classList.toggle("collapsed");
      tradeHeader.setAttribute("aria-expanded", String(!isCollapsed));
      tradeHeader
        .querySelector(".section-toggle")
        ?.classList.toggle("rotated", !isCollapsed);
    };
    tradeHeader.addEventListener("click", toggleTrade);
    tradeHeader.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleTrade();
      }
    });
  }

  // Summary bar is a two-way toggle: collapse when open, expand when collapsed.
  elements.inputSummaryBar?.addEventListener("click", () => {
    const isOpen =
      elements.inputSummaryBar.getAttribute("aria-expanded") === "true";
    setInputCollapsed(isOpen);
  });

  // Phone license scan: open a pairing session, show the QR, autofill on receipt.
  let cancelPair = null;
  const closeScanPair = () => {
    if (cancelPair) { cancelPair(); cancelPair = null; }
    elements.scanPairModal?.classList.add("hidden");
  };
  elements.scanLicenseBtn?.addEventListener("click", async () => {
    if (elements.scanPairQr) elements.scanPairQr.innerHTML = "";
    if (elements.scanPairStatus)
      elements.scanPairStatus.textContent = "Waiting for your phone…";
    elements.scanPairModal?.classList.remove("hidden");
    try {
      cancelPair = await startPairing(
        elements,
        (url) => {
          if (!window.qrcode || !elements.scanPairQr) return;
          const qr = window.qrcode(0, "M");
          qr.addData(url);
          qr.make();
          elements.scanPairQr.innerHTML = qr.createImgTag(6, 8);
        },
        (result) => {
          if (result.status === "filled") {
            recordScanJurisdiction(result.payload);
            closeScanPair();
            const co = result.payload?.coBuyer ? " + co-buyer" : "";
            showToast(`License scanned — buyer${co} filled.`, "success");
          } else if (result.status === "expired") {
            if (elements.scanPairStatus)
              elements.scanPairStatus.textContent =
                "Pairing expired — close and try again.";
          } else if (result.status === "error") {
            if (elements.scanPairStatus)
              elements.scanPairStatus.textContent =
                "Couldn't read the scan — close and try again.";
          }
        }
      );
    } catch (e) {
      if (elements.scanPairStatus)
        elements.scanPairStatus.textContent =
          "Couldn't start pairing: " + describeError(e);
    }
  });
  elements.scanPairCancel?.addEventListener("click", closeScanPair);
  elements.scanPairCloseX?.addEventListener("click", closeScanPair);

  // A manual edit to an identity field invalidates a scanned jurisdiction flag,
  // so a hand-typed subject is treated as Michigan (assumed), not carried over
  // from a prior scan. (Programmatic autofill sets .value without firing input.)
  ["firstName", "lastName", "dlnPid"].forEach((id) =>
    elements[id]?.addEventListener("input", () => {
      scanJurisdiction.buyer = null;
    })
  );
  ["cbFirstName", "cbLastName", "cbDlnPid"].forEach((id) =>
    elements[id]?.addEventListener("input", () => {
      scanJurisdiction.coBuyer = null;
    })
  );
}

function withTempResults(temp, fn) {
  if (!temp) {
    showToast("No saved results for this entry.", "info");
    return;
  }
  const original = getCurrentResults();
  setCurrentResults(temp);
  try {
    fn();
  } finally {
    setCurrentResults(original);
  }
}

// ---------- Friendly error messages ----------

function isMissingKeyError(err) {
  const msg = err?.message || err?.code || String(err || "");
  return msg === MISSING_API_KEY || err?.code === MISSING_API_KEY;
}

function describeError(err) {
  if (isMissingKeyError(err)) {
    // Near-impossible with the built-in key; kept as a safety net.
    return "This check is temporarily unavailable — please try again in a moment.";
  }
  return err?.message || err?.code || String(err);
}

// ---------- Action handlers ----------

// ---------- Collapsible customer/vehicle input ----------

// Builds the one-line summary shown on the collapsed bar (name · DOB · DLN · VIN).
function buildInputSummary() {
  const form = getFormData(elements);
  // On reload, results restore (applyPersistedResults) can race ahead of the
  // cached-form-data hydration, leaving the inputs momentarily empty. Fall back
  // to the restored results' customer so the summary never renders blank.
  const haveForm =
    form.firstName || form.lastName || form.dob || form.dlnPid || form.tradeVin;
  const c = haveForm ? form : getCurrentResults()?.customer || form;
  const parts = [];
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  if (name) parts.push(name);
  if (c.dob) parts.push("DOB " + c.dob);
  if (c.dlnPid) parts.push("DLN " + c.dlnPid);
  if (c.coBuyer && (c.coBuyer.firstName || c.coBuyer.lastName)) {
    const cbName = [c.coBuyer.firstName, c.coBuyer.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (cbName) parts.push("Co-buyer " + cbName);
  }
  if (c.tradeVin) parts.push("VIN " + c.tradeVin);
  return parts.length ? parts.join("  ·  ") : "Customer details";
}

// Shows/hides the input form via the summary bar, which stays visible as a
// two-way toggle once a run has collapsed it: click to collapse, click to
// expand, as often as needed. Inputs keep their values while hidden, so the
// form still submits and re-collapses on the next run. Reset by handleClear.
function setInputCollapsed(collapsed) {
  if (!elements.inputPanel || !elements.inputSummaryBar) return;
  elements.inputSummaryBar.classList.remove("hidden");
  const chevron = elements.inputSummaryBar.querySelector(".section-toggle");
  if (collapsed) {
    elements.inputSummaryText.textContent = buildInputSummary();
    // If keyboard/SR focus is inside the panel we're about to hide, move it to
    // the (now-visible) summary bar so focus isn't silently lost to <body>.
    const focusInsidePanel = elements.inputPanel.contains(document.activeElement);
    elements.inputPanel.classList.add("hidden");
    elements.inputSummaryBar.setAttribute("aria-expanded", "false");
    if (elements.inputSummaryAction) elements.inputSummaryAction.textContent = "Edit";
    chevron?.classList.remove("rotated");
    if (focusInsidePanel) elements.inputSummaryBar.focus();
  } else {
    elements.inputSummaryText.textContent = "Customer & Vehicle Details";
    elements.inputPanel.classList.remove("hidden");
    elements.inputSummaryBar.setAttribute("aria-expanded", "true");
    if (elements.inputSummaryAction) elements.inputSummaryAction.textContent = "Hide";
    chevron?.classList.add("rotated");
  }
}

// Returns the panel to its pristine first-use state: form open, no summary bar.
function resetInputPanel() {
  if (!elements.inputPanel || !elements.inputSummaryBar) return;
  elements.inputPanel.classList.remove("hidden");
  elements.inputSummaryBar.classList.add("hidden");
  elements.inputSummaryBar.setAttribute("aria-expanded", "false");
}

// Per-person issuing jurisdiction from a phone scan; null = manually entered
// (assumed Michigan). Drives Repeat Offender eligibility in handleRunAllChecks:
// an out-of-state subject (false) can run OFAC but not the MI Repeat Offender.
const scanJurisdiction = { buyer: null, coBuyer: null };
function recordScanJurisdiction(payload) {
  scanJurisdiction.buyer = payload?.buyer ? !!payload.buyer.isMichigan : null;
  scanJurisdiction.coBuyer = payload?.coBuyer ? !!payload.coBuyer.isMichigan : null;
}

async function handleRunAllChecks() {
  const customerData = getFormData(elements);
  // From a phone scan: true=MI, false=out-of-state, null=manual (assume MI).
  // Drives Repeat Offender eligibility in the worker.
  customerData.buyerIsMichigan = scanJurisdiction.buyer;
  customerData.coBuyerIsMichigan = scanJurisdiction.coBuyer;
  if (!validateCustomerFields(customerData)) return;
  if (getIsRunning()) return;

  setIsRunning(true);
  setButtonsDisabled(elements, true);
  await clearTransientScreenshots();

  const hasTrade = !!customerData.tradeVin;

  elements.resultsSection.classList.add("hidden");
  elements.progressSection.classList.remove("hidden");

  resetProgress(elements);
  if (!hasTrade) {
    elements.titleCheckItem.style.opacity = "0.5";
    setCheckStatus(elements.titleStatus, "skipped");
  } else {
    elements.titleCheckItem.style.opacity = "1";
    setCheckStatus(elements.titleStatus, "waiting");
  }

  await cacheFormData(elements);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_ALL_CHECKS",
      data: { customer: customerData, hasTrade },
    });
    if (!response?.success) {
      throw new Error("Failed to start background checks");
    }
  } catch (e) {
    console.error("Start Check Error:", e);
    showToast("Could not start checks: " + describeError(e), "error");
    setIsRunning(false);
    setButtonsDisabled(elements, false);
    elements.progressSection.classList.add("hidden");
  }
}

async function handleRunOfac() {
  const customerData = getFormData(elements);
  if (!customerData.firstName || !customerData.lastName) {
    showToast("Name is required for OFAC check", "warning");
    return;
  }
  setButtonsDisabled(elements, true);
  showLoading("Running OFAC screening...");
  try {
    const result = await runOfacCheck(customerData);
    const results = mergeIntoCurrentResults(customerData, "ofac", result, {
      replace: true,
      runType: "individual",
      runLabel: "OFAC Only",
    });
    displayIndividualResult(elements, "ofac", result);
    setInputCollapsed(true);
    await persistCurrentResults();
    await saveToHistory(results);
    await updateHistoryCount(elements.historyCount);
  } catch (error) {
    showToast("OFAC check failed: " + describeError(error), "error");
  } finally {
    hideLoading();
    setButtonsDisabled(elements, false);
  }
}

async function handleRunRepeatOffender() {
  const customerData = getFormData(elements);
  if (!validateCustomerFields(customerData)) return;
  // The Michigan Repeat Offender check only applies to a Michigan license/ID;
  // running it on a scanned out-of-state subject would be a misleading "pass".
  if (scanJurisdiction.buyer === false) {
    showToast(
      "Repeat Offender check applies only to Michigan licenses/IDs — skipped for an out-of-state subject.",
      "info"
    );
    return;
  }
  setButtonsDisabled(elements, true);
  showLoading("Checking Repeat Offender status...");
  await clearTransientScreenshots();
  try {
    const result = await runRepeatOffenderCheck(customerData);
    const results = mergeIntoCurrentResults(
      customerData,
      "repeatOffender",
      result,
      {
        replace: true,
        runType: "individual",
        runLabel: "Repeat Offender",
      }
    );
    displayIndividualResult(elements, "repeatOffender", result);
    setInputCollapsed(true);
    await persistCurrentResults();
    await saveToHistory(results);
    await updateHistoryCount(elements.historyCount);
  } catch (error) {
    showToast("Repeat Offender check failed: " + describeError(error), "error");
  } finally {
    hideLoading();
    setButtonsDisabled(elements, false);
  }
}

async function handleRunTitle() {
  const customerData = getFormData(elements);
  if (!customerData.tradeVin) {
    showToast("VIN is required for title check", "warning");
    return;
  }
  setButtonsDisabled(elements, true);
  showLoading("Checking Title & Lien status...");
  await clearTransientScreenshots();
  try {
    const result = await runTitleCheck(customerData);
    const results = mergeIntoCurrentResults(customerData, "title", result, {
      replace: true,
      runType: "individual",
      runLabel: "Title/Lien",
    });
    displayIndividualResult(elements, "title", result);
    setInputCollapsed(true);
    await persistCurrentResults();
    await saveToHistory(results);
    await updateHistoryCount(elements.historyCount);
  } catch (error) {
    showToast("Title check failed: " + describeError(error), "error");
  } finally {
    hideLoading();
    setButtonsDisabled(elements, false);
  }
}

function handleClear() {
  setIsRunning(false);
  setButtonsDisabled(elements, false);
  resetInputPanel();
  scanJurisdiction.buyer = null;
  scanJurisdiction.coBuyer = null;
  chrome.storage.session.set({
    [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.idle,
    [STORAGE_KEYS.searchProgress]: 0,
    [STORAGE_KEYS.inFlightCheck]: null,
  });

  // Clear buyer
  elements.firstName.value = "";
  elements.middleName.value = "";
  elements.lastName.value = "";
  elements.suffix.value = "";
  setDateInputValue(elements.dob, "");
  elements.dlnPid.value = "";
  elements.tradeVin.value = "";

  // Clear co-buyer
  if (elements.cbFirstName) elements.cbFirstName.value = "";
  if (elements.cbMiddleName) elements.cbMiddleName.value = "";
  if (elements.cbLastName) elements.cbLastName.value = "";
  if (elements.cbSuffix) elements.cbSuffix.value = "";
  setDateInputValue(elements.cbDob, "");
  if (elements.cbDlnPid) elements.cbDlnPid.value = "";
  if (elements.hasCoBuyer) elements.hasCoBuyer.checked = false;
  elements.coBuyerSection?.classList.add("hidden");

  chrome.storage.session.remove([
    STORAGE_KEYS.cachedFormData,
    STORAGE_KEYS.cachedAt,
    STORAGE_KEYS.currentResults,
    STORAGE_KEYS.searchStatus,
    STORAGE_KEYS.searchProgress,
    STORAGE_KEYS.inFlightCheck,
    STORAGE_KEYS.lastError,
    STORAGE_KEYS.repeatOffenderScreenshot,
    STORAGE_KEYS.coBuyerRepeatOffenderScreenshot,
    STORAGE_KEYS.titleScreenshot,
    STORAGE_KEYS.lastResult,
  ]);

  setCurrentResults(null);
  chrome.storage.local.remove([
    STORAGE_KEYS.currentResults,
    STORAGE_KEYS.searchStatus,
    STORAGE_KEYS.searchProgress,
    STORAGE_KEYS.inFlightCheck,
    STORAGE_KEYS.lastError,
    STORAGE_KEYS.repeatOffenderScreenshot,
    STORAGE_KEYS.coBuyerRepeatOffenderScreenshot,
    STORAGE_KEYS.titleScreenshot,
    STORAGE_KEYS.lastResult,
  ]);
  chrome.action.setBadgeText({ text: "" });

  elements.resultsSection.classList.add("hidden");
  elements.progressSection.classList.add("hidden");
  setCardsLoadingState(elements, false);

  resetProgress(elements);
  elements.runTitleBtn.disabled = true;
  elements.firstName.focus();
}

// ---------- History helpers ----------

async function openHistory() {
  await populateHistoryModal(elements.historyList);
  showModal(elements.historyModal);
}

function loadHistoryItem(item) {
  hideModal(elements.historyModal);

  if (item.fullResults) setCurrentResults(item.fullResults);

  if (item.fullResults?.customer) {
    const cust = item.fullResults.customer;
    elements.firstName.value = cust.firstName || "";
    elements.middleName.value = cust.middleName || "";
    elements.lastName.value = cust.lastName || "";
    elements.suffix.value = cust.suffix || "";
    setDateInputValue(elements.dob, cust.dob || "");
    elements.dlnPid.value = cust.dlnPid || "";
    elements.tradeVin.value = cust.tradeVin || "";

    if (elements.hasCoBuyer) {
      elements.hasCoBuyer.checked = !!cust.hasCoBuyer;
      elements.hasCoBuyer.dispatchEvent(new Event("change"));
    }
    if (cust.hasCoBuyer && cust.coBuyer) {
      elements.cbFirstName.value = cust.coBuyer.firstName || "";
      elements.cbMiddleName.value = cust.coBuyer.middleName || "";
      elements.cbLastName.value = cust.coBuyer.lastName || "";
      elements.cbSuffix.value = cust.coBuyer.suffix || "";
      setDateInputValue(elements.cbDob, cust.coBuyer.dob || "");
      elements.cbDlnPid.value = cust.coBuyer.dlnPid || "";
    }
  } else if (item.customer) {
    const names = item.customer.split(" ");
    if (names.length > 0) elements.firstName.value = names[0];
    if (names.length > 1)
      elements.lastName.value = names[names.length - 1];
    if (item.vin) elements.tradeVin.value = item.vin;
  }

  if (item.fullResults) {
    if (item.fullResults.runType === "individual") {
      displayStoredIndividualResult(item.fullResults);
    } else {
      displayResults(elements, item.fullResults);
    }
    elements.progressSection.classList.add("hidden");
    elements.resultsSection.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    showToast(
      "Form populated from history. Run All Checks to refresh results.",
      "info",
      7000
    );
  }
}

// ---------- Screenshot modal ----------

function printScreenshotModal() {
  const src = elements.screenshotImage.src;
  if (!src) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Popup blocked. Allow popups for this page.", "warning");
    return;
  }
  printWindow.document.write(
    `<html><head><title>Compliance Screenshot</title></head><body style="margin:0;padding:20px;"><img src="${src}" style="max-width:100%;"/></body></html>`
  );
  printWindow.document.close();
  // Wait for the (large base64) image to render before printing, or the
  // printed page can come out blank.
  const img = printWindow.document.querySelector("img");
  const doPrint = () => {
    printWindow.focus();
    printWindow.print();
  };
  if (img && !img.complete) {
    img.onload = doPrint;
    img.onerror = doPrint;
    setTimeout(doPrint, 2000); // fallback if neither event fires
  } else {
    setTimeout(doPrint, 150);
  }
}

function downloadScreenshotModal() {
  const src = elements.screenshotImage.src;
  if (!src) return;
  const link = document.createElement("a");
  link.download = `compliance-screenshot-${Date.now()}.png`;
  link.href = src;
  link.click();
}

// ---------- Storage listener (worker -> UI sync) ----------

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "session") return;

  // Each branch independently try/catch'd so one bad update doesn't break others.

  if (changes[STORAGE_KEYS.searchProgress]) {
    try {
      updateProgress(elements, changes[STORAGE_KEYS.searchProgress].newValue || 0);
    } catch (e) {
      console.error("[Sidepanel] progress update failed:", e);
    }
  }

  if (changes[STORAGE_KEYS.inFlightCheck]) {
    try {
      const key = changes[STORAGE_KEYS.inFlightCheck].newValue;
      if (key) applyInFlight(key);
    } catch (e) {
      console.error("[Sidepanel] in-flight update failed:", e);
    }
  }

  if (changes[STORAGE_KEYS.currentResults]?.newValue) {
    try {
      const next = changes[STORAGE_KEYS.currentResults].newValue;
      setCurrentResults(next);
      const checks = next.checks || {};
      if (checks.ofac) {
        setCheckStatus(elements.ofacStatus, statusForCheck(checks.ofac));
      }
      if (checks.repeatOffender) {
        setCheckStatus(
          elements.repeatStatus,
          statusForCheck(checks.repeatOffender)
        );
      }
      if (checks.title) {
        setCheckStatus(
          elements.titleStatus,
          statusForCheck(checks.title, "warning")
        );
      }
    } catch (e) {
      console.error("[Sidepanel] currentResults update failed:", e);
    }
  }

  if (changes[STORAGE_KEYS.searchStatus]) {
    try {
      handleSearchStatusChange(changes);
    } catch (e) {
      console.error("[Sidepanel] status update failed:", e);
    }
  }
});

function handleSearchStatusChange(changes) {
  const status = changes[STORAGE_KEYS.searchStatus].newValue;

  if (status === SEARCH_STATUS.running) {
    setIsRunning(true);
    setButtonsDisabled(elements, true);
    setInputCollapsed(true);
    elements.resultsSection.classList.add("hidden");
    elements.progressSection.classList.remove("hidden");
    setCardsLoadingState(elements, true);

    for (const el of [
      elements.ofacResultStatus,
      elements.repeatResultStatus,
      elements.titleResultStatus,
    ]) {
      if (el) {
        el.textContent = "Pending...";
        el.className = "result-status";
      }
    }
    for (const el of [
      elements.ofacResultDetail,
      elements.repeatResultDetail,
      elements.titleResultDetail,
    ]) {
      if (el) el.textContent = "";
    }
    if (elements.finalDecision) elements.finalDecision.innerHTML = "";
    return;
  }

  if (status === SEARCH_STATUS.complete) {
    setIsRunning(false);
    setButtonsDisabled(elements, false);
    setInputCollapsed(true);
    setCardsLoadingState(elements, false);

    const results = getCurrentResults();
    if (results) {
      try {
        displayResults(elements, results);
        saveToHistory(results).then(() => updateHistoryCount(elements.historyCount));
      } catch (e) {
        console.error("Display/save error:", e);
      }
    }
    setTimeout(() => {
      elements.progressSection.classList.add("hidden");
      elements.resultsSection.classList.remove("hidden");
    }, 350);
    return;
  }

  if (status === SEARCH_STATUS.error) {
    setIsRunning(false);
    setButtonsDisabled(elements, false);
    resetInputPanel();
    setCardsLoadingState(elements, false);
    const errorMsg = changes[STORAGE_KEYS.lastError]?.newValue;
    showToast("Error: " + (describeError({ message: errorMsg }) || "An error occurred."), "error");
    return;
  }

  // idle
  if (status === SEARCH_STATUS.idle) {
    setIsRunning(false);
    setButtonsDisabled(elements, false);
    setCardsLoadingState(elements, false);
  }
}
