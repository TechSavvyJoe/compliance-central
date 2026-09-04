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
  acceptsRunStatusUpdate,
  createRunId,
  isCurrentRunState,
  createOperationFence,
} from "./lib/run-fence.js";
import {
  getFormData,
  applyCustomerData,
  validateCustomerFields,
  planChecksForData,
  cacheFormData,
  loadCachedFormData,
  extractScanJurisdiction,
} from "./src/sidepanel/form.js";
import {
  initDatePickers,
  setDateInputValue,
  maskDateText,
} from "./src/sidepanel/date-picker.js";
import {
  finalDecisionForResults,
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
  syncHistoryActionState,
  populateHistoryModal,
  clearAllHistory,
  findAgingDeals,
  isPlateQuoteStale,
} from "./src/sidepanel/history.js";
import { downloadAuditCsv } from "./src/sidepanel/audit-csv.js";
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
  downloadSosOfficialEvidencePDF,
  printHtmlDocument,
  downloadAllReportPDFs,
  availableReportItems,
} from "./src/sidepanel/export.js";
import { showModal, hideModal } from "./src/sidepanel/modals.js";
import {
  startPairing,
  cancelPairing,
  renderPairingQr,
} from "./src/sidepanel/scan-pairing.js";
import {
  getCurrentResults,
  setCurrentResults,
  loadPersistedResults,
  mergeIntoCurrentResults,
  persistCurrentResults,
  getIsRunning,
  setIsRunning,
} from "./src/sidepanel/state.js";
import {
  SOS_QUOTE_MODE,
  SOS_QUOTE_SOURCE,
  clearSosFeeQuote,
  createCalculatedQuote,
  createSosFeeQuotePrintHTML,
  createSosOfficialEvidencePrintHTML,
  loadSosFeeQuote,
  quoteStatusText,
  registrationTermText,
  sanitizeDealerLogo,
  formatMoney,
  saveSosFeeQuote,
  sourceLabel,
} from "./src/sidepanel/sos-fee-quote.js";
import {
  bodyOptionsForVehicle,
  buildSosSubmission,
  localSosVinFields,
  plateDesignByValue,
  plateDesignOptionsForType,
  plateOptionsForUse,
  useOptionsForVehicle,
  validateSosLocalValues,
} from "./src/sidepanel/sos-local-form.js";
import {
  lookupVin,
  makeSosVinSuggestions,
  normalizeVinLookupInput,
  vinLookupSummary,
} from "./src/sidepanel/vin-lookup.js";
import { titlePresentation } from "./src/sidepanel/title-format.js";

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
  newCustomerBtn: $("newCustomerBtn"),
  runOfacBtn: $("runOfacBtn"),
  runRepeatOffenderBtn: $("runRepeatOffenderBtn"),
  runTitleBtn: $("runTitleBtn"),

  // Session-only SOS registration fee quote
  calculateSosFeeBtn: $("calculateSosFeeBtn"),
  printSosQuoteBtn: $("printSosQuoteBtn"),
  printSosCalculationBtn: $("printSosCalculationBtn"),
  downloadSosCalculationPdfBtn: $("downloadSosCalculationPdfBtn"),
  clearSosQuoteBtn: $("clearSosQuoteBtn"),
  sosVinLookupInput: $("sosVinLookupInput"),
  useTradeVinBtn: $("useTradeVinBtn"),
  useTradeVinValue: $("useTradeVinValue"),
  lookupSosVinBtn: $("lookupSosVinBtn"),
  checkSosLienBtn: $("checkSosLienBtn"),
  sosVinLookupStatus: $("sosVinLookupStatus"),
  sosLienStatus: $("sosLienStatus"),
  sosWorkspaceStatus: $("sosWorkspaceStatus"),
  sosReadiness: $("sosReadiness"),
  sosProgress: $("sosProgress"),
  sosProgressElapsed: $("sosProgressElapsed"),
  sosWorkspaceStatusText: $("sosWorkspaceStatusText"),
  sosQuoteStatus: $("sosQuoteStatus"),
  sosQuoteHeadline: $("sosQuoteHeadline"),
  sosQuoteTotal: $("sosQuoteTotal"),
  sosQuoteTerm: $("sosQuoteTerm"),
  sosQuoteSource: $("sosQuoteSource"),
  sosNewPlateFields: $("sosNewPlateFields"),
  sosTransferFields: $("sosTransferFields"),
  sosVehicleType: $("sosVehicleType"),
  sosBodyStyle: $("sosBodyStyle"),
  sosVehicleUse: $("sosVehicleUse"),
  sosFuelType: $("sosFuelType"),
  sosModelYear: $("sosModelYear"),
  sosMsrp: $("sosMsrp"),
  sosBusinessRegistration: $("sosBusinessRegistration"),
  sosOwnerBirthdate: $("sosOwnerBirthdate"),
  sosOwnerBirthdateControl: $("sosOwnerBirthdateControl"),
  sosPlateType: $("sosPlateType"),
  sosPlateDesign: $("sosPlateDesign"),
  sosPlateDesignControl: $("sosPlateDesignControl"),
  sosPlateEligibility: $("sosPlateEligibility"),
  sosPurchaseDate: $("sosPurchaseDate"),
  sosTransferPlateNumber: $("sosTransferPlateNumber"),
  sosPlatePreview: $("sosPlatePreview"),
  sosPlatePreviewImage: $("sosPlatePreviewImage"),
  sosPlatePreviewLabel: $("sosPlatePreviewLabel"),
  sosPlatePreviewUnavailable: $("sosPlatePreviewUnavailable"),
  sosPlateViewer: $("sosPlateViewer"),
  sosPlateViewerImage: $("sosPlateViewerImage"),
  sosPlateViewerName: $("sosPlateViewerName"),
  sosPlateViewerNote: $("sosPlateViewerNote"),
  sosPlateViewerStage: $("sosPlateViewerStage"),
  closeSosPlateViewer: $("closeSosPlateViewer"),
  sosPlateZoomOut: $("sosPlateZoomOut"),
  sosPlateZoomReset: $("sosPlateZoomReset"),
  sosPlateZoomIn: $("sosPlateZoomIn"),

  viewHistoryBtn: $("viewHistoryBtn"),

  // Collapsible customer/vehicle input
  firstRunHero: $("firstRunHero"),
  inputPanel: $("inputPanel"),
  inputSummaryBar: $("inputSummaryBar"),
  inputSummaryText: $("inputSummaryText"),
  inputSummaryAction: $("inputSummaryAction"),

  // Out-of-state jurisdiction badges
  buyerJurisdictionTag: $("buyerJurisdictionTag"),
  coBuyerJurisdictionTag: $("coBuyerJurisdictionTag"),

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
  ofacResultTimestamp: $("ofacResultTimestamp"),
  ofacTriagePanel: $("ofacTriagePanel"),
  clearOfacFalsePositiveBtn: $("clearOfacFalsePositiveBtn"),
  confirmOfacMatchBtn: $("confirmOfacMatchBtn"),
  repeatResultCard: $("repeatResultCard"),
  repeatResultStatus: $("repeatResultStatus"),
  repeatResultDetail: $("repeatResultDetail"),
  repeatResultTimestamp: $("repeatResultTimestamp"),
  titleResultCard: $("titleResultCard"),
  titleResultStatus: $("titleResultStatus"),
  titleResultDetail: $("titleResultDetail"),
  titleResultTimestamp: $("titleResultTimestamp"),
  printOfacBtn: $("printOfacBtn"),
  printRepeatBtn: $("printRepeatBtn"),
  printTitleBtn: $("printTitleBtn"),
  downloadOfacBtn: $("downloadOfacBtn"),
  downloadRepeatBtn: $("downloadRepeatBtn"),
  downloadTitleBtn: $("downloadTitleBtn"),
  printAllBtn: $("printAllBtn"),
  printAllLabel: $("printAllLabel"),
  downloadPdfBtn: $("downloadPdfBtn"),
  downloadAllPdfsBtn: $("downloadAllPdfsBtn"),
  downloadAllPdfsLabel: $("downloadAllPdfsLabel"),
  selectAllReports: $("selectAllReports"),
  reportSelectionStatus: $("reportSelectionStatus"),
  reviewGuidancePanel: $("reviewGuidancePanel"),
  downloadEvidenceBtn: $("downloadEvidenceBtn"),
  printEvidenceBtn: $("printEvidenceBtn"),
  completedBuyerSummary: $("completedBuyerSummary"),
  completedCoBuyerSummary: $("completedCoBuyerSummary"),
  completedTradeSummary: $("completedTradeSummary"),
  editCompletedBuyerBtn: $("editCompletedBuyerBtn"),
  editCompletedCoBuyerBtn: $("editCompletedCoBuyerBtn"),
  editCompletedTradeBtn: $("editCompletedTradeBtn"),

  // Co-Buyer results
  coBuyerResultsSection: $("coBuyerResultsSection"),
  cbOfacResultCard: $("cbOfacResultCard"),
  cbOfacResultStatus: $("cbOfacResultStatus"),
  cbOfacResultDetail: $("cbOfacResultDetail"),
  cbOfacResultTimestamp: $("cbOfacResultTimestamp"),
  cbOfacTriagePanel: $("cbOfacTriagePanel"),
  clearCbOfacFalsePositiveBtn: $("clearCbOfacFalsePositiveBtn"),
  confirmCbOfacMatchBtn: $("confirmCbOfacMatchBtn"),
  cbRepeatResultCard: $("cbRepeatResultCard"),
  cbRepeatResultStatus: $("cbRepeatResultStatus"),
  cbRepeatResultDetail: $("cbRepeatResultDetail"),
  cbRepeatResultTimestamp: $("cbRepeatResultTimestamp"),
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
  exportAuditLogBtn: $("exportAuditLogBtn"),
  rescreenReminderToggle: $("rescreenReminderToggle"),
  dealershipNameInput: $("dealershipNameInput"),
  dataUseDetails: $("dataUseDetails"),
  historyListStatus: $("historyListStatus"),
  retentionNotice: $("retentionNotice"),
  retentionNoticeAckBtn: $("retentionNoticeAckBtn"),
  dealershipLogoInput: $("dealershipLogoInput"),
  removeDealershipLogoBtn: $("removeDealershipLogoBtn"),
  dealershipLogoStatus: $("dealershipLogoStatus"),
  rescreenBanner: $("rescreenBanner"),
  rescreenBannerTitle: $("rescreenBannerTitle"),
  rescreenBannerDetail: $("rescreenBannerDetail"),

  // Loading
  loadingOverlay: $("loadingOverlay"),
  loadingText: $("loadingText"),
  loadingDetail: $("loadingDetail"),

  // SDN data warning
  sdnWarning: $("sdnWarning"),

  // Settings
  settingsBtn: $("settingsBtn"),
  settingsModal: $("settingsModal"),
  closeSettingsModal: $("closeSettingsModal"),
  serviceStatus: $("serviceStatus"),
  settingsClearHistoryBtn: $("settingsClearHistoryBtn"),
  settingsPrivacyLink: $("settingsPrivacyLink"),
  settingsVersion: $("settingsVersion"),
  supportEmailLink: $("supportEmailLink"),

  // Claude Design workspace navigation
  screeningTabBtn: $("screeningTabBtn"),
  sosTabBtn: $("sosTabBtn"),
  historySearchInput: $("historySearchInput"),
  historyAgingOnly: $("historyAgingOnly"),
};

const reportSelectionInputs = Array.from(
  document.querySelectorAll('.report-selection-item input[type="checkbox"]')
);

function getSelectedReportKeys() {
  return reportSelectionInputs
    .filter((input) => !input.disabled && input.checked)
    .map((input) => input.value);
}

function updateReportSelectionState() {
  const available = reportSelectionInputs.filter((input) => !input.disabled);
  const selected = available.filter((input) => input.checked);
  const count = selected.length;
  const total = available.length;
  const allSelected = total > 0 && count === total;

  if (elements.selectAllReports) {
    elements.selectAllReports.checked = allSelected;
    elements.selectAllReports.indeterminate = count > 0 && count < total;
    elements.selectAllReports.disabled = total === 0;
  }
  if (elements.reportSelectionStatus) {
    elements.reportSelectionStatus.textContent = `${count} of ${total} document${
      total === 1 ? "" : "s"
    } selected`;
  }
  if (elements.printAllLabel) {
    elements.printAllLabel.textContent = allSelected ? "Print All" : "Print Selected";
  }
  if (elements.downloadAllPdfsLabel) {
    elements.downloadAllPdfsLabel.textContent = allSelected
      ? "Download all PDFs"
      : "Download Selected PDFs";
  }
  for (const button of [
    elements.printAllBtn,
    elements.downloadPdfBtn,
    elements.downloadAllPdfsBtn,
  ]) {
    if (button) button.disabled = count === 0;
  }
}

function syncReportSelection(currentResults) {
  const availableKeys = new Set(
    availableReportItems(currentResults).map((item) => item.key)
  );
  for (const input of reportSelectionInputs) {
    const available = availableKeys.has(input.value);
    input.disabled = !available;
    input.checked = available;
    input.closest(".report-selection-item")?.classList.toggle("hidden", !available);
  }
  updateReportSelectionState();
}

async function resolveOfacTriage(checkKey, disposition) {
  const results = getCurrentResults();
  const ofac = results?.checks?.[checkKey];
  if (!ofac || ofac.passed !== false) return;

  ofac.disposition = disposition;
  ofac.reviewedAt = new Date().toISOString();
  // The shared verdict, not the base one: this value is persisted to session
  // before displayResults recomputes, so skipping the incomplete-checks
  // downgrade here left the stored copy APPROVED while both surfaces said
  // REVIEW for the same record.
  results.finalDecision = finalDecisionForResults(results);
  setCurrentResults(results);
  await persistCurrentResults();
  displayResults(elements, results);
  syncReportSelection(results);
  await saveToHistory(results);
  await refreshHistoryCountAndActions();
  showToast(
    disposition === "confirmed_match"
      ? "OFAC match confirmed — delivery is blocked."
      : "Potential OFAC match recorded as a false positive.",
    disposition === "confirmed_match" ? "error" : "success"
  );
}

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
    ["icon-check", ICONS.check],
    ["icon-info", ICONS.info],
  ];
  for (const [cls, svg] of iconMap) {
    document.querySelectorAll("." + cls).forEach((el) => {
      el.innerHTML = svg;
    });
  }
}

// ---------- Loading overlay ----------

let loadingTimer = null;

// These checks drive a real browser against a state website, so the wait is
// several seconds and varies with how the portal is behaving — a measured 7s
// for Title & Lien in one recorded session. A spinner that never changes gives
// a reader no way to tell "working" from "hung", so the elapsed count follows
// the same honest treatment the plate calculator already uses: no invented
// percentage, just the seconds actually spent, and an explanation once the
// wait is long enough to worry about.
function showLoading(text = "Processing...") {
  if (!elements.loadingOverlay) return;
  clearInterval(loadingTimer);
  loadingTimer = null;
  if (elements.loadingText) elements.loadingText.textContent = text;
  if (elements.loadingDetail) elements.loadingDetail.textContent = "";
  elements.loadingOverlay.classList.remove("hidden");

  const started = Date.now();
  const tick = () => {
    const secs = Math.round((Date.now() - started) / 1000);
    if (!elements.loadingDetail) return;
    if (secs >= 10) {
      elements.loadingDetail.textContent = `${secs}s \u00b7 the state site is slow right now, still working`;
    } else if (secs >= 3) {
      elements.loadingDetail.textContent = `${secs}s`;
    }
  };
  tick();
  loadingTimer = setInterval(tick, 1000);
}

function hideLoading() {
  clearInterval(loadingTimer);
  loadingTimer = null;
  if (elements.loadingDetail) elements.loadingDetail.textContent = "";
  elements.loadingOverlay?.classList.add("hidden");
}

// ---------- Workspace navigation ----------

const WORKSPACES = new Set(["screening", "sos", "history"]);

function activateWorkspace(name, { focusTab = false } = {}) {
  if (!WORKSPACES.has(name)) return;

  document.querySelectorAll("[data-workspace-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.workspacePanel !== name;
  });

  document.querySelectorAll('.workspace-tabs [role="tab"]').forEach((tab) => {
    const active = tab.dataset.workspaceTarget === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focusTab) tab.focus();
  });

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

/**
 * Refresh the History count and the controls that act on it.
 *
 * "Clear local history" and "Export CSV" stayed fully enabled with nothing to
 * clear or export, so the only way to find out the list was empty was to press
 * one and watch nothing happen.
 */
async function refreshHistoryCountAndActions() {
  await updateHistoryCount(elements.historyCount);
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
    syncHistoryActionState((stored[STORAGE_KEYS.complianceHistory] || []).length, {
      clearBtn: elements.clearAllHistoryBtn,
      exportBtn: elements.exportAuditLogBtn,
    });
  } catch {
    // Storage being unavailable is not a reason to disable a control the
    // salesperson may still need; leave both as they are.
  }
}

function filterHistoryWorkspace(query = "") {
  const normalized = query.trim().toLowerCase();
  const agingOnly = Boolean(elements.historyAgingOnly?.checked);
  const items = Array.from(elements.historyList?.querySelectorAll(".history-item") || []);
  let visible = 0;
  for (const item of items) {
    const matchesQuery =
      !normalized || item.textContent.toLowerCase().includes(normalized);
    const matchesAge = !agingOnly || Boolean(item.querySelector(".history-age.is-aging"));
    const matches = matchesQuery && matchesAge;
    item.classList.toggle("hidden", !matches);
    if (matches) visible += 1;
  }
  let empty = elements.historyList?.querySelector(".history-filter-empty");
  if (normalized && items.length && visible === 0) {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "history-empty history-filter-empty";
      empty.innerHTML =
        "<strong>No matching customer records</strong><span>Try a customer name, vehicle, date, or outcome.</span>";
      elements.historyList.append(empty);
    }
  } else {
    empty?.remove();
  }

  // The list itself is no longer a live region, so announce the count instead
  // of the entire contents of every record.
  if (elements.historyListStatus) {
    elements.historyListStatus.textContent = items.length
      ? `${visible} of ${items.length} saved ${
          items.length === 1 ? "record" : "records"
        } shown`
      : "No saved records";
  }
}

function initWorkspaceNavigation() {
  activateWorkspace("screening");

  // A roving tabindex puts every inactive tab at -1, so without arrow keys the
  // Plate Calculator and History tabs could not be reached from the keyboard
  // at all — two thirds of the app was mouse-only. This is the ARIA tablist
  // pattern: Left/Right move and activate, Home/End jump to the ends.
  const tabStrip = document.querySelector(".workspace-tabs");
  tabStrip?.addEventListener("keydown", (event) => {
    const tabs = [...tabStrip.querySelectorAll('[role="tab"]')];
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;

    let next = null;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;

    event.preventDefault();
    const target = tabs[next]?.dataset.workspaceTarget;
    if (target) activateWorkspace(target, { focusTab: true });
  });

  elements.screeningTabBtn?.addEventListener("click", () =>
    activateWorkspace("screening")
  );
  elements.sosTabBtn?.addEventListener("click", () => activateWorkspace("sos"));

  elements.historySearchInput?.addEventListener("input", (event) =>
    filterHistoryWorkspace(event.target.value)
  );
  elements.historyAgingOnly?.addEventListener("change", () =>
    filterHistoryWorkspace(elements.historySearchInput?.value || "")
  );
}

// ---------- Initialization ----------

document.addEventListener("DOMContentLoaded", () => {
  // Critical path — must run synchronously so the UI is interactive.
  applyIcons();
  initWorkspaceNavigation();
  initDatePickers([elements.dob, elements.cbDob]);
  initEventListeners();
  renderSosWorkspace();
  syncFirstRunPresentation();

  initSettings(elements, {
    onClearHistory: () =>
      clearAllHistory(elements.historyList, elements.historyCount),
  });

  // Independent async tasks — run in parallel, don't block paint.
  restoreCachedForm();
  applyPersistedResults();
  restoreSosFeeQuote();
  refreshHistoryCountAndActions();
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
    activeUiRunId = persisted.runId;
    setIsRunning(true);
    setButtonsDisabled(elements, true);
    setInputCollapsed(true, persisted.results?.customer);
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
    syncReportSelection(persisted.results);
    setInputCollapsed(true, persisted.results.customer);
    elements.resultsSection.classList.remove("hidden");
    elements.progressSection.classList.add("hidden");
    return;
  }

  if (persisted.state === "complete" && persisted.results) {
    displayResults(elements, persisted.results);
    syncReportSelection(persisted.results);
    setInputCollapsed(true, persisted.results.customer);
    activeUiRunId = null;
    elements.resultsSection.classList.remove("hidden");
    elements.progressSection.classList.add("hidden");
  }
}

// ---------- SOS fee quote ----------

let currentSosFeeQuote = null;
let pendingVinDecode = null;
let sosWorkspaceBusy = false;
let sosLienCheckBusy = false;

function selectedSosQuoteMode() {
  return (
    document.querySelector('input[name="sosQuoteMode"]:checked')?.value ||
    SOS_QUOTE_MODE.newPlate
  );
}

function setSosQuoteMode(mode) {
  const input = document.querySelector(
    `input[name="sosQuoteMode"][value="${mode}"]`
  );
  if (input) input.checked = true;
}

function setSosWorkspaceStatus(message, tone = "") {
  const host = elements.sosWorkspaceStatus;
  if (!host) return;
  // The message used to be a line of muted grey text, so a failure mid-quote
  // read the same as the idle prompt. Each state now looks like what it is.
  const text = elements.sosWorkspaceStatusText || host;
  text.textContent = message;
  host.classList.toggle("is-error", tone === "error");
  host.classList.toggle("is-busy", tone === "busy");
  host.classList.toggle("is-ok", tone === "ok");
  // A failure is the one state a salesperson must not scroll past.
  if (tone === "error") host.setAttribute("role", "alert");
  else host.setAttribute("role", "status");
}

function selectedRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function replaceSosOptions(select, options, preferredValue = "") {
  if (!select) return;
  const current = preferredValue || select.value;
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    })
  );
  const available = options.some(([value]) => value === current);
  if (available) select.value = current;
}

function localSosValues() {
  return {
    mode: selectedSosQuoteMode(),
    vehicleType: elements.sosVehicleType?.value || "",
    bodyStyle: elements.sosBodyStyle?.value || "",
    vehicleUse: elements.sosVehicleUse?.value || "",
    fuelType: elements.sosFuelType?.value || "",
    modelYear: elements.sosModelYear?.value.trim() || "",
    msrp: elements.sosMsrp?.value.trim() || "",
    firstTitle: selectedRadioValue("sosFirstTitle"),
    businessRegistration: selectedRadioValue("sosBusinessRegistration"),
    ownerBirthdate: elements.sosOwnerBirthdate?.value.trim() || "",
    plateType: elements.sosPlateType?.value || "",
    plateDesign: elements.sosPlateDesign?.value || "",
    recreationPassport: selectedRadioValue("sosRecreationPassport"),
    purchaseDate: elements.sosPurchaseDate?.value.trim() || "",
    transferPlateNumber: elements.sosTransferPlateNumber?.value.trim() || "",
    transferChangePlate: selectedRadioValue("sosTransferChangePlate"),
    transferAlreadyOwn: selectedRadioValue("sosTransferAlreadyOwn"),
  };
}

function clearSosValidation() {
  document
    .querySelectorAll("#sosNewPlateFields [aria-invalid], #sosTransferFields [aria-invalid]")
    .forEach((control) => control.removeAttribute("aria-invalid"));
  document.querySelectorAll(".sos-field-error").forEach((n) => n.remove());
}

function showSosValidation(errors, { focusFirst = true } = {}) {
  clearSosValidation();
  for (const error of errors) {
    const control = document.getElementById(error.id);
    if (!control) continue;
    control.setAttribute("aria-invalid", "true");
    // Every wrong field says what is wrong with it. The status bar used to
    // carry errors[0].message alone, so a form with three problems showed
    // three red borders and one explanation, and you fixed them one
    // calculate at a time.
    const field = control.closest(".sos-control") || control.parentElement;
    if (!field || field.querySelector(".sos-field-error")) continue;
    const note = document.createElement("small");
    note.className = "sos-field-error";
    note.id = `${control.id}-error`;
    note.textContent = error.message;
    field.append(note);
    const described = (control.getAttribute("aria-describedby") || "")
      .split(/\s+/).filter(Boolean).filter((x) => x !== note.id);
    control.setAttribute("aria-describedby", [...described, note.id].join(" "));
  }
  if (focusFirst) document.getElementById(errors[0]?.id)?.focus?.();
}

// True once Calculate has been pressed: before that, an untouched form should
// not be scolded for fields the salesperson has not reached yet.
let sosSubmitAttempted = false;

/** Live "what is left" count, from the same validator the submit uses. */
function renderSosReadiness() {
  const el = elements.sosReadiness;
  if (!el) return;
  if (sosWorkspaceBusy) { el.textContent = ""; return; }
  let errors;
  try {
    errors = validateSosLocalValues(localSosValues()) || [];
  } catch {
    errors = [];
  }
  const n = errors.length;
  // Once a fee has been calculated there is nothing left to be ready for, and
  // "Ready to calculate." printed under a finished total reads as if the run
  // never happened. The status bar above already reports the outcome.
  if (n === 0 && currentSosFeeQuote) { el.textContent = ""; el.classList.remove("is-ready"); return; }
  el.textContent = n === 0 ? "Ready to calculate." : `${n} detail${n === 1 ? "" : "s"} left`;
  el.classList.toggle("is-ready", n === 0);
  if (sosSubmitAttempted) showSosValidation(errors, { focusFirst: false });
}

let sosProgressTimer = null;

/** Honest progress: the run reports no stages, so show that it is moving and
 *  how long it has taken — not a fabricated percentage. */
function setSosProgress(on) {
  const box = elements.sosProgress;
  if (!box) return;
  clearInterval(sosProgressTimer);
  sosProgressTimer = null;
  box.classList.toggle("hidden", !on);
  if (!on) return;
  const started = Date.now();
  const tick = () => {
    const secs = Math.round((Date.now() - started) / 1000);
    if (elements.sosProgressElapsed) {
      elements.sosProgressElapsed.textContent = secs >= 3 ? ` \u00b7 ${secs}s` : "";
    }
  };
  tick();
  sosProgressTimer = setInterval(tick, 1000);
}

function canCheckSosLien(value = elements.sosVinLookupInput?.value || "") {
  const vin = normalizeVinLookupInput(value);
  return Boolean(vin && vin.length === 17 && !vin.includes("*"));
}

function syncSosLienCheckButton() {
  if (!elements.checkSosLienBtn) return;
  elements.checkSosLienBtn.disabled = sosLienCheckBusy || !canCheckSosLien();
}

function handleSosVinInput() {
  // A decoded response belongs only to the exact text that was looked up.
  // Never apply stale suggestions after the salesperson edits the VIN.
  pendingVinDecode = null;
  if (elements.sosVinLookupStatus) {
    elements.sosVinLookupStatus.textContent = "";
  }
  if (elements.sosLienStatus) {
    elements.sosLienStatus.textContent = "";
    elements.sosLienStatus.className = "sos-lien-status";
  }
  syncSosLienCheckButton();
}

const SOS_CALCULATOR_IMAGE_HOST = "dsvsesvc.sos.state.mi.us";
const SOS_PLATE_IMAGE_HOSTS = new Set(["www.michigan.gov", SOS_CALCULATOR_IMAGE_HOST]);
const SOS_PLATE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
let sosPlatePreviewLoadToken = 0;
let sosPlatePreviewObjectUrl = null;
let sosPlateViewerObjectUrl = null;
let sosPlatePreviewAbortController = null;
let sosPlateViewerAbortController = null;

function abortSosPlateLoad(kind) {
  const controller =
    kind === "preview" ? sosPlatePreviewAbortController : sosPlateViewerAbortController;
  controller?.abort();
  if (kind === "preview") sosPlatePreviewAbortController = null;
  else sosPlateViewerAbortController = null;
}

function releaseSosPlateObjectUrl(kind) {
  const current = kind === "preview" ? sosPlatePreviewObjectUrl : sosPlateViewerObjectUrl;
  if (current) URL.revokeObjectURL(current);
  if (kind === "preview") sosPlatePreviewObjectUrl = null;
  else sosPlateViewerObjectUrl = null;
}

function disposeSosPlateImages() {
  sosPlatePreviewLoadToken += 1;
  sosPlateViewerLoadToken += 1;
  abortSosPlateLoad("preview");
  abortSosPlateLoad("viewer");
  releaseSosPlateObjectUrl("preview");
  releaseSosPlateObjectUrl("viewer");
}

async function materializeSosPlateImage(source, { signal } = {}) {
  const url = new URL(source);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !SOS_PLATE_IMAGE_HOSTS.has(url.hostname)
  ) {
    throw new Error("Unexpected plate image origin.");
  }
  if (url.hostname !== SOS_CALCULATOR_IMAGE_HOST) {
    return { source: url.href, objectUrl: null };
  }
  if (
    url.search ||
    url.hash ||
    !/^\/TAP\/Image\/ENG\/[A-Za-z0-9._-]+$/.test(url.pathname)
  ) {
    throw new Error("Unexpected SOS plate image URL.");
  }

  // Calculator images are same-site subresources. Fetch only this public,
  // allowlisted asset without credentials, then keep its blob in memory.
  const response = await fetch(url.href, {
    cache: "force-cache",
    credentials: "omit",
    redirect: "error",
    signal,
  });
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;
  if (
    !response.ok ||
    !["image/jpeg", "image/png", "image/webp"].some((type) =>
      contentType.startsWith(type)
    ) ||
    (contentLengthHeader && (!Number.isFinite(contentLength) || contentLength < 1)) ||
    contentLength > SOS_PLATE_IMAGE_MAX_BYTES ||
    !response.body
  ) {
    throw new Error("SOS plate image could not be verified.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > SOS_PLATE_IMAGE_MAX_BYTES) {
        await reader.cancel("SOS plate image exceeded the safe in-memory limit.");
        throw new Error("SOS plate image exceeded the safe in-memory limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!receivedBytes) throw new Error("SOS plate image was empty.");
  const blob = new Blob(chunks, { type: contentType.split(";", 1)[0] });
  const objectUrl = URL.createObjectURL(blob);
  return { source: objectUrl, objectUrl };
}

function renderSosPlatePreview() {
  const loadToken = ++sosPlatePreviewLoadToken;
  abortSosPlateLoad("preview");
  releaseSosPlateObjectUrl("preview");
  const localDesign = plateDesignByValue(elements.sosPlateDesign?.value);
  const quotePreview =
    currentSosFeeQuote?.source === SOS_QUOTE_SOURCE.calculated
      ? currentSosFeeQuote.platePreviewUrl
      : null;
  const previewUrl = localDesign?.imageUrl || quotePreview || null;
  const fullPreviewUrl = quotePreview || localDesign?.fullImageUrl || previewUrl;
  const shouldShow =
    selectedSosQuoteMode() === SOS_QUOTE_MODE.newPlate &&
    Boolean(previewUrl);
  const shouldShowUnavailable =
    selectedSosQuoteMode() === SOS_QUOTE_MODE.newPlate &&
    Boolean(localDesign) &&
    !previewUrl;
  if (elements.sosPlatePreview) elements.sosPlatePreview.hidden = !shouldShow;
  if (elements.sosPlatePreviewUnavailable) {
    elements.sosPlatePreviewUnavailable.hidden = !shouldShowUnavailable;
  }
  if (elements.sosPlatePreviewImage) {
    if (shouldShow) {
      elements.sosPlatePreviewImage.alt = `${localDesign?.label || "Michigan"} official plate design artwork`;
      if (new URL(previewUrl).hostname === SOS_CALCULATOR_IMAGE_HOST) {
        const abortController = new AbortController();
        sosPlatePreviewAbortController = abortController;
        elements.sosPlatePreviewImage.removeAttribute("src");
        elements.sosPlatePreview?.classList.add("is-loading");
        void materializeSosPlateImage(previewUrl, { signal: abortController.signal })
          .then(({ source, objectUrl }) => {
            if (loadToken !== sosPlatePreviewLoadToken) {
              if (objectUrl) URL.revokeObjectURL(objectUrl);
              return;
            }
            sosPlatePreviewAbortController = null;
            const decodedImage = new Image();
            decodedImage.referrerPolicy = "no-referrer";
            decodedImage.onload = () => {
              if (loadToken !== sosPlatePreviewLoadToken) {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                return;
              }
              sosPlatePreviewObjectUrl = objectUrl;
              elements.sosPlatePreviewImage.src = source;
              elements.sosPlatePreview?.classList.remove("is-loading");
            };
            decodedImage.onerror = () => {
              if (objectUrl) URL.revokeObjectURL(objectUrl);
              if (loadToken !== sosPlatePreviewLoadToken) return;
              elements.sosPlatePreview?.classList.remove("is-loading");
              if (elements.sosPlatePreview) elements.sosPlatePreview.hidden = true;
              if (elements.sosPlatePreviewUnavailable) {
                elements.sosPlatePreviewUnavailable.hidden = false;
              }
            };
            decodedImage.src = source;
          })
          .catch(() => {
            if (loadToken !== sosPlatePreviewLoadToken) return;
            sosPlatePreviewAbortController = null;
            elements.sosPlatePreview?.classList.remove("is-loading");
            if (elements.sosPlatePreview) elements.sosPlatePreview.hidden = true;
            if (elements.sosPlatePreviewUnavailable) {
              elements.sosPlatePreviewUnavailable.hidden = false;
            }
          });
      } else {
        elements.sosPlatePreviewImage.src = previewUrl;
        elements.sosPlatePreview?.classList.remove("is-loading");
      }
    } else {
      elements.sosPlatePreviewImage.removeAttribute("src");
      elements.sosPlatePreview?.classList.remove("is-loading");
    }
  }
  if (elements.sosPlatePreviewLabel) {
    const plateTypeLabel = elements.sosPlateType?.selectedOptions?.[0]?.textContent?.trim();
    elements.sosPlatePreviewLabel.textContent =
      localDesign?.label || `${plateTypeLabel || "Plate"} official result`;
  }
  if (elements.sosPlatePreview) {
    const label = elements.sosPlatePreviewLabel?.textContent || "selected Michigan plate";
    if (fullPreviewUrl) {
      elements.sosPlatePreview.dataset.fullImageUrl = fullPreviewUrl;
    } else {
      delete elements.sosPlatePreview.dataset.fullImageUrl;
    }
    elements.sosPlatePreview.setAttribute(
      "aria-label",
      `Expand the official image for ${label}`
    );
  }
}

const SOS_PLATE_ZOOM_MIN = 0.75;
const SOS_PLATE_ZOOM_MAX = 2.5;
const SOS_PLATE_ZOOM_STEP = 0.25;
let sosPlateZoom = 1;
let sosPlatePan = null;
let sosPlateViewerLoadToken = 0;

function setSosPlateZoom(nextZoom) {
  sosPlateZoom = Math.min(
    SOS_PLATE_ZOOM_MAX,
    Math.max(SOS_PLATE_ZOOM_MIN, Number(nextZoom) || 1)
  );
  elements.sosPlateViewerImage?.style.setProperty(
    "--sos-plate-zoom-width",
    `${Math.round(sosPlateZoom * 100)}%`
  );
  if (elements.sosPlateZoomReset) {
    elements.sosPlateZoomReset.textContent = `${Math.round(sosPlateZoom * 100)}%`;
  }
  if (elements.sosPlateZoomOut) {
    elements.sosPlateZoomOut.disabled = sosPlateZoom <= SOS_PLATE_ZOOM_MIN;
  }
  if (elements.sosPlateZoomIn) {
    elements.sosPlateZoomIn.disabled = sosPlateZoom >= SOS_PLATE_ZOOM_MAX;
  }
  elements.sosPlateViewerStage?.classList.toggle("is-zoomed", sosPlateZoom > 1);
}

function closeSosPlateViewer() {
  hideModal(elements.sosPlateViewer);
}

function openSosPlatePreview() {
  const source = elements.sosPlatePreviewImage?.getAttribute("src");
  if (!source || !elements.sosPlateViewerImage) {
    showToast("Plate artwork is not available for this selection.", "error");
    return;
  }

  const label = elements.sosPlatePreviewLabel?.textContent?.trim() || "Michigan plate";
  const fullSource = elements.sosPlatePreview?.dataset.fullImageUrl || source;
  const loadToken = ++sosPlateViewerLoadToken;
  abortSosPlateLoad("viewer");
  releaseSosPlateObjectUrl("viewer");
  // Reuse the thumbnail's already-loaded official URL so expansion is
  // immediate, then upgrade it in place to Michigan's verified larger
  // rendition without opening a popup or delaying the viewer.
  elements.sosPlateViewerImage.src = source;
  elements.sosPlateViewerImage.alt = `${label} official Michigan SOS plate artwork`;
  if (elements.sosPlateViewerName) elements.sosPlateViewerName.textContent = label;
  if (elements.sosPlateViewerNote) {
    elements.sosPlateViewerNote.textContent =
      fullSource === source
        ? "The number shown is a sample. Personalized text is not pictured."
        : "Loading the full-size design…";
  }
  elements.sosPlateViewerStage?.scrollTo({ top: 0, left: 0 });
  setSosPlateZoom(1);
  showModal(elements.sosPlateViewer, {
    focusEl: elements.closeSosPlateViewer,
    onClose: () => {
      sosPlateViewerLoadToken += 1;
      abortSosPlateLoad("viewer");
      releaseSosPlateObjectUrl("viewer");
      sosPlatePan = null;
      elements.sosPlateViewerStage?.classList.remove("is-panning");
      setSosPlateZoom(1);
    },
  });

  if (fullSource !== source) {
    const abortController = new AbortController();
    sosPlateViewerAbortController = abortController;
    void materializeSosPlateImage(fullSource, { signal: abortController.signal })
      .then(({ source: displaySource, objectUrl }) => {
        if (
          loadToken !== sosPlateViewerLoadToken ||
          elements.sosPlateViewer?.classList.contains("hidden")
        ) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return;
        }
        sosPlateViewerAbortController = null;
        const fullImage = new Image();
        fullImage.referrerPolicy = "no-referrer";
        fullImage.onload = () => {
          if (loadToken !== sosPlateViewerLoadToken) {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            return;
          }
          releaseSosPlateObjectUrl("viewer");
          sosPlateViewerObjectUrl = objectUrl;
          elements.sosPlateViewerImage.src = displaySource;
          if (elements.sosPlateViewerNote) {
            elements.sosPlateViewerNote.textContent =
              "The number shown is a sample. Personalized text is not pictured.";
          }
        };
        fullImage.onerror = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          if (loadToken !== sosPlateViewerLoadToken) return;
          if (elements.sosPlateViewerNote) {
            elements.sosPlateViewerNote.textContent =
              "The number shown is a sample. Personalized text is not pictured.";
          }
        };
        fullImage.src = displaySource;
      })
      .catch(() => {
        if (loadToken !== sosPlateViewerLoadToken) return;
        sosPlateViewerAbortController = null;
        if (elements.sosPlateViewerNote) {
          elements.sosPlateViewerNote.textContent =
            "The number shown is a sample. Personalized text is not pictured.";
        }
      });
  }
}

function beginSosPlatePan(event) {
  if (sosPlateZoom <= 1 || !elements.sosPlateViewerStage) return;
  // The second press of a double-click must not be swallowed. This handler
  // calls preventDefault() to stop the drag selecting the image, and that also
  // suppresses the dblclick that resets the zoom — so once you were zoomed in,
  // double-clicking to get back out silently stopped working and the only way
  // down was the zoom buttons.
  if (event.detail >= 2) return;
  sosPlatePan = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: elements.sosPlateViewerStage.scrollLeft,
    top: elements.sosPlateViewerStage.scrollTop,
  };
  elements.sosPlateViewerStage.setPointerCapture?.(event.pointerId);
  elements.sosPlateViewerStage.classList.add("is-panning");
  event.preventDefault();
}

function moveSosPlatePan(event) {
  if (!sosPlatePan || sosPlatePan.pointerId !== event.pointerId) return;
  elements.sosPlateViewerStage.scrollLeft =
    sosPlatePan.left - (event.clientX - sosPlatePan.x);
  elements.sosPlateViewerStage.scrollTop =
    sosPlatePan.top - (event.clientY - sosPlatePan.y);
}

function endSosPlatePan(event) {
  if (!sosPlatePan || sosPlatePan.pointerId !== event.pointerId) return;
  try {
    elements.sosPlateViewerStage?.releasePointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture may already be released if the gesture leaves Chrome.
  }
  elements.sosPlateViewerStage?.classList.remove("is-panning");
  sosPlatePan = null;
}

function renderSosFeeQuote() {
  const quote = currentSosFeeQuote;
  if (elements.sosQuoteStatus) elements.sosQuoteStatus.textContent = quoteStatusText(quote);
  // The total and what it buys lead; the itemised add-ons stay below as
  // reference rather than competing with the number a customer is quoted.
  if (elements.sosQuoteHeadline) {
    elements.sosQuoteHeadline.classList.toggle("hidden", !quote);
    if (quote) {
      elements.sosQuoteTotal.textContent = formatMoney(quote.feeCents);
      const term = registrationTermText(quote);
      elements.sosQuoteTerm.textContent = term || "Term not stated by SOS";
      elements.sosQuoteTerm.classList.toggle("is-unstated", !term);
    }
  }
  if (elements.sosQuoteSource) {
    elements.sosQuoteSource.textContent = quote
      ? sourceLabel(quote.source)
      : sosWorkspaceBusy
        ? "Checking SOS"
        : "Not calculated yet";
    elements.sosQuoteSource.classList.toggle(
      "is-calculated",
      quote?.source === SOS_QUOTE_SOURCE.calculated
    );
    elements.sosQuoteSource.classList.toggle(
      "is-busy",
      sosWorkspaceBusy
    );
  }
  if (elements.printSosQuoteBtn) elements.printSosQuoteBtn.disabled = !quote;
  if (elements.printSosCalculationBtn) {
    elements.printSosCalculationBtn.disabled = !quote?.officialPageImage;
  }
  if (elements.downloadSosCalculationPdfBtn) {
    elements.downloadSosCalculationPdfBtn.disabled = !quote?.officialPageImage;
  }
  if (quote) setSosQuoteMode(quote.mode);
  renderSosPlatePreview();
  // The readiness line now depends on whether a quote exists, so it has to be
  // repainted wherever the quote changes — clearing one, or having it
  // invalidated by an edit — not only on keystrokes into the form.
  renderSosReadiness();
}

async function restoreSosFeeQuote() {
  try {
    currentSosFeeQuote = await loadSosFeeQuote();
    renderSosFeeQuote();
  } catch (error) {
    console.error("Could not restore SOS fee quote:", error);
  }
}

function renderSosWorkspace() {
  if (elements.calculateSosFeeBtn) {
    elements.calculateSosFeeBtn.disabled = sosWorkspaceBusy;
    elements.calculateSosFeeBtn.textContent = sosWorkspaceBusy
      ? "Checking SOS…"
      : "Calculate SOS fee";
  }
  // A plate transfer needs the same vehicle details as a new plate — the state
  // asks about the vehicle being purchased either way — so the shared workbench
  // stays visible and only the plate-specific controls drop out.
  const newPlate = selectedSosQuoteMode() === SOS_QUOTE_MODE.newPlate;
  if (elements.sosNewPlateFields) elements.sosNewPlateFields.hidden = false;
  document
    .querySelectorAll("[data-new-plate-only]")
    .forEach((node) => {
      node.hidden = !newPlate;
    });
  if (newPlate) syncSosOwnerBirthdateVisibility();
  if (elements.sosTransferFields) {
    elements.sosTransferFields.hidden = selectedSosQuoteMode() !== SOS_QUOTE_MODE.plateTransfer;
  }
  renderSosFeeQuote();
}

// Abandoning an in-flight quote is what keeps a late backend response from
// repainting a fee for choices the salesperson has already changed.
async function cancelSosFeeRequest() {
  try {
    await chrome.runtime.sendMessage({ type: "SOS_FEE_CANCEL", data: {} });
  } catch {
    // The worker may already have settled or dropped the request.
  }
}

/**
 * A business registration expires on a fixed schedule, so the state only asks
 * for a birthdate when the owner is a person. Hiding the field for a business
 * keeps it out of both the form and validation.
 */
/**
 * Format a plain date input as it is typed, and once more when focus leaves so
 * a pasted value is tidied too. The SOS workbench fields have no picker shell,
 * so without this a typed "08081985" stayed raw and failed validation.
 */
function attachDateMask(input) {
  if (!input) return;
  const apply = () => {
    const masked = maskDateText(input.value);
    if (input.value !== masked) input.value = masked;
  };
  input.addEventListener("input", apply);
  input.addEventListener("blur", apply);
}

/**
 * Michigan bases the fee on the purchase date and falls back to today when the
 * field is blank. Writing today's date in makes the quote say which date it
 * used, rather than leaving the salesperson to infer it from an empty box.
 */
function prefillSosPurchaseDate() {
  const input = elements.sosPurchaseDate;
  if (!input || input.value.trim()) return;
  const now = new Date();
  input.value = [
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    now.getFullYear(),
  ].join("/");
}

/**
 * Return the plate-calculator workbench to its first-use state.
 *
 * These inputs used to survive Clear entirely, so the next customer inherited
 * the previous deal's model year, MSRP and plate choice — quietly quoting them
 * a fee for a car that was not theirs. Both Clear controls call this so the
 * Screening and Plate pages agree on what "cleared" means.
 */
function resetSosLocalForm() {
  for (const input of [
    elements.sosModelYear,
    elements.sosMsrp,
    elements.sosPurchaseDate,
    elements.sosTransferPlateNumber,
    elements.sosOwnerBirthdate,
    elements.sosVinLookupInput,
  ]) {
    if (input) input.value = "";
  }
  if (elements.sosOwnerBirthdate) delete elements.sosOwnerBirthdate.dataset.touched;

  // Radios go back to the defaults the markup ships with.
  for (const [name, value] of [
    ["sosFirstTitle", "no"],
    ["sosBusinessRegistration", "no"],
    ["sosRecreationPassport", "no"],
    ["sosTransferChangePlate", "no"],
    ["sosTransferAlreadyOwn", "no"],
  ]) {
    document
      .querySelectorAll(`input[name="${name}"]`)
      .forEach((radio) => {
        radio.checked = radio.value === value;
      });
  }

  if (elements.sosVehicleType) elements.sosVehicleType.value = "Passenger";
  // Rebuild the dependent option lists, then re-apply the defaults that depend
  // on them, so the workbench is usable immediately rather than half-empty.
  syncSosLocalDependencies({ resetDependentValues: true });
  syncSosOwnerBirthdateVisibility();
  prefillSosOwnerBirthdate();
  prefillSosPurchaseDate();
}

/**
 * Show the pending-delivery reminder as something the salesperson can act on.
 *
 * This used to be a toast that vanished after seven seconds and could not be
 * clicked, so a deal needing a re-screen before delivery was announced once to
 * whoever happened to be looking and then lost. The banner stays until the work
 * is done and opens the affected records.
 */
function renderRescreenBanner(aging = [], staleQuote = false) {
  const banner = elements.rescreenBanner;
  if (!banner) return;
  rescreenBannerTarget = aging.length ? "history" : staleQuote ? "sos" : null;
  if (!rescreenBannerTarget) {
    banner.classList.add("hidden");
    return;
  }

  const parts = [];
  if (aging.length) {
    parts.push(
      `${aging.length} screening${aging.length === 1 ? "" : "s"} needing a re-run`
    );
  }
  // A plate quote from an earlier day was priced from that day's purchase date,
  // so it can be wrong today rather than merely stale.
  if (staleQuote) parts.push("a plate fee quoted on an earlier date");

  elements.rescreenBannerTitle.textContent = aging.length
    ? "Re-screen before delivery"
    : "Recalculate the plate fee";
  elements.rescreenBannerDetail.textContent = `${parts.join(" and ")}. ${
    rescreenBannerTarget === "history"
      ? "Open the saved records to re-run them."
      : "Michigan prices from the purchase date."
  }`;
  banner.classList.remove("hidden");
}

const CONFIG_VIN_LENGTH = 17;
// Shown on the customer worksheet so the sheet is identifiably the dealership's.
// The dealership that appears on a printed customer worksheet is a per-install
// setting. It used to be this one dealership's name and logo compiled into the
// package, so every installer of a publicly listed extension handed customers a
// worksheet branded for someone else's store — and carrying that store's
// manufacturer trade dress.

async function loadDealerName() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.dealershipName);
    return String(stored[STORAGE_KEYS.dealershipName] || "").trim().slice(0, 80);
  } catch {
    return "";
  }
}

/**
 * The packaged dealership mark, inlined for print.
 *
 * A printed sheet is rendered in about:blank, an iframe, or the print runner
 * depending on which path succeeds, and a chrome-extension:// URL does not
 * resolve in all three. Inlining sidesteps that entirely, and it is read once
 * and cached. A failure here must never block the quote from printing, so it
 * resolves to an empty string and the sheet falls back to the name alone.
 */
/** Inline any packaged or allowlisted image for print. Empty string on failure. */
async function inlineImageForPrint(url) {
  try {
    const response = await fetch(url, { cache: "force-cache", credentials: "omit" });
    if (!response.ok) return "";
    const blob = await response.blob();
    if (!/^image\//.test(blob.type) || blob.size > 4_000_000) return "";
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

/**
 * The selected plate artwork, inlined for print.
 *
 * Left as a state URL it simply did not appear on the printed sheet: the print
 * window opens before a remote image can load, so the customer got a broken
 * frame where their plate should be.
 */
async function loadPlateImageForPrint(quote) {
  const source = quote?.platePreviewUrl;
  if (!source) return "";
  try {
    // Reuse the existing origin check rather than trusting the stored value.
    const { source: safe } = await materializeSosPlateImage(source);
    return await inlineImageForPrint(safe);
  } catch {
    return "";
  }
}

async function loadDealerLogo() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.dealershipLogo);
    return sanitizeDealerLogo(stored[STORAGE_KEYS.dealershipLogo] || "");
  } catch {
    return "";
  }
}

const MAX_DEALER_LOGO_BYTES = 512 * 1024;

/** Read a chosen image as a data URL so the printed sheet never fetches it. */
function readLogoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("unreadable"));
    reader.readAsDataURL(file);
  });
}
let rescreenBannerTarget = null;

/** Take the salesperson to whatever the reminder is about. */
function openRescreenTarget() {
  if (rescreenBannerTarget === "history") {
    if (elements.historyAgingOnly) elements.historyAgingOnly.checked = true;
    activateWorkspace("history", { focusTab: true });
    filterHistoryWorkspace(elements.historySearchInput?.value || "");
    return;
  }
  if (rescreenBannerTarget === "sos") activateWorkspace("sos", { focusTab: true });
}

/**
 * Offer the trade-in VIN the screening already captured.
 *
 * The plate calculator and the trade-in sit on different tabs, so the same
 * seventeen characters were being retyped by hand — the one input in this panel
 * where a typo is both easy and silent.
 */
function syncUseTradeVinButton() {
  const button = elements.useTradeVinBtn;
  if (!button) return;
  const vin = (elements.tradeVin?.value || "").trim().toUpperCase();
  const current = (elements.sosVinLookupInput?.value || "").trim().toUpperCase();
  // Nothing to offer if there is no trade, or it is already in the field.
  const offer = vin.length === CONFIG_VIN_LENGTH && vin !== current;
  button.classList.toggle("hidden", !offer);
  if (offer && elements.useTradeVinValue) elements.useTradeVinValue.textContent = vin;
}

function applyTradeVinToPlateTab() {
  const vin = (elements.tradeVin?.value || "").trim().toUpperCase();
  if (!elements.sosVinLookupInput || vin.length !== CONFIG_VIN_LENGTH) return;
  elements.sosVinLookupInput.value = vin;
  elements.sosVinLookupInput.dispatchEvent(new Event("input", { bubbles: true }));
  syncUseTradeVinButton();
  showToast("Trade-in VIN copied from the screening.", "success");
}

function syncSosOwnerBirthdateVisibility() {
  const business = selectedRadioValue("sosBusinessRegistration") === "yes";
  if (elements.sosOwnerBirthdateControl) {
    elements.sosOwnerBirthdateControl.hidden = business;
  }
}

/**
 * The buyer's date of birth is already captured on the Screening tab, and a
 * Michigan passenger plate expires on that same birthday. Prefill it rather
 * than making the salesperson retype it, but never overwrite a value they have
 * already edited here — the registered owner is not always the buyer.
 */
function prefillSosOwnerBirthdate() {
  const input = elements.sosOwnerBirthdate;
  if (!input || input.value.trim() || input.dataset.touched === "true") return;
  const dob = String(elements.dob?.value || "").trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) input.value = dob;
}

function syncSosLocalDependencies({ resetDependentValues = false } = {}) {
  const vehicleType = elements.sosVehicleType?.value || "Passenger";
  const previousBody = resetDependentValues ? "" : elements.sosBodyStyle?.value;
  const previousUse = resetDependentValues ? "" : elements.sosVehicleUse?.value;
  replaceSosOptions(elements.sosBodyStyle, bodyOptionsForVehicle(vehicleType), previousBody);
  replaceSosOptions(elements.sosVehicleUse, useOptionsForVehicle(vehicleType), previousUse);

  const vehicleUse = elements.sosVehicleUse?.value || "PASS";
  const previousPlate = elements.sosPlateType?.value;
  replaceSosOptions(elements.sosPlateType, plateOptionsForUse(vehicleUse), previousPlate);

  // "Registered to" is asked by every official calculator, not just the
  // commercial one, and Michigan reads a passenger plate's expiration from the
  // owner's birthday — so both stay visible. Only a business registration drops
  // the birthdate, because the state expires those on a fixed schedule instead.
  syncSosOwnerBirthdateVisibility();
  const designOptions = plateDesignOptionsForType(elements.sosPlateType?.value);
  const previousDesign = elements.sosPlateDesign?.value;
  replaceSosOptions(elements.sosPlateDesign, designOptions, previousDesign);
  // Two places set `hidden` on this control: the mode switch, which hides every
  // [data-new-plate-only] node, and this function. This one used to decide
  // purely on how many designs exist, so it overrode the mode — and any edit
  // that re-ran it, such as switching the vehicle between new and used, made
  // the plate-design picker reappear during a transfer. A transfer moves an
  // existing plate, so its design is already fixed: the state is never asked
  // for one and the submission never sends one, which made the control a
  // choice that did nothing.
  const choosesPlate = selectedSosQuoteMode() === SOS_QUOTE_MODE.newPlate;
  if (elements.sosPlateDesignControl) {
    elements.sosPlateDesignControl.hidden = !choosesPlate || designOptions.length <= 1;
  }
  const selectedDesign = plateDesignByValue(elements.sosPlateDesign?.value);
  if (elements.sosPlateEligibility) {
    elements.sosPlateEligibility.hidden =
      !choosesPlate || !selectedDesign?.eligibilityNote;
    elements.sosPlateEligibility.textContent = selectedDesign?.eligibilityNote || "";
  }
  clearSosValidation();
  renderSosPlatePreview();
}

async function applyPendingVinSuggestions() {
  if (!pendingVinDecode) return 0;
  await invalidateSosQuoteAfterEdit();
  let applied = 0;
  const initialSuggestions = makeSosVinSuggestions(
    pendingVinDecode,
    localSosVinFields(elements.sosVehicleType?.value || "Passenger")
  );
  const vehicleSuggestion = initialSuggestions.find(
    (suggestion) => suggestion.fieldId === "sosVehicleType"
  );
  if (vehicleSuggestion && elements.sosVehicleType) {
    elements.sosVehicleType.value = vehicleSuggestion.value;
    syncSosLocalDependencies({ resetDependentValues: true });
    applied += 1;
  }

  const suggestions = makeSosVinSuggestions(
    pendingVinDecode,
    localSosVinFields(elements.sosVehicleType?.value || "Passenger")
  );
  for (const suggestion of suggestions) {
    if (suggestion.fieldId === "sosVehicleType") continue;
    const control = document.getElementById(suggestion.fieldId);
    if (!control || control.value === suggestion.value) continue;
    control.value = suggestion.value;
    if (control.value === suggestion.value) applied += 1;
  }
  pendingVinDecode = null;
  syncSosLocalDependencies();
  return applied;
}

async function invalidateSosQuoteAfterEdit() {
  if (currentSosFeeQuote) {
    currentSosFeeQuote = null;
    renderSosFeeQuote();
    try {
      await clearSosFeeQuote();
    } catch (error) {
      console.error("Could not remove the stale SOS fee quote:", error);
      showToast("The previous fee quote could not be cleared. Calculate again to replace it.", "error");
    }
  }
  setSosWorkspaceStatus("Selections changed. Calculate again when complete.");
}

async function handleSosOfficialFieldChange(event) {
  await invalidateSosQuoteAfterEdit();
  if (event?.target === elements.sosVehicleType) {
    syncSosLocalDependencies({ resetDependentValues: true });
  } else {
    syncSosLocalDependencies();
  }
}

async function handleSosCalculationInput() {
  clearSosValidation();
  renderSosReadiness();
  await invalidateSosQuoteAfterEdit();
}

async function calculateSosFee() {
  if (sosWorkspaceBusy) return;
  const values = localSosValues();
  const errors = validateSosLocalValues(values);
  sosSubmitAttempted = true;
  if (errors.length) {
    showSosValidation(errors);
    setSosWorkspaceStatus(
      errors.length === 1
        ? errors[0].message
        : `${errors.length} details need attention before this can be calculated.`,
      "error"
    );
    renderSosReadiness();
    return;
  }
  clearSosValidation();
  sosWorkspaceBusy = true;
  setSosProgress(true);
  renderSosWorkspace();
  setSosWorkspaceStatus("Running the official Michigan SOS calculator…", "busy");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SOS_FEE_CALCULATE",
      data: {
        mode: values.mode,
        fields: buildSosSubmission(values),
      },
    });
    // A cancelled request was superseded on purpose; do not shout about it.
    if (response?.cancelled) {
      setSosWorkspaceStatus("Calculation cancelled. Calculate again when ready.");
      return;
    }
    if (!response?.success || !response.quote) {
      throw new Error(response?.error || "Michigan SOS did not return a verified registration fee.");
    }
    // The MSRP lives only in the local form, so capture it with the quote
    // rather than reading the box later, when it may have moved on.
    const msrpRaw = String(elements.sosMsrp?.value || "").replace(/[$,\s]/g, "");
    const msrpCents = /^\d{1,7}(?:\.\d{1,2})?$/.test(msrpRaw)
      ? Math.round(Number(msrpRaw) * 100)
      : null;
    const quote = createCalculatedQuote(
      response.quote,
      selectedSosQuoteMode(),
      new Date(),
      { msrpCents }
    );
    if (!quote) {
      throw new Error("Michigan SOS returned an incomplete fee. Try calculating again.");
    }
    currentSosFeeQuote = await saveSosFeeQuote(quote);
    pendingVinDecode = null;
    renderSosFeeQuote();
    setSosWorkspaceStatus("Official SOS calculation complete.", "ok");
  } catch (error) {
    setSosWorkspaceStatus(
      error?.message || "Michigan SOS could not calculate the fee.",
      "error"
    );
  } finally {
    sosWorkspaceBusy = false;
    setSosProgress(false);
    renderSosWorkspace();
    renderSosReadiness();
  }
}

async function handleSosVinLookup() {
  if (sosWorkspaceBusy) return;
  const input = elements.sosVinLookupInput;
  const rawVin = input?.value || "";
  if (!normalizeVinLookupInput(rawVin)) {
    if (elements.sosVinLookupStatus) {
      elements.sosVinLookupStatus.textContent = "Enter at least 8 valid VIN characters. A full 17-character VIN is most reliable.";
    }
    return;
  }
  if (elements.lookupSosVinBtn) elements.lookupSosVinBtn.disabled = true;
  if (elements.sosVinLookupStatus) {
    elements.sosVinLookupStatus.textContent = "Looking up vehicle basics with NHTSA…";
  }
  try {
    const decoded = await lookupVin(rawVin);
    pendingVinDecode = decoded;
    const summary = vinLookupSummary(decoded) || "vehicle details";
    const applied = await applyPendingVinSuggestions();
    if (elements.sosVinLookupStatus) {
      elements.sosVinLookupStatus.textContent = decoded.partial
        ? `Partial VIN match — ${summary}. Filled ${applied} field${applied === 1 ? "" : "s"}; check every selection.`
        : `${summary}: filled ${applied} field${applied === 1 ? "" : "s"}. Check them before calculating.`;
    }
    setSosWorkspaceStatus(
      applied
        ? `NHTSA filled ${applied} field${applied === 1 ? "" : "s"} from the VIN. Check them, then calculate.`
        : "NHTSA identified the vehicle but could not fill any of these fields. Set them by hand.",
      applied ? "" : "error"
    );
  } catch (error) {
    pendingVinDecode = null;
    if (elements.sosVinLookupStatus) {
      elements.sosVinLookupStatus.textContent =
        error?.message || "NHTSA VIN lookup could not return vehicle details.";
    }
  } finally {
    sosWorkspaceBusy = false;
    if (elements.lookupSosVinBtn) elements.lookupSosVinBtn.disabled = false;
    renderSosWorkspace();
  }
}

async function handleSosLienCheck() {
  const vin = normalizeVinLookupInput(elements.sosVinLookupInput?.value || "");
  if (!vin || vin.length !== 17 || vin.includes("*")) {
    if (elements.sosLienStatus) {
      elements.sosLienStatus.textContent = "A full 17-character VIN is required for the Michigan Title/Lien check.";
      elements.sosLienStatus.className = "sos-lien-status is-error";
    }
    return;
  }
  sosLienCheckBusy = true;
  syncSosLienCheckButton();
  if (elements.sosLienStatus) {
    elements.sosLienStatus.textContent = "Checking Michigan title/lien status…";
    elements.sosLienStatus.className = "sos-lien-status";
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_SOS_LIEN_CHECK",
      data: { vin },
    });
    if (!response?.success || !response.result) {
      throw new Error(response?.error || "Michigan Title/Lien did not return a verified result.");
    }
    const presentation = titlePresentation(response.result);
    if (elements.sosLienStatus) {
      elements.sosLienStatus.textContent = `${presentation.title}. ${presentation.subtitle}`;
      elements.sosLienStatus.className =
        presentation.state === "clear"
          ? "sos-lien-status"
          : "sos-lien-status is-warning";
    }
  } catch (error) {
    if (elements.sosLienStatus) {
      elements.sosLienStatus.textContent =
        error?.message || "Michigan Title/Lien could not be checked right now.";
      elements.sosLienStatus.className = "sos-lien-status is-error";
    }
  } finally {
    sosLienCheckBusy = false;
    syncSosLienCheckButton();
  }
}

async function clearCurrentSosFeeQuote() {
  try {
    await cancelSosFeeRequest();
    await clearSosFeeQuote();
    currentSosFeeQuote = null;
    pendingVinDecode = null;
    if (elements.sosVinLookupInput) elements.sosVinLookupInput.value = "";
    if (elements.sosVinLookupStatus) elements.sosVinLookupStatus.textContent = "";
    // The owner birthdate is personal data belonging to one deal. Leaving it
    // behind would carry a date of birth into the next customer's quote and
    // could price their registration off the wrong expiration. Dropping the
    // touched flag too lets the Screening DOB prefill again for that customer.
    resetSosLocalForm();
    if (elements.sosLienStatus) {
      elements.sosLienStatus.textContent = "";
      elements.sosLienStatus.className = "sos-lien-status";
    }
    syncSosLienCheckButton();
    clearSosValidation();
    renderSosFeeQuote();
    renderSosWorkspace();
    setSosWorkspaceStatus("Quote cleared. Complete the fields, then calculate.");
    showToast("Fee quote cleared.", "success");
  } catch (error) {
    console.error("Could not clear SOS fee quote:", error);
    showToast("Could not clear the SOS fee quote.", "error");
  }
}

async function handleSosQuoteModeChange() {
  await cancelSosFeeRequest();
  pendingVinDecode = null;
  if (currentSosFeeQuote && currentSosFeeQuote.mode !== selectedSosQuoteMode()) {
    await clearSosFeeQuote();
    currentSosFeeQuote = null;
  }
  renderSosFeeQuote();
  renderSosWorkspace();
  setSosWorkspaceStatus("Registration choice changed. Complete the fields, then calculate.");
}

async function printSosFeeQuote() {
  const [dealerName, logoUrl, plateImageUrl] = await Promise.all([
    loadDealerName(),
    loadDealerLogo(),
    loadPlateImageForPrint(currentSosFeeQuote),
  ]);
  const html = createSosFeeQuotePrintHTML(currentSosFeeQuote, {
    dealerName,
    logoUrl,
    plateImageUrl,
  });
  if (!html) {
    showToast("Calculate an official fee before printing the customer summary.", "info");
    return;
  }
  await printHtmlDocument(html, { waitForImages: true });
}

async function printSosOfficialCalculation() {
  const html = createSosOfficialEvidencePrintHTML(currentSosFeeQuote);
  if (!html) {
    showToast("The official SOS page capture is unavailable. Calculate again.", "info");
    return;
  }
  await printHtmlDocument(html, { waitForImages: true });
}

async function downloadSosOfficialCalculation() {
  await downloadSosOfficialEvidencePDF(currentSosFeeQuote);
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
  // Out-of-state Repeat Offender = not applicable (passed:null) — must NOT
  // render as a red FAIL on the live progress row.
  if (check.status === "not_applicable") return "skipped";
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
  elements.rescreenBanner?.addEventListener("click", openRescreenTarget);
  // Once results render, the action row above them has scrolled out of reach —
  // sticky only pins inside its own section — so the same Clear lives here,
  // where the salesperson actually is when they finish a customer.
  elements.newCustomerBtn?.addEventListener("click", handleClear);
  elements.runOfacBtn.addEventListener("click", handleRunOfac);
  elements.runRepeatOffenderBtn.addEventListener("click", handleRunRepeatOffender);
  elements.runTitleBtn.addEventListener("click", handleRunTitle);

  // Local selections are instant. SOS is contacted once, only after the
  // salesperson explicitly requests the final official calculation.
  elements.calculateSosFeeBtn?.addEventListener("click", calculateSosFee);
  elements.printSosQuoteBtn?.addEventListener("click", printSosFeeQuote);
  elements.printSosCalculationBtn?.addEventListener("click", printSosOfficialCalculation);
  elements.downloadSosCalculationPdfBtn?.addEventListener("click", downloadSosOfficialCalculation);
  elements.clearSosQuoteBtn?.addEventListener("click", clearCurrentSosFeeQuote);
  elements.lookupSosVinBtn?.addEventListener("click", handleSosVinLookup);
  elements.sosPlatePreview?.addEventListener("click", openSosPlatePreview);
  elements.closeSosPlateViewer?.addEventListener("click", closeSosPlateViewer);
  elements.sosPlateZoomOut?.addEventListener("click", () =>
    setSosPlateZoom(sosPlateZoom - SOS_PLATE_ZOOM_STEP)
  );
  elements.sosPlateZoomIn?.addEventListener("click", () =>
    setSosPlateZoom(sosPlateZoom + SOS_PLATE_ZOOM_STEP)
  );
  elements.sosPlateZoomReset?.addEventListener("click", () => setSosPlateZoom(1));
  // Bound on the stage rather than the image so it still fires in the margin
  // around a zoomed plate, and toggles off from any zoom level rather than
  // only from exactly 100%.
  elements.sosPlateViewerStage?.addEventListener("dblclick", () =>
    setSosPlateZoom(sosPlateZoom > 1 ? 1 : 1.75)
  );
  // A viewer with only mouse-driven zoom is unusable from the keyboard, and
  // leaves anyone who cannot see the buttons with no way out of a zoom.
  elements.sosPlateViewerStage?.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") {
      setSosPlateZoom(sosPlateZoom + SOS_PLATE_ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      setSosPlateZoom(sosPlateZoom - SOS_PLATE_ZOOM_STEP);
    } else if (event.key === "0") {
      setSosPlateZoom(1);
    } else {
      return;
    }
    event.preventDefault();
  });
  elements.sosPlateViewerStage?.addEventListener("pointerdown", beginSosPlatePan);
  elements.sosPlateViewerStage?.addEventListener("pointermove", moveSosPlatePan);
  elements.sosPlateViewerStage?.addEventListener("pointerup", endSosPlatePan);
  elements.sosPlateViewerStage?.addEventListener("pointercancel", endSosPlatePan);
  window.addEventListener("pagehide", disposeSosPlateImages, { once: true });
  elements.checkSosLienBtn?.addEventListener("click", handleSosLienCheck);
  elements.sosVinLookupInput?.addEventListener("input", handleSosVinInput);
  elements.sosVinLookupInput?.addEventListener("input", syncUseTradeVinButton);
  elements.useTradeVinBtn?.addEventListener("click", applyTradeVinToPlateTab);
  elements.tradeVin?.addEventListener("input", syncUseTradeVinButton);
  syncUseTradeVinButton();
  // Registered-to drives whether the state asks for a birthdate at all.
  document
    .querySelectorAll('input[name="sosBusinessRegistration"]')
    .forEach((input) =>
      input.addEventListener("change", () => {
        syncSosOwnerBirthdateVisibility();
        prefillSosOwnerBirthdate();
      })
    );
  // Once the salesperson types here, the registered owner is theirs to control
  // and the Screening DOB must never silently overwrite it.
  elements.sosOwnerBirthdate?.addEventListener("input", () => {
    elements.sosOwnerBirthdate.dataset.touched = "true";
  });
  elements.dob?.addEventListener("change", prefillSosOwnerBirthdate);
  attachDateMask(elements.sosOwnerBirthdate);
  attachDateMask(elements.sosPurchaseDate);
  syncSosOwnerBirthdateVisibility();
  prefillSosOwnerBirthdate();
  prefillSosPurchaseDate();
  syncSosLienCheckButton();
  document.querySelectorAll('input[name="sosQuoteMode"]').forEach((input) => {
    input.addEventListener("change", handleSosQuoteModeChange);
  });
  [
    elements.sosVehicleType,
    elements.sosBodyStyle,
    elements.sosVehicleUse,
    elements.sosFuelType,
    elements.sosPlateType,
    elements.sosPlateDesign,
  ].forEach((control) => control?.addEventListener("change", handleSosOfficialFieldChange));
  ["sosFirstTitle", "sosBusinessRegistration", "sosRecreationPassport"].forEach(
    (name) =>
      document
        .querySelectorAll(`input[name="${name}"]`)
        .forEach((input) => input.addEventListener("change", handleSosOfficialFieldChange))
  );
  [
    elements.sosModelYear,
    elements.sosMsrp,
    elements.sosPurchaseDate,
    elements.sosTransferPlateNumber,
  ].forEach((control) => control?.addEventListener("input", handleSosCalculationInput));
  syncSosLocalDependencies({ resetDependentValues: true });
  renderSosWorkspace();

  window.addEventListener("pagehide", () => {
    // Do not await during teardown. Nobody is left to read the answer, so
    // release the worker's in-flight quote instead of letting it finish.
    chrome.runtime.sendMessage({ type: "SOS_FEE_CANCEL", data: {} }).catch(() => {});
  });

  elements.tradeVin.addEventListener("input", (e) => {
    elements.runTitleBtn.disabled = e.target.value.trim().length === 0;
    syncSosLienCheckButton();
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

  elements.exportAuditLogBtn?.addEventListener("click", async () => {
    try {
      const { [STORAGE_KEYS.complianceHistory]: history = [] } =
        await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
      if (!history.length) {
        showToast("No history to export yet.", "info");
        return;
      }
      downloadAuditCsv(history);
      showToast(`Exported ${history.length} record(s) to CSV.`, "success");
    } catch (e) {
      console.error("Audit export failed:", e);
      showToast("Could not export the audit log.", "error");
    }
  });

  // The data-use disclosure is open for anyone who has not seen it, then
  // stays closed. Chrome wants it prominent before collection, but leaving it
  // permanently expanded costs a narrow panel a block of text on every screen.
  if (elements.dataUseDetails) {
    const markDataUseSeen = () => {
      chrome.storage.local
        .set({ [STORAGE_KEYS.dataUseNoticeSeen]: true })
        .catch(() => {});
    };

    chrome.storage.local
      .get(STORAGE_KEYS.dataUseNoticeSeen)
      .then((stored) => {
        if (stored[STORAGE_KEYS.dataUseNoticeSeen]) {
          elements.dataUseDetails.open = false;
        }
      })
      .catch(() => {});

    // Collapsing it by hand counts as having read it.
    elements.dataUseDetails.addEventListener("toggle", () => {
      if (!elements.dataUseDetails.open) markDataUseSeen();
    });

    // So does getting as far as running a check with it on screen: the notice
    // was displayed before any data was collected, which is the point of it.
    elements.runAllChecksBtn?.addEventListener("click", markDataUseSeen);
  }

  // Show the retention-change notice once per user. Chrome requires a
  // prominent disclosure when data practices change after installation, and
  // saved records went from outcomes-only to holding the submitted customer
  // fields and captured state evidence for 30 days.
  if (elements.retentionNotice && elements.retentionNoticeAckBtn) {
    const NOTICE_VERSION = "1.6.0-retention";
    chrome.storage.local
      .get(STORAGE_KEYS.retentionNoticeAckVersion)
      .then((stored) => {
        if (stored[STORAGE_KEYS.retentionNoticeAckVersion] === NOTICE_VERSION) return;
        elements.retentionNotice.classList.remove("hidden");
      })
      .catch(() => {});

    elements.retentionNoticeAckBtn.addEventListener("click", () => {
      elements.retentionNotice.classList.add("hidden");
      chrome.storage.local
        .set({ [STORAGE_KEYS.retentionNoticeAckVersion]: NOTICE_VERSION })
        .catch(() => {});
    });
  }

  // Dealership name for printed customer worksheets.
  if (elements.dealershipNameInput) {
    chrome.storage.local
      .get(STORAGE_KEYS.dealershipName)
      .then((r) => {
        elements.dealershipNameInput.value = String(
          r[STORAGE_KEYS.dealershipName] || ""
        );
      })
      .catch(() => {});
    elements.dealershipNameInput.addEventListener("change", async () => {
      const name = elements.dealershipNameInput.value.trim().slice(0, 80);
      elements.dealershipNameInput.value = name;
      // Await the write: announcing "saved" over a failed set() would leave
      // printed worksheets carrying whatever name was stored before.
      try {
        await chrome.storage.local.set({ [STORAGE_KEYS.dealershipName]: name });
      } catch {
        showToast("The dealership name could not be saved. Try again.", "error");
        return;
      }
      showToast(
        name ? "Dealership name saved." : "Dealership name cleared.",
        "info"
      );
    });
  }

  // Dealership logo for printed customer worksheets (stored as a data URL so
  // the printed sheet never depends on a fetch).
  if (elements.dealershipLogoInput) {
    const renderLogoState = (hasLogo) => {
      elements.removeDealershipLogoBtn?.classList.toggle("hidden", !hasLogo);
      if (elements.dealershipLogoStatus) {
        elements.dealershipLogoStatus.textContent = hasLogo
          ? "Logo set. It prints at the top of the customer worksheet."
          : "No logo set.";
      }
    };
    chrome.storage.local
      .get(STORAGE_KEYS.dealershipLogo)
      .then((r) => renderLogoState(Boolean(r[STORAGE_KEYS.dealershipLogo])))
      .catch(() => {});

    elements.dealershipLogoInput.addEventListener("change", async () => {
      const file = elements.dealershipLogoInput.files?.[0];
      elements.dealershipLogoInput.value = "";
      if (!file) return;
      if (file.size > MAX_DEALER_LOGO_BYTES) {
        showToast("That logo is larger than 512 KB. Choose a smaller image.", "error");
        return;
      }
      try {
        const dataUrl = await readLogoFile(file);
        if (!sanitizeDealerLogo(dataUrl)) {
          showToast("That file is not a PNG, JPEG, or WebP image.", "error");
          return;
        }
        await chrome.storage.local.set({ [STORAGE_KEYS.dealershipLogo]: dataUrl });
        renderLogoState(true);
        showToast("Dealership logo saved.", "success");
      } catch {
        showToast("That logo could not be read. Try another image.", "error");
      }
    });

    elements.removeDealershipLogoBtn?.addEventListener("click", async () => {
      try {
        await chrome.storage.local.remove(STORAGE_KEYS.dealershipLogo);
      } catch {
        // The logo is still stored; saying otherwise (or rejecting unhandled)
        // helps no one. Leave the UI reflecting reality.
        showToast("The dealership logo could not be removed. Try again.", "error");
        return;
      }
      renderLogoState(false);
      showToast("Dealership logo removed.", "info");
    });
  }

  // Re-screen reminder toggle (persists in chrome.storage.local).
  if (elements.rescreenReminderToggle) {
    chrome.storage.local
      .get(STORAGE_KEYS.rescreenReminderEnabled)
      .then((r) => {
        elements.rescreenReminderToggle.checked =
          !!r[STORAGE_KEYS.rescreenReminderEnabled];
      })
      .catch(() => {});
    elements.rescreenReminderToggle.addEventListener("change", () => {
      chrome.storage.local.set({
        [STORAGE_KEYS.rescreenReminderEnabled]:
          elements.rescreenReminderToggle.checked,
      });
      showToast(
        elements.rescreenReminderToggle.checked
          ? "Re-screen reminder on."
          : "Re-screen reminder off.",
        "info"
      );
    });
  }

  elements.historyList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();

    // Look the record up by audit id. The list is rendered once from a
    // snapshot, but storage is re-read on every click and a run finishing in
    // the background inserts a newer record at the top — so a positional index
    // captured at render time can resolve to a different customer than the row
    // that was clicked.
    const auditId = btn.dataset.audit || "";
    if (!auditId) return;
    const { [STORAGE_KEYS.complianceHistory]: history = [] } =
      await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
    const entry = history.find((record) => record?.auditId === auditId);
    if (!entry) {
      showToast(
        "That record is no longer saved. Reopen History for the current list.",
        "warning"
      );
      return;
    }
    // Deleting is handled before the legacy guard below. Reopening, printing
    // and re-screening all need the saved customer details, but removing a
    // record does not — and a record from before 1.4 was the one thing a user
    // could not delete individually, which is exactly backwards for the record
    // they are most likely to want gone. Clearing the whole history was the
    // only way out.
    if (btn.classList.contains("history-delete-btn")) {
      if (!confirm("Delete this one saved record?\n\nOther records are kept.")) return;
      try {
        const result = await chrome.runtime.sendMessage({
          type: "REMOVE_HISTORY_ENTRY",
          data: { auditId },
        });
        if (!result?.success) {
          showToast("That record could not be deleted. Try again.", "error");
          return;
        }
        filterHistoryWorkspace(elements.historySearchInput?.value || "");
        await refreshHistoryCountAndActions();
        showToast("Record deleted. Other records are unchanged.", "success");
      } catch (error) {
        console.error("Delete history entry failed:", error);
        showToast("That record could not be deleted. Try again.", "error");
      }
      return;
    }

    const results = entry?.savedResults;
    if (!results?.customer || !results?.checks) {
      showToast(
        "This record was saved before the app kept customer details, so it cannot be reopened or reprinted. The decision it recorded is still shown on the row.",
        "warning"
      );
      return;
    }

    if (btn.classList.contains("history-print-btn")) {
      const keys = availableReportItems(results).map((item) => item.key);
      await printAllReports(results, keys);
      return;
    }
    if (btn.classList.contains("history-download-btn")) {
      const keys = availableReportItems(results).map((item) => item.key);
      await downloadAllReportsPDF(results, keys);
      return;
    }
    // Deleting one record was only possible by clearing every record: the
    // worker already supported removing a single entry, but nothing exposed it.
    // Re-screening is the whole point of the aging reminder, but it took four
    // steps: open the record, switch tab, find the button, run. This does it.
    if (btn.classList.contains("history-rescreen-btn")) {
      await handleClear();
      applyCustomerData(elements, results.customer);
      updateJurisdictionTags();
      activateWorkspace("screening");
      showToast("Customer restored — running the checks again.", "info");
      await handleRunAllChecks();
      return;
    }

    if (btn.classList.contains("history-open-btn")) {
      await handleClear();
      applyCustomerData(elements, results.customer);
      scanJurisdiction.buyer =
        typeof results.customer.buyerIsMichigan === "boolean"
          ? results.customer.buyerIsMichigan
          : null;
      scanJurisdiction.coBuyer =
        typeof results.customer.coBuyerIsMichigan === "boolean"
          ? results.customer.coBuyerIsMichigan
          : null;
      updateJurisdictionTags();
      setCurrentResults(results);
      await persistCurrentResults();
      if (results.runType === "individual") {
        displayStoredIndividualResult(results);
      } else {
        displayResults(elements, results);
      }
      syncReportSelection(results);
      setInputCollapsed(true, results.customer);
      elements.resultsSection.classList.remove("hidden");
      elements.progressSection.classList.add("hidden");
      activateWorkspace("screening");
      showToast(
        "Saved customer and reports restored. You can print, download, or run fresh checks.",
        "success",
        6500
      );
    }
  });

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
    printAllReports(getCurrentResults(), getSelectedReportKeys())
  );
  elements.downloadPdfBtn?.addEventListener("click", () =>
    downloadAllReportsPDF(getCurrentResults(), getSelectedReportKeys())
  );
  elements.downloadEvidenceBtn?.addEventListener("click", () => {
    const results = getCurrentResults();
    return downloadAllReportsPDF(
      results,
      availableReportItems(results).map((item) => item.key)
    );
  });
  elements.printEvidenceBtn?.addEventListener("click", () => {
    const results = getCurrentResults();
    return printAllReports(
      results,
      availableReportItems(results).map((item) => item.key)
    );
  });
  elements.downloadAllPdfsBtn?.addEventListener("click", () =>
    downloadAllReportPDFs(getCurrentResults(), getSelectedReportKeys())
  );
  elements.clearOfacFalsePositiveBtn?.addEventListener("click", () =>
    resolveOfacTriage("ofac", "false_positive")
  );
  elements.confirmOfacMatchBtn?.addEventListener("click", () =>
    resolveOfacTriage("ofac", "confirmed_match")
  );
  elements.clearCbOfacFalsePositiveBtn?.addEventListener("click", () =>
    resolveOfacTriage("coBuyerOfac", "false_positive")
  );
  elements.confirmCbOfacMatchBtn?.addEventListener("click", () =>
    resolveOfacTriage("coBuyerOfac", "confirmed_match")
  );
  elements.selectAllReports?.addEventListener("change", () => {
    for (const input of reportSelectionInputs) {
      if (!input.disabled) input.checked = elements.selectAllReports.checked;
    }
    updateReportSelectionState();
  });
  for (const input of reportSelectionInputs) {
    input.addEventListener("change", updateReportSelectionState);
  }

  // Cache form data on change
  const cacheableFields = [
    "firstName", "middleName", "lastName", "suffix", "dob", "dlnPid", "tradeVin",
    "cbFirstName", "cbMiddleName", "cbLastName", "cbSuffix", "cbDob", "cbDlnPid",
  ];
  for (const id of cacheableFields) {
    elements[id]?.addEventListener("change", () => {
      cacheCurrentFormData();
      syncFirstRunPresentation();
    });
    elements[id]?.addEventListener("input", syncFirstRunPresentation);
  }

  // Co-Buyer toggle
  elements.hasCoBuyer?.addEventListener("change", (e) => {
    elements.coBuyerSection?.classList.toggle("hidden", !e.target.checked);
    e.target.setAttribute("aria-expanded", String(e.target.checked));
    const action = e.target.closest(".cobuyer-toggle")?.querySelector(".checkbox-text");
    if (action) action.textContent = e.target.checked ? "Remove" : "Add";
  });

  // Trade-In collapse — the native button provides keyboard activation.
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
  }

  // Summary bar is a two-way toggle: collapse when open, expand when collapsed.
  elements.inputSummaryBar?.addEventListener("click", () => {
    const isOpen =
      elements.inputSummaryBar.getAttribute("aria-expanded") === "true";
    setInputCollapsed(isOpen);
  });

  const openCompletedStep = (step) => {
    document.body.classList.remove("has-screening-results");
    setInputCollapsed(false);
    syncFirstRunPresentation();
    if (step === "coBuyer") {
      elements.hasCoBuyer.checked = true;
      // Dispatch rather than toggle by hand: the change listener owns
      // aria-expanded and the Add/Remove label, and setting .checked in code
      // does not fire it — so the control announced "collapsed" over a section
      // that was open.
      elements.hasCoBuyer.dispatchEvent(new Event("change", { bubbles: true }));
      elements.cbFirstName?.focus();
      return;
    }
    if (step === "trade") {
      const header = $("tradeSectionHeader");
      const content = $("tradeSectionContent");
      content?.classList.remove("collapsed");
      header?.setAttribute("aria-expanded", "true");
      header?.querySelector(".section-toggle")?.classList.add("rotated");
      elements.tradeVin?.focus();
      return;
    }
    elements.firstName?.focus();
  };
  elements.editCompletedBuyerBtn?.addEventListener("click", () => openCompletedStep("buyer"));
  elements.editCompletedCoBuyerBtn?.addEventListener("click", () => openCompletedStep("coBuyer"));
  elements.editCompletedTradeBtn?.addEventListener("click", () => openCompletedStep("trade"));

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      if (!elements.firstRunHero?.classList.contains("hidden")) {
        event.preventDefault();
        elements.scanLicenseBtn?.click();
      }
    }
  });

  // Phone license scan: open a pairing session, show the QR, autofill on receipt.
  // Routed through the shared modal helpers so Escape, backdrop-click, and the
  // close buttons all trap Tab and cancel the in-flight pairing via onClose.
  function closeScanPair() {
    hideModal(elements.scanPairModal);
  }
  elements.scanLicenseBtn?.addEventListener("click", async () => {
    if (elements.scanPairQr) {
      elements.scanPairQr.innerHTML = "";
      elements.scanPairQr.setAttribute(
        "aria-label",
        "QR code to connect your phone"
      );
    }
    if (elements.scanPairStatus)
      elements.scanPairStatus.textContent = "Waiting for your phone…";
    showModal(elements.scanPairModal, {
      focusEl: elements.scanPairCloseX,
      onClose: () => {
        // Also cancels a /pair/new request that has not resolved yet, before
        // startPairing can return its session-scoped cancel function.
        cancelPairing();
      },
    });
    try {
      await startPairing(
        elements,
        (url) => {
          renderPairingQr(window.qrcode, elements.scanPairQr, url);
        },
        (result) => {
          if (result.status === "filled") {
            recordScanJurisdiction(result.payload);
            cacheCurrentFormData().catch((error) =>
              console.error("Could not cache scanned form data:", error)
            );
            closeScanPair();
            const co = result.payload?.coBuyer ? " + co-buyer" : "";
            showToast(`License scanned — buyer${co} filled.`, "success");
            syncFirstRunPresentation();
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
      if (elements.scanPairQr) {
        elements.scanPairQr.textContent = "QR code unavailable.";
        elements.scanPairQr.setAttribute("aria-label", "QR code unavailable");
      }
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
      updateJurisdictionTags();
    })
  );
  ["cbFirstName", "cbLastName", "cbDlnPid"].forEach((id) =>
    elements[id]?.addEventListener("input", () => {
      scanJurisdiction.coBuyer = null;
      updateJurisdictionTags();
    })
  );
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
function buildInputSummary(customerOverride = null) {
  const form = getFormData(elements);
  // On reload, results restore (applyPersistedResults) can race ahead of the
  // cached-form-data hydration, leaving the inputs momentarily empty. Fall back
  // to the restored results' customer so the summary never renders blank.
  const haveForm =
    form.firstName || form.lastName || form.dob || form.dlnPid || form.tradeVin;
  const c = customerOverride || (haveForm ? form : getCurrentResults()?.customer || form);
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
function setInputCollapsed(collapsed, summaryCustomer = null) {
  if (!elements.inputPanel || !elements.inputSummaryBar) return;
  elements.inputSummaryBar.classList.remove("hidden");
  const chevron = elements.inputSummaryBar.querySelector(".section-toggle");
  if (collapsed) {
    elements.inputSummaryText.textContent = buildInputSummary(summaryCustomer);
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

function syncFirstRunPresentation() {
  if (!elements.firstRunHero) return;
  const hasBuyerData = [
    elements.firstName,
    elements.middleName,
    elements.lastName,
    elements.dob,
    elements.dlnPid,
  ].some((field) => String(field?.value || "").trim());
  const hasResult = Boolean(getCurrentResults()) || document.body.classList.contains("has-screening-results");
  elements.firstRunHero.classList.toggle("hidden", hasBuyerData || hasResult);
}

// Returns the panel to its pristine first-use state: form open, no summary bar.
// Speak the decision once the results are actually visible. Writing into a
// live region that is still display:none announces nothing, and revealing it
// afterwards does not announce it either.
function announceVerdict() {
  const announcer = document.getElementById("verdictAnnouncer");
  if (!announcer || !elements.finalDecision) return;
  const verdict = elements.finalDecision.innerText.trim().replace(/\s+/g, " ");
  if (!verdict) return;
  // Re-writing identical text does not re-announce, so clear first.
  announcer.textContent = "";
  requestAnimationFrame(() => {
    announcer.textContent = verdict;
  });
}

function resetInputPanel() {
  if (!elements.inputPanel || !elements.inputSummaryBar) return;
  elements.inputPanel.classList.remove("hidden");
  elements.inputSummaryBar.classList.add("hidden");
  elements.inputSummaryBar.setAttribute("aria-expanded", "false");
  document.body.classList.remove("has-screening-results");
}

// Per-person issuing jurisdiction from a phone scan; null = manually entered
// (assumed Michigan). Drives Repeat Offender eligibility in handleRunAllChecks:
// an out-of-state subject (false) can run OFAC but not the MI Repeat Offender.
const scanJurisdiction = { buyer: null, coBuyer: null };
// Pending "reveal results" timer after a run completes; cleared on Clear so a
// late fire can't re-show stale results over a freshly-cleared form.
let completeRevealTimer = null;
let activeUiRunId = null;
const individualOperationFence = createOperationFence();
let activeIndividualOperationId = null;

function beginIndividualOperation() {
  const token = individualOperationFence.start();
  const operationId = createRunId();
  activeIndividualOperationId = operationId;
  return { token, operationId };
}

function isCurrentIndividualOperation(operation) {
  return (
    individualOperationFence.isCurrent(operation.token) &&
    activeIndividualOperationId === operation.operationId
  );
}

async function discardCancelledIndividualResult(operationId) {
  const stored = await chrome.storage.session.get(STORAGE_KEYS.currentResults);
  if (stored[STORAGE_KEYS.currentResults]?.operationId === operationId) {
    await chrome.storage.session.remove(STORAGE_KEYS.currentResults);
  }
  if (getCurrentResults()?.operationId === operationId) {
    setCurrentResults(null);
  }
}

function cacheCurrentFormData() {
  return cacheFormData(elements, {
    buyerIsMichigan: scanJurisdiction.buyer,
    coBuyerIsMichigan: scanJurisdiction.coBuyer,
  });
}

async function restoreCachedForm() {
  const cached = await loadCachedFormData(elements);
  if (!cached) {
    syncFirstRunPresentation();
    return;
  }
  const restored = extractScanJurisdiction(cached);
  scanJurisdiction.buyer = restored.buyer;
  scanJurisdiction.coBuyer = restored.coBuyer;
  updateJurisdictionTags();
  syncFirstRunPresentation();
}

function recordScanJurisdiction(payload) {
  // An absent isMichigan flag means "unknown" (older payload / manual), NOT
  // "out-of-state". Coercing it to false would wrongly skip Repeat Offender.
  // `?? null` keeps unknown distinct from an explicit false so the worker
  // still runs the Michigan check (null → assume MI).
  scanJurisdiction.buyer = payload?.buyer?.isMichigan ?? null;
  scanJurisdiction.coBuyer = payload?.coBuyer?.isMichigan ?? null;
  updateJurisdictionTags();
}

// Show the "Out-of-state" badge only when a scan explicitly flagged the subject
// as out-of-state (isMichigan === false). Unknown (null) and Michigan hide it.
function updateJurisdictionTags() {
  elements.buyerJurisdictionTag?.classList.toggle(
    "hidden",
    scanJurisdiction.buyer !== false
  );
  elements.coBuyerJurisdictionTag?.classList.toggle(
    "hidden",
    scanJurisdiction.coBuyer !== false
  );
}

async function handleRunAllChecks() {
  const customerData = getFormData(elements);
  // From a phone scan: true=MI, false=out-of-state, null=manual (assume MI).
  // Drives Repeat Offender eligibility in the worker.
  customerData.buyerIsMichigan = scanJurisdiction.buyer;
  customerData.coBuyerIsMichigan = scanJurisdiction.coBuyer;

  // Run whatever the entered data supports. This button used to demand all
  // four buyer identity fields, so someone who only wanted a title and lien
  // check on a VIN could not use it — they had to expand the trade section,
  // scroll, and press a different button for the one thing they wanted.
  const plan = planChecksForData(customerData);
  if (!plan.buyer && !plan.coBuyer && !plan.title) {
    showToast(
      "Enter a buyer to screen, or a trade-in VIN to check title and lien.",
      "warning"
    );
    elements.firstName?.focus();
    return;
  }
  // A half-filled person is a mistake, not an instruction to skip them, so a
  // partial identity is validated rather than quietly dropped.
  if (!validateCustomerFields(customerData, plan)) return;
  if (getIsRunning()) return;

  // Say plainly what will not run. A partial run must never be mistaken for a
  // clean one — finalDecisionForResults already refuses to approve a record
  // whose required checks did not complete, and this is the same honesty at
  // the moment the run starts.
  const skipped = [];
  if (!plan.buyer) skipped.push("OFAC and Repeat Offender (no buyer entered)");
  if (!plan.title) skipped.push("Title and lien (no trade-in VIN)");
  if (skipped.length && (plan.buyer || plan.title)) {
    showToast(`Running what you have. Skipping ${skipped.join("; ")}.`, "info");
  }

  // Tell the user up front when an out-of-state subject will skip the Michigan
  // Repeat Offender check (OFAC still runs for everyone).
  const outOfState = [];
  if (customerData.buyerIsMichigan === false) {
    outOfState.push(customerData.firstName || "Buyer");
  }
  if (customerData.hasCoBuyer && customerData.coBuyerIsMichigan === false) {
    outOfState.push(customerData.coBuyer?.firstName || "Co-buyer");
  }
  if (outOfState.length) {
    showToast(
      `Repeat Offender skipped for ${outOfState.join(
        " & "
      )} — out-of-state ID; OFAC still runs.`,
      "info"
    );
  }

  setIsRunning(true);
  const runId = createRunId();
  activeUiRunId = runId;
  const isCurrentRun = () =>
    activeUiRunId === runId && getIsRunning();
  setButtonsDisabled(elements, true);
  await clearTransientScreenshots();
  if (!isCurrentRun()) return;

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

  await cacheCurrentFormData();
  if (!isCurrentRun()) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_ALL_CHECKS",
      data: { customer: customerData, hasTrade, runId, plan },
    });
    if (!isCurrentRun()) return;
    if (!response?.success) {
      throw new Error(
        response?.error || "The checks could not be started. Try again."
      );
    }
  } catch (e) {
    if (!isCurrentRun()) return;
    console.error("Start Check Error:", e);
    showToast("Could not start checks: " + describeError(e), "error");
    setIsRunning(false);
    activeUiRunId = null;
    setButtonsDisabled(elements, false);
    elements.progressSection.classList.add("hidden");
  }
}

function showHistorySaveWarning() {
  showToast(
    "Check completed, but it was not added to History. Download the report now for your records.",
    "warning",
    10000
  );
}

async function saveHistoryAndRefresh(results, shouldSave = () => true) {
  const saved = await saveToHistory(results, { shouldSave });
  if (!shouldSave()) return false;
  if (!saved) {
    showHistorySaveWarning();
    return false;
  }
  await refreshHistoryCountAndActions();
  return true;
}

async function handleRunOfac() {
  const customerData = getFormData(elements);
  if (!customerData.firstName || !customerData.lastName) {
    showToast("Name is required for OFAC check", "warning");
    return;
  }
  const operation = beginIndividualOperation();
  const isCurrent = () => isCurrentIndividualOperation(operation);
  setButtonsDisabled(elements, true);
  showLoading("Running OFAC screening...");
  try {
    const result = await runOfacCheck(customerData);
    if (!isCurrent()) return;
    const results = mergeIntoCurrentResults(customerData, "ofac", result, {
      replace: true,
      runType: "individual",
      runLabel: "OFAC Only",
      operationId: operation.operationId,
    });
    displayIndividualResult(elements, "ofac", result);
    syncReportSelection(results);
    setInputCollapsed(true, results.customer);
    await persistCurrentResults();
    if (!isCurrent()) {
      await discardCancelledIndividualResult(operation.operationId);
      return;
    }
    await saveHistoryAndRefresh(results, isCurrent);
  } catch (error) {
    if (isCurrent()) {
      showToast("OFAC check failed: " + describeError(error), "error");
    }
  } finally {
    if (isCurrent()) {
      hideLoading();
      setButtonsDisabled(elements, false);
    }
  }
}

async function handleRunRepeatOffender() {
  const customerData = getFormData(elements);
  customerData.buyerIsMichigan = scanJurisdiction.buyer;
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
  const operation = beginIndividualOperation();
  const isCurrent = () => isCurrentIndividualOperation(operation);
  setButtonsDisabled(elements, true);
  showLoading("Checking Repeat Offender status...");
  await clearTransientScreenshots();
  if (!isCurrent()) return;
  try {
    const result = await runRepeatOffenderCheck(
      customerData,
      operation.operationId
    );
    if (!isCurrent()) return;
    const results = mergeIntoCurrentResults(
      customerData,
      "repeatOffender",
      result,
      {
        replace: true,
        runType: "individual",
        runLabel: "Repeat Offender",
        operationId: operation.operationId,
      }
    );
    displayIndividualResult(elements, "repeatOffender", result);
    syncReportSelection(results);
    setInputCollapsed(true, results.customer);
    await persistCurrentResults();
    if (!isCurrent()) {
      await discardCancelledIndividualResult(operation.operationId);
      return;
    }
    await saveHistoryAndRefresh(results, isCurrent);
  } catch (error) {
    if (isCurrent()) {
      showToast("Repeat Offender check failed: " + describeError(error), "error");
    }
  } finally {
    if (isCurrent()) {
      hideLoading();
      setButtonsDisabled(elements, false);
    }
  }
}

async function handleRunTitle() {
  const customerData = getFormData(elements);
  if (!customerData.tradeVin) {
    showToast("VIN is required for title check", "warning");
    return;
  }
  const operation = beginIndividualOperation();
  const isCurrent = () => isCurrentIndividualOperation(operation);
  setButtonsDisabled(elements, true);
  showLoading("Checking Title & Lien status...");
  await clearTransientScreenshots();
  if (!isCurrent()) return;
  try {
    const result = await runTitleCheck(customerData, operation.operationId);
    if (!isCurrent()) return;
    const results = mergeIntoCurrentResults(customerData, "title", result, {
      replace: true,
      runType: "individual",
      runLabel: "Title/Lien",
      operationId: operation.operationId,
    });
    displayIndividualResult(elements, "title", result);
    syncReportSelection(results);
    setInputCollapsed(true, results.customer);
    await persistCurrentResults();
    if (!isCurrent()) {
      await discardCancelledIndividualResult(operation.operationId);
      return;
    }
    await saveHistoryAndRefresh(results, isCurrent);
  } catch (error) {
    if (isCurrent()) {
      showToast("Title check failed: " + describeError(error), "error");
    }
  } finally {
    if (isCurrent()) {
      hideLoading();
      setButtonsDisabled(elements, false);
    }
  }
}

async function handleClear() {
  let cancelledIndividualOperationId = activeIndividualOperationId;
  const persistedIndividualOperation = cancelledIndividualOperationId
    ? Promise.resolve(null)
    : chrome.storage.session
        .get(STORAGE_KEYS.activeIndividualOperationId)
        .catch(() => null);
  individualOperationFence.cancel();
  activeIndividualOperationId = null;
  hideLoading();
  const cancelledRunId = activeUiRunId;
  activeUiRunId = null;
  // Write the cancellation tombstone immediately. A delayed worker write may
  // still reach session storage, but it can no longer be accepted as current.
  const fenceState = {
    [STORAGE_KEYS.cancelledRunId]: cancelledRunId,
    [STORAGE_KEYS.activeRunId]: null,
    [STORAGE_KEYS.stateRunId]: cancelledRunId,
    [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.idle,
    [STORAGE_KEYS.searchProgress]: 0,
    [STORAGE_KEYS.inFlightCheck]: null,
  };
  if (cancelledIndividualOperationId) {
    fenceState[STORAGE_KEYS.cancelledIndividualOperationId] =
      cancelledIndividualOperationId;
    fenceState[STORAGE_KEYS.activeIndividualOperationId] = null;
  }
  const fenceWrite = chrome.storage.session.set(fenceState);
  setIsRunning(false);
  setButtonsDisabled(elements, false);
  resetInputPanel();
  scanJurisdiction.buyer = null;
  scanJurisdiction.coBuyer = null;
  updateJurisdictionTags();
  // Cancel a pending results reveal and any in-progress phone-scan pairing.
  if (completeRevealTimer) {
    clearTimeout(completeRevealTimer);
    completeRevealTimer = null;
  }
  clearSlowCheckTimers();
  cancelPairing();
  elements.scanPairModal?.classList.add("hidden");
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
  if (elements.hasCoBuyer) {
    elements.hasCoBuyer.checked = false;
    elements.hasCoBuyer.dispatchEvent(new Event("change", { bubbles: true }));
  }
  elements.coBuyerSection?.classList.add("hidden");

  // Clearing the deal must also drop the SOS registered owner's birthdate.
  // It is personal data from the customer being cleared, and leaving it would
  // both retain a date of birth and price the next customer's registration off
  // the wrong expiration date.
  resetSosLocalForm();

  const persistedIndividual = await persistedIndividualOperation;
  if (!cancelledIndividualOperationId) {
    cancelledIndividualOperationId =
      persistedIndividual?.[STORAGE_KEYS.activeIndividualOperationId] || null;
    if (cancelledIndividualOperationId) {
      await chrome.storage.session.set({
        [STORAGE_KEYS.cancelledIndividualOperationId]:
          cancelledIndividualOperationId,
        [STORAGE_KEYS.activeIndividualOperationId]: null,
      });
    }
  }
  await fenceWrite;
  const cancellationMessages = [
    chrome.runtime.sendMessage({
      type: "CANCEL_CURRENT_RUN",
      runId: cancelledRunId,
    }),
  ];
  if (cancelledIndividualOperationId) {
    cancellationMessages.push(
      chrome.runtime.sendMessage({
        type: "CANCEL_INDIVIDUAL_OPERATION",
        operationId: cancelledIndividualOperationId,
      })
    );
  }
  await Promise.allSettled(cancellationMessages);
  await chrome.storage.session.remove([
    STORAGE_KEYS.cachedFormData,
    STORAGE_KEYS.cachedAt,
    STORAGE_KEYS.currentResults,
    STORAGE_KEYS.lastError,
    STORAGE_KEYS.repeatOffenderScreenshot,
    STORAGE_KEYS.coBuyerRepeatOffenderScreenshot,
    STORAGE_KEYS.titleScreenshot,
    STORAGE_KEYS.lastResult,
  ]);

  setCurrentResults(null);
  document.body.classList.remove("has-screening-results");
  syncFirstRunPresentation();
  await chrome.action.setBadgeText({ text: "" });

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
  activateWorkspace("history");
  filterHistoryWorkspace(elements.historySearchInput?.value || "");

  // If the re-screen reminder is on, flag any aging full-run deals.
  try {
    const {
      [STORAGE_KEYS.rescreenReminderEnabled]: enabled,
      [STORAGE_KEYS.complianceHistory]: history = [],
    } = await chrome.storage.local.get([
      STORAGE_KEYS.rescreenReminderEnabled,
      STORAGE_KEYS.complianceHistory,
    ]);
    const aging = enabled ? findAgingDeals(history) : [];
    const staleQuote = enabled && isPlateQuoteStale(currentSosFeeQuote);
    renderRescreenBanner(aging, staleQuote);
  } catch (e) {
    console.error("Re-screen reminder check failed:", e);
  }
}

// ---------- Slow-check messaging ----------
// MDOS (government portal) checks can take up to ~90s with no intermediate
// progress. If the bar stalls, surface a reassuring "still running" note rather
// than a label that looks frozen. The stall clock resets whenever progress
// actually advances, so a normal fast run never shows the slow message.
let slowCheckTimers = [];
let slowCheckLastProgress = 0;

function clearSlowCheckTimers() {
  slowCheckTimers.forEach((t) => clearTimeout(t));
  slowCheckTimers = [];
  if (elements.progressLabel) delete elements.progressLabel.dataset.locked;
}

function armSlowCheckTimers() {
  slowCheckTimers.forEach((t) => clearTimeout(t));
  slowCheckTimers = [];
  const setSlowLabel = (text) => {
    if (!elements.progressLabel) return;
    // Lock so the progress animation loop won't overwrite the note.
    elements.progressLabel.textContent = text;
    elements.progressLabel.dataset.locked = "1";
  };
  slowCheckTimers.push(
    setTimeout(
      () => setSlowLabel("Still running — government checks can take up to ~90s…"),
      30000
    )
  );
  slowCheckTimers.push(
    setTimeout(
      () => setSlowLabel("Still running — almost there (up to ~90s total)…"),
      60000
    )
  );
}

// ---------- Storage listener (worker -> UI sync) ----------

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "session") return;
  handleSessionStorageChanges(changes).catch((error) =>
    console.error("[Sidepanel] storage update failed:", error)
  );
});

async function handleSessionStorageChanges(changes) {
  const storedRunState = await chrome.storage.session.get([
    STORAGE_KEYS.activeRunId,
    STORAGE_KEYS.stateRunId,
    STORAGE_KEYS.cancelledRunId,
  ]);
  const runState = {
    activeRunId: storedRunState[STORAGE_KEYS.activeRunId],
    stateRunId: storedRunState[STORAGE_KEYS.stateRunId],
    cancelledRunId: storedRunState[STORAGE_KEYS.cancelledRunId],
  };
  const acceptsActiveRun =
    activeUiRunId != null &&
    isCurrentRunState(runState, activeUiRunId);
  const nextResults = changes[STORAGE_KEYS.currentResults]?.newValue;
  const acceptsIndividualResult =
    !activeUiRunId &&
    activeIndividualOperationId != null &&
    nextResults?.runType === "individual" &&
    nextResults.operationId === activeIndividualOperationId;

  // Each branch independently try/catch'd so one bad update doesn't break others.

  if (acceptsActiveRun && changes[STORAGE_KEYS.searchProgress]) {
    try {
      const pct = changes[STORAGE_KEYS.searchProgress].newValue || 0;
      // Forward progress means a check advanced — reset the stall clock so the
      // slow note only appears after ~30s with NO movement.
      if (pct > slowCheckLastProgress) {
        slowCheckLastProgress = pct;
        clearSlowCheckTimers();
        if (pct < 100) armSlowCheckTimers();
      }
      updateProgress(elements, pct);
    } catch (e) {
      console.error("[Sidepanel] progress update failed:", e);
    }
  }

  if (acceptsActiveRun && changes[STORAGE_KEYS.inFlightCheck]) {
    try {
      const key = changes[STORAGE_KEYS.inFlightCheck].newValue;
      if (key) applyInFlight(key);
    } catch (e) {
      console.error("[Sidepanel] in-flight update failed:", e);
    }
  }

  if (
    changes[STORAGE_KEYS.currentResults]?.newValue &&
    (acceptsActiveRun || acceptsIndividualResult)
  ) {
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
      const status = changes[STORAGE_KEYS.searchStatus].newValue;
      if (acceptsRunStatusUpdate(runState, activeUiRunId, status)) {
        handleSearchStatusChange(changes);
      }
    } catch (e) {
      console.error("[Sidepanel] status update failed:", e);
    }
  }
}

function handleSearchStatusChange(changes) {
  const status = changes[STORAGE_KEYS.searchStatus].newValue;

  if (status === SEARCH_STATUS.running) {
    setIsRunning(true);
    setButtonsDisabled(elements, true);
    setInputCollapsed(true, getCurrentResults()?.customer);
    elements.resultsSection.classList.add("hidden");
    elements.progressSection.classList.remove("hidden");
    setCardsLoadingState(elements, true);
    slowCheckLastProgress = 0;
    armSlowCheckTimers();

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
    const results = getCurrentResults();
    setInputCollapsed(true, results?.customer);
    // The run is complete. Keeping this ID live makes the next individual
    // result look stale and can leave its storage update invisible.
    activeUiRunId = null;
    setCardsLoadingState(elements, false);
    clearSlowCheckTimers();

    if (results) {
      try {
        displayResults(elements, results);
        syncReportSelection(results);
        saveToHistory(results)
          .then((saved) => {
            if (!saved) {
              showHistorySaveWarning();
              return;
            }
            return refreshHistoryCountAndActions();
          })
          .catch((err) => console.error("History save failed:", err));
      } catch (e) {
        console.error("Display/save error:", e);
      }
    }
    if (completeRevealTimer) clearTimeout(completeRevealTimer);
    completeRevealTimer = setTimeout(() => {
      completeRevealTimer = null;
      elements.progressSection.classList.add("hidden");
      elements.resultsSection.classList.remove("hidden");
      announceVerdict();
    }, 350);
    return;
  }

  if (status === SEARCH_STATUS.error) {
    setIsRunning(false);
    activeUiRunId = null;
    setButtonsDisabled(elements, false);
    resetInputPanel();
    setCardsLoadingState(elements, false);
    clearSlowCheckTimers();
    if (completeRevealTimer) {
      clearTimeout(completeRevealTimer);
      completeRevealTimer = null;
    }
    elements.progressSection.classList.add("hidden");
    const errorMsg = changes[STORAGE_KEYS.lastError]?.newValue;
    showToast("Error: " + (describeError({ message: errorMsg }) || "An error occurred."), "error");
    return;
  }

  // idle
  if (status === SEARCH_STATUS.idle) {
    setIsRunning(false);
    activeUiRunId = null;
    setButtonsDisabled(elements, false);
    setCardsLoadingState(elements, false);
    clearSlowCheckTimers();
    elements.progressSection.classList.add("hidden");
  }
}
