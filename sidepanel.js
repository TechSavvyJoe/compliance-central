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
  createRunId,
  isCurrentRunState,
  createOperationFence,
} from "./lib/run-fence.js";
import {
  getFormData,
  validateCustomerFields,
  cacheFormData,
  loadCachedFormData,
  extractScanJurisdiction,
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
  findAgingDeals,
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
  saveSosFeeQuote,
  sourceLabel,
} from "./src/sidepanel/sos-fee-quote.js";
import {
  bodyOptionsForVehicle,
  buildSosSubmission,
  isCommercialUse,
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
  lookupSosVinBtn: $("lookupSosVinBtn"),
  checkSosLienBtn: $("checkSosLienBtn"),
  sosVinLookupStatus: $("sosVinLookupStatus"),
  sosLienStatus: $("sosLienStatus"),
  sosWorkspaceStatus: $("sosWorkspaceStatus"),
  sosQuoteStatus: $("sosQuoteStatus"),
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
  sosHandoffPanel: $("sosHandoffPanel"),
  sosHandoffMessage: $("sosHandoffMessage"),
  openSosHandoffBtn: $("openSosHandoffBtn"),

  viewHistoryBtn: $("viewHistoryBtn"),

  // Collapsible customer/vehicle input
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

  // Co-Buyer results
  coBuyerResultsSection: $("coBuyerResultsSection"),
  cbOfacResultCard: $("cbOfacResultCard"),
  cbOfacResultStatus: $("cbOfacResultStatus"),
  cbOfacResultDetail: $("cbOfacResultDetail"),
  cbOfacResultTimestamp: $("cbOfacResultTimestamp"),
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

  // Loading
  loadingOverlay: $("loadingOverlay"),
  loadingText: $("loadingText"),

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
      ? "Download All PDFs"
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
  renderSosWorkspace();

  initSettings(elements, {
    onClearHistory: () =>
      clearAllHistory(elements.historyList, elements.historyCount),
  });

  // Independent async tasks — run in parallel, don't block paint.
  restoreCachedForm();
  applyPersistedResults();
  restoreSosFeeQuote();
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
let sosHandoffAvailable = false;

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
  if (!elements.sosWorkspaceStatus) return;
  elements.sosWorkspaceStatus.textContent = message;
  elements.sosWorkspaceStatus.classList.toggle("is-error", tone === "error");
  elements.sosWorkspaceStatus.classList.toggle("is-busy", tone === "busy");
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
    plateType: elements.sosPlateType?.value || "",
    plateDesign: elements.sosPlateDesign?.value || "",
    recreationPassport: selectedRadioValue("sosRecreationPassport"),
    purchaseDate: elements.sosPurchaseDate?.value.trim() || "",
    transferPlateNumber: elements.sosTransferPlateNumber?.value.trim() || "",
  };
}

function clearSosValidation() {
  document
    .querySelectorAll("#sosNewPlateFields [aria-invalid], #sosTransferFields [aria-invalid]")
    .forEach((control) => control.removeAttribute("aria-invalid"));
}

function showSosValidation(errors) {
  clearSosValidation();
  for (const error of errors) {
    const control = document.getElementById(error.id);
    control?.setAttribute("aria-invalid", "true");
  }
  document.getElementById(errors[0]?.id)?.focus?.();
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
        ? "Official published resolution · non-personalized"
        : "Loading the largest official artwork…";
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
              "Largest official artwork available · non-personalized";
          }
        };
        fullImage.onerror = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          if (loadToken !== sosPlateViewerLoadToken) return;
          if (elements.sosPlateViewerNote) {
            elements.sosPlateViewerNote.textContent =
              "Official published preview resolution · non-personalized";
          }
        };
        fullImage.src = displaySource;
      })
      .catch(() => {
        if (loadToken !== sosPlateViewerLoadToken) return;
        sosPlateViewerAbortController = null;
        if (elements.sosPlateViewerNote) {
          elements.sosPlateViewerNote.textContent =
            "Official published preview resolution · non-personalized";
        }
      });
  }
}

function beginSosPlatePan(event) {
  if (sosPlateZoom <= 1 || !elements.sosPlateViewerStage) return;
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
  if (elements.sosQuoteSource) {
    elements.sosQuoteSource.textContent = quote
      ? sourceLabel(quote.source)
      : sosWorkspaceBusy
        ? "Checking SOS"
        : sosHandoffAvailable
          ? "Finish on SOS"
          : "Ready locally";
    elements.sosQuoteSource.classList.toggle(
      "is-calculated",
      quote?.source === SOS_QUOTE_SOURCE.calculated
    );
    elements.sosQuoteSource.classList.toggle(
      "is-busy",
      sosWorkspaceBusy
    );
    elements.sosQuoteSource.classList.toggle(
      "is-handoff",
      sosHandoffAvailable
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
  if (elements.sosNewPlateFields) {
    elements.sosNewPlateFields.hidden = selectedSosQuoteMode() !== SOS_QUOTE_MODE.newPlate;
  }
  if (elements.sosTransferFields) {
    elements.sosTransferFields.hidden = selectedSosQuoteMode() !== SOS_QUOTE_MODE.plateTransfer;
  }
  if (elements.sosHandoffPanel) elements.sosHandoffPanel.hidden = !sosHandoffAvailable;
  renderSosFeeQuote();
}

async function closeSosBackgroundWorkspace() {
  try {
    await chrome.runtime.sendMessage({ type: "SOS_FEE_CLOSE", data: {} });
  } catch {
    // The worker may already have closed the extension-owned tab.
  }
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

  const commercial = isCommercialUse(vehicleUse);
  if (elements.sosBusinessRegistration) {
    elements.sosBusinessRegistration.hidden = !commercial;
  }
  const designOptions = plateDesignOptionsForType(elements.sosPlateType?.value);
  const previousDesign = elements.sosPlateDesign?.value;
  replaceSosOptions(elements.sosPlateDesign, designOptions, previousDesign);
  if (elements.sosPlateDesignControl) {
    elements.sosPlateDesignControl.hidden = designOptions.length <= 1;
  }
  const selectedDesign = plateDesignByValue(elements.sosPlateDesign?.value);
  if (elements.sosPlateEligibility) {
    elements.sosPlateEligibility.hidden = !selectedDesign?.eligibilityNote;
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
      showToast("The older SOS quote could not be removed from this session.", "error");
    }
  }
  sosHandoffAvailable = false;
  if (elements.sosHandoffPanel) elements.sosHandoffPanel.hidden = true;
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
  await invalidateSosQuoteAfterEdit();
}

async function calculateSosFee() {
  if (sosWorkspaceBusy) return;
  const values = localSosValues();
  const errors = validateSosLocalValues(values);
  if (errors.length) {
    showSosValidation(errors);
    setSosWorkspaceStatus(errors[0].message, "error");
    return;
  }
  clearSosValidation();
  sosWorkspaceBusy = true;
  sosHandoffAvailable = false;
  renderSosWorkspace();
  setSosWorkspaceStatus("Sending all completed choices to the official calculator…", "busy");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SOS_FEE_CALCULATE",
      data: {
        mode: values.mode,
        fields: buildSosSubmission(values),
      },
    });
    if (!response?.success || !response.quote) {
      sosHandoffAvailable = Boolean(response?.handoffAvailable);
      if (elements.sosHandoffMessage && response?.error) {
        elements.sosHandoffMessage.textContent = response.error;
      }
      throw new Error(response?.error || "Michigan SOS did not return a verified registration fee.");
    }
    const quote = createCalculatedQuote(response.quote, selectedSosQuoteMode());
    if (!quote) {
      throw new Error("Michigan SOS returned an incomplete fee result. No quote was created.");
    }
    currentSosFeeQuote = await saveSosFeeQuote(quote);
    pendingVinDecode = null;
    renderSosFeeQuote();
    setSosWorkspaceStatus("Official SOS fee returned to the sidebar. The background SOS tab is closed.");
    showToast("Official SOS fee calculated for this browser session.", "success");
  } catch (error) {
    setSosWorkspaceStatus(
      error?.message || "Michigan SOS could not calculate the fee.",
      "error"
    );
  } finally {
    sosWorkspaceBusy = false;
    renderSosWorkspace();
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
        ? `Partial decode: ${summary}. Filled ${applied} supported field${applied === 1 ? "" : "s"}; review all selections.`
        : `${summary}: filled ${applied} supported field${applied === 1 ? "" : "s"}. Review before calculating.`;
    }
    setSosWorkspaceStatus(
      applied
        ? `VIN assist filled ${applied} easy field${applied === 1 ? "" : "s"} locally. Nothing was sent to SOS.`
        : "NHTSA identified the vehicle, but did not provide a safe match for these SOS fields.",
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
    await closeSosBackgroundWorkspace();
    await clearSosFeeQuote();
    currentSosFeeQuote = null;
    pendingVinDecode = null;
    sosHandoffAvailable = false;
    if (elements.sosVinLookupInput) elements.sosVinLookupInput.value = "";
    if (elements.sosVinLookupStatus) elements.sosVinLookupStatus.textContent = "";
    if (elements.sosLienStatus) {
      elements.sosLienStatus.textContent = "";
      elements.sosLienStatus.className = "sos-lien-status";
    }
    syncSosLienCheckButton();
    clearSosValidation();
    renderSosFeeQuote();
    renderSosWorkspace();
    setSosWorkspaceStatus("Quote cleared. Complete the fields, then calculate.");
    showToast("SOS fee quote cleared from this browser session.", "success");
  } catch (error) {
    console.error("Could not clear SOS fee quote:", error);
    showToast("Could not clear the SOS fee quote.", "error");
  }
}

async function handleSosQuoteModeChange() {
  await closeSosBackgroundWorkspace();
  pendingVinDecode = null;
  sosHandoffAvailable = false;
  if (currentSosFeeQuote && currentSosFeeQuote.mode !== selectedSosQuoteMode()) {
    await clearSosFeeQuote();
    currentSosFeeQuote = null;
  }
  renderSosFeeQuote();
  renderSosWorkspace();
  setSosWorkspaceStatus("Registration choice changed. Complete the local fields, then calculate.");
}

async function openSosHandoff() {
  if (!sosHandoffAvailable) return;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SOS_FEE_OPEN_HANDOFF",
      data: { mode: selectedSosQuoteMode() },
    });
    if (!response?.success) {
      throw new Error(response?.error || "The completed SOS form is no longer available.");
    }
    sosHandoffAvailable = false;
    renderSosWorkspace();
    setSosWorkspaceStatus("The prefilled Michigan SOS calculator is open for your final review.");
  } catch (error) {
    setSosWorkspaceStatus(error?.message || "Could not open the completed SOS form.", "error");
  }
}

async function printSosFeeQuote() {
  const html = createSosFeeQuotePrintHTML(currentSosFeeQuote);
  if (!html) {
    showToast("Calculate an official fee before printing the customer summary.", "info");
    return;
  }
  await printHtmlDocument(html);
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
  elements.openSosHandoffBtn?.addEventListener("click", openSosHandoff);
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
  elements.sosPlateViewerImage?.addEventListener("dblclick", () =>
    setSosPlateZoom(sosPlateZoom === 1 ? 1.75 : 1)
  );
  elements.sosPlateViewerStage?.addEventListener("pointerdown", beginSosPlatePan);
  elements.sosPlateViewerStage?.addEventListener("pointermove", moveSosPlatePan);
  elements.sosPlateViewerStage?.addEventListener("pointerup", endSosPlatePan);
  elements.sosPlateViewerStage?.addEventListener("pointercancel", endSosPlatePan);
  window.addEventListener("pagehide", disposeSosPlateImages, { once: true });
  elements.checkSosLienBtn?.addEventListener("click", handleSosLienCheck);
  elements.sosVinLookupInput?.addEventListener("input", handleSosVinInput);
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
    // Do not await during teardown. The worker separately closes a recorded
    // background tab after a worker restart as a privacy backstop.
    chrome.runtime.sendMessage({ type: "SOS_FEE_CLOSE", data: {} }).catch(() => {});
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

    const index = parseInt(btn.getAttribute("data-index"), 10);
    const { [STORAGE_KEYS.complianceHistory]: history = [] } =
      await chrome.storage.local.get(STORAGE_KEYS.complianceHistory);
    if (index < 0 || index >= history.length) return;
    if (btn.classList.contains("history-new-btn")) {
      hideModal(elements.historyModal);
      await handleClear();
      elements.scanLicenseBtn?.focus();
      showToast("Ready for a new screening — scan an ID or enter the details.", "info");
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
  elements.downloadAllPdfsBtn?.addEventListener("click", () =>
    downloadAllReportPDFs(getCurrentResults(), getSelectedReportKeys())
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
    elements[id]?.addEventListener("change", () => cacheCurrentFormData());
  }

  // Co-Buyer toggle
  elements.hasCoBuyer?.addEventListener("change", (e) => {
    elements.coBuyerSection?.classList.toggle("hidden", !e.target.checked);
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
  if (!cached) return;
  const restored = extractScanJurisdiction(cached);
  scanJurisdiction.buyer = restored.buyer;
  scanJurisdiction.coBuyer = restored.coBuyer;
  updateJurisdictionTags();
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
  if (!validateCustomerFields(customerData)) return;
  if (getIsRunning()) return;

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
      data: { customer: customerData, hasTrade, runId },
    });
    if (!isCurrentRun()) return;
    if (!response?.success) {
      throw new Error(
        response?.error || "Failed to start background checks"
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
  await updateHistoryCount(elements.historyCount);
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
  if (elements.hasCoBuyer) elements.hasCoBuyer.checked = false;
  elements.coBuyerSection?.classList.add("hidden");

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
  showModal(elements.historyModal);

  // If the re-screen reminder is on, flag any aging full-run deals.
  try {
    const {
      [STORAGE_KEYS.rescreenReminderEnabled]: enabled,
      [STORAGE_KEYS.complianceHistory]: history = [],
    } = await chrome.storage.local.get([
      STORAGE_KEYS.rescreenReminderEnabled,
      STORAGE_KEYS.complianceHistory,
    ]);
    if (enabled) {
      const aging = findAgingDeals(history);
      if (aging.length) {
        showToast(
          `${aging.length} audit record${
            aging.length === 1 ? "" : "s"
          } from over a week ago — re-screen any open deal before delivery.`,
          "warning",
          7000
        );
      }
    }
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
      if (
        status === SEARCH_STATUS.idle ||
        acceptsActiveRun ||
        (status === SEARCH_STATUS.error && acceptsActiveRun)
      ) {
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
            return updateHistoryCount(elements.historyCount);
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
