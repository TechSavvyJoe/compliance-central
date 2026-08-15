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
  printHtmlDocument,
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
  createManualQuote,
  createSosFeeQuotePrintHTML,
  loadSosFeeQuote,
  quoteStatusText,
  saveSosFeeQuote,
  sourceLabel,
} from "./src/sidepanel/sos-fee-quote.js";
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
  startSosFeeWorkspaceBtn: $("startSosFeeWorkspaceBtn"),
  calculateSosFeeBtn: $("calculateSosFeeBtn"),
  printSosQuoteBtn: $("printSosQuoteBtn"),
  saveManualSosQuoteBtn: $("saveManualSosQuoteBtn"),
  clearSosQuoteBtn: $("clearSosQuoteBtn"),
  sosManualAmount: $("sosManualAmount"),
  sosVinLookupInput: $("sosVinLookupInput"),
  lookupSosVinBtn: $("lookupSosVinBtn"),
  checkSosLienBtn: $("checkSosLienBtn"),
  sosVinLookupStatus: $("sosVinLookupStatus"),
  sosLienStatus: $("sosLienStatus"),
  sosWorkspaceStatus: $("sosWorkspaceStatus"),
  sosOfficialFields: $("sosOfficialFields"),
  sosQuoteStatus: $("sosQuoteStatus"),
  sosQuoteSource: $("sosQuoteSource"),
  sosPlatePreview: $("sosPlatePreview"),
  sosPlatePreviewImage: $("sosPlatePreviewImage"),

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
    setInputCollapsed(true, persisted.results.customer);
    elements.resultsSection.classList.remove("hidden");
    elements.progressSection.classList.add("hidden");
    return;
  }

  if (persisted.state === "complete" && persisted.results) {
    displayResults(elements, persisted.results);
    setInputCollapsed(true, persisted.results.customer);
    activeUiRunId = null;
    elements.resultsSection.classList.remove("hidden");
    elements.progressSection.classList.add("hidden");
  }
}

// ---------- SOS fee quote ----------

let currentSosFeeQuote = null;
let sosCalculator = null;
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
  if (!elements.sosWorkspaceStatus) return;
  elements.sosWorkspaceStatus.textContent = message;
  elements.sosWorkspaceStatus.classList.toggle("is-error", tone === "error");
  elements.sosWorkspaceStatus.classList.toggle("is-busy", tone === "busy");
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

function renderSosPlatePreview() {
  const quotePreview =
    currentSosFeeQuote?.source === SOS_QUOTE_SOURCE.calculated
      ? currentSosFeeQuote.platePreviewUrl
      : null;
  const previewUrl = quotePreview || sosCalculator?.platePreviewUrl || null;
  if (elements.sosPlatePreview) elements.sosPlatePreview.hidden = !previewUrl;
  if (elements.sosPlatePreviewImage) {
    if (previewUrl) {
      elements.sosPlatePreviewImage.src = previewUrl;
    } else {
      elements.sosPlatePreviewImage.removeAttribute("src");
    }
  }
}

function renderSosFeeQuote() {
  const quote = currentSosFeeQuote;
  if (elements.sosQuoteStatus) elements.sosQuoteStatus.textContent = quoteStatusText(quote);
  if (elements.sosQuoteSource) {
    elements.sosQuoteSource.textContent = sourceLabel(quote?.source);
    elements.sosQuoteSource.classList.toggle(
      "is-calculated",
      quote?.source === SOS_QUOTE_SOURCE.calculated
    );
    elements.sosQuoteSource.classList.toggle(
      "is-manual",
      quote?.source === SOS_QUOTE_SOURCE.manual
    );
  }
  if (elements.printSosQuoteBtn) elements.printSosQuoteBtn.disabled = !quote;
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

function createSosElement(tagName, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  return element;
}

function renderSosOfficialFields() {
  const root = elements.sosOfficialFields;
  if (!root) return;
  root.replaceChildren();
  const fields = sosCalculator?.fields || [];
  if (!fields.length) return;

  const sections = new Map();
  for (const field of fields) {
    const key = field.section || "Official SOS choices";
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(field);
  }

  for (const [sectionName, sectionFields] of sections) {
    const section = createSosElement("section", "sos-field-section");
    const heading = createSosElement("h4", "sos-field-section-title");
    heading.textContent = sectionName;
    section.append(heading);
    for (const field of sectionFields) {
      section.append(createSosFieldControl(field));
    }
    root.append(section);
  }
}

function createSosFieldControl(field) {
  const wrapper = createSosElement("div", "sos-official-field");
  const controlId = `sos-field-${field.id}`;
  const disabled = sosWorkspaceBusy || Boolean(field.disabled);
  const required = field.required ? " (required)" : "";

  if (field.kind === "radio") {
    const group = createSosElement("fieldset", "sos-official-radio");
    const legend = document.createElement("legend");
    legend.textContent = `${field.label}${required}`;
    group.append(legend);
    for (const [index, option] of (field.options || []).entries()) {
      const optionId = `${controlId}-${index}`;
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.id = optionId;
      input.name = controlId;
      input.value = option.value;
      input.checked = option.value === field.value;
      input.disabled = disabled;
      input.dataset.sosFieldId = field.id;
      input.addEventListener("change", handleSosOfficialFieldChange);
      const labelText = document.createElement("span");
      labelText.textContent = option.label;
      label.append(input, labelText);
      group.append(label);
    }
    wrapper.append(group);
    return wrapper;
  }

  const label = document.createElement("label");
  label.htmlFor = controlId;
  label.textContent = `${field.label}${required}`;
  let control;
  if (field.kind === "select") {
    control = document.createElement("select");
    for (const option of field.options || []) {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label || "Select";
      optionElement.selected = option.value === field.value;
      control.append(optionElement);
    }
  } else {
    control = document.createElement("input");
    control.type = "text";
    control.value = field.value || "";
    control.inputMode = field.inputMode || "text";
    control.autocomplete = "off";
    control.spellcheck = false;
  }
  control.id = controlId;
  control.disabled = disabled;
  control.dataset.sosFieldId = field.id;
  control.addEventListener("change", handleSosOfficialFieldChange);
  wrapper.append(label, control);
  return wrapper;
}

function renderSosWorkspace() {
  if (elements.startSosFeeWorkspaceBtn) {
    elements.startSosFeeWorkspaceBtn.disabled = sosWorkspaceBusy;
    elements.startSosFeeWorkspaceBtn.textContent = sosCalculator
      ? "Reload official choices"
      : "Load official choices";
  }
  if (elements.calculateSosFeeBtn) {
    elements.calculateSosFeeBtn.disabled = sosWorkspaceBusy || !sosCalculator;
    elements.calculateSosFeeBtn.textContent = sosWorkspaceBusy
      ? "Working with SOS…"
      : "Calculate SOS fee";
  }
  renderSosOfficialFields();
  renderSosPlatePreview();
}

async function closeSosBackgroundWorkspace() {
  try {
    await chrome.runtime.sendMessage({ type: "SOS_FEE_CLOSE", data: {} });
  } catch {
    // The worker may already have closed the extension-owned tab.
  }
}

async function applyPendingVinSuggestions() {
  if (!pendingVinDecode || !sosCalculator) return 0;
  const labels = [
    "Select your vehicle type",
    "Select the body style",
    "Select your fuel type",
    "Enter the vehicle model year",
  ];
  let applied = 0;
  for (const label of labels) {
    const field = sosCalculator.fields.find((item) => item.label === label);
    const suggestion = makeSosVinSuggestions(pendingVinDecode, sosCalculator.fields).find(
      (item) => item.fieldId === field?.id
    );
    if (!field || !suggestion || field.value === suggestion.value) continue;
    const response = await chrome.runtime.sendMessage({
      type: "SOS_FEE_UPDATE_FIELD",
      data: { mode: selectedSosQuoteMode(), ...suggestion },
    });
    if (!response?.success || !response.calculator) break;
    sosCalculator = response.calculator;
    applied += 1;
  }
  pendingVinDecode = null;
  return applied;
}

async function startSosFeeWorkspace() {
  sosWorkspaceBusy = true;
  renderSosWorkspace();
  setSosWorkspaceStatus("Loading live official SOS choices in the background…", "busy");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SOS_FEE_START",
      data: { mode: selectedSosQuoteMode() },
    });
    if (!response?.success || !response.calculator) {
      throw new Error(response?.error || "Michigan SOS did not return official calculator choices.");
    }
    sosCalculator = response.calculator;
    const applied = await applyPendingVinSuggestions();
    setSosWorkspaceStatus(
      applied
        ? `Official SOS choices loaded. VIN details filled ${applied} matching field${applied === 1 ? "" : "s"}; review before calculating.`
        : "Official SOS choices loaded in the sidebar. Choose any remaining required fields, then calculate.",
      ""
    );
  } catch (error) {
    sosCalculator = null;
    setSosWorkspaceStatus(
      error?.message || "Michigan SOS could not load the calculator. No SOS page was shown.",
      "error"
    );
  } finally {
    sosWorkspaceBusy = false;
    renderSosWorkspace();
  }
}

async function handleSosOfficialFieldChange(event) {
  const fieldId = event.target?.dataset?.sosFieldId;
  if (!fieldId || !sosCalculator || sosWorkspaceBusy) return;
  sosWorkspaceBusy = true;
  renderSosWorkspace();
  setSosWorkspaceStatus("Updating the live official SOS choices…", "busy");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SOS_FEE_UPDATE_FIELD",
      data: {
        mode: selectedSosQuoteMode(),
        fieldId,
        value: String(event.target.value || ""),
      },
    });
    if (!response?.success || !response.calculator) {
      throw new Error(response?.error || "Michigan SOS could not apply that choice.");
    }
    sosCalculator = response.calculator;
    setSosWorkspaceStatus("Official SOS choice updated. Continue with the remaining fields.");
  } catch (error) {
    setSosWorkspaceStatus(
      error?.message || "Michigan SOS could not apply that choice. No SOS page was shown.",
      "error"
    );
  } finally {
    sosWorkspaceBusy = false;
    renderSosWorkspace();
  }
}

async function calculateSosFee() {
  if (!sosCalculator || sosWorkspaceBusy) {
    setSosWorkspaceStatus("Load the official SOS choices before calculating a fee.", "error");
    return;
  }
  sosWorkspaceBusy = true;
  renderSosWorkspace();
  setSosWorkspaceStatus("Calculating the official SOS fee in the background…", "busy");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SOS_FEE_CALCULATE",
      data: { mode: selectedSosQuoteMode() },
    });
    if (!response?.success || !response.quote) {
      if (response?.calculator) sosCalculator = response.calculator;
      throw new Error(
        response?.error || "Michigan SOS did not return a verified registration fee."
      );
    }
    const quote = createCalculatedQuote(response.quote, selectedSosQuoteMode());
    if (!quote) {
      throw new Error("Michigan SOS returned an incomplete fee result. No quote was created.");
    }
    currentSosFeeQuote = await saveSosFeeQuote(quote);
    sosCalculator = null; // Worker has already removed the background tab.
    pendingVinDecode = null;
    if (elements.sosManualAmount) elements.sosManualAmount.value = "";
    renderSosFeeQuote();
    setSosWorkspaceStatus("Official SOS fee returned to the sidebar. The background SOS tab is closed.");
    showToast("Official SOS fee calculated for this browser session.", "success");
  } catch (error) {
    setSosWorkspaceStatus(
      error?.message || "Michigan SOS could not calculate the fee. No SOS page was shown.",
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
    if (elements.sosVinLookupStatus) {
      elements.sosVinLookupStatus.textContent = decoded.partial
        ? `NHTSA returned partial details for ${summary}. Review every SOS selection before calculating.`
        : `NHTSA found ${summary}. Matching SOS fields will be filled when official choices are loaded.`;
    }
    if (sosCalculator) {
      sosWorkspaceBusy = true;
      renderSosWorkspace();
      setSosWorkspaceStatus("Applying matching VIN details to current official SOS choices…", "busy");
      const applied = await applyPendingVinSuggestions();
      setSosWorkspaceStatus(
        applied
          ? `Applied ${applied} VIN-based field suggestion${applied === 1 ? "" : "s"}. Review before calculating.`
          : "VIN details are available, but no current SOS field could be filled automatically. Review the official choices.",
        ""
      );
    }
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

async function saveManualSosQuote() {
  const quote = createManualQuote({
    mode: selectedSosQuoteMode(),
    amount: elements.sosManualAmount?.value,
    vehicleDescription: "",
  });
  if (!quote) {
    showToast("Enter a valid confirmed registration or plate fee, such as 125.00.", "warning");
    elements.sosManualAmount?.focus();
    return;
  }
  try {
    currentSosFeeQuote = await saveSosFeeQuote(quote);
    await closeSosBackgroundWorkspace();
    sosCalculator = null;
    pendingVinDecode = null;
    renderSosFeeQuote();
    renderSosWorkspace();
    setSosWorkspaceStatus("Unverified manual fee saved. Verify it before final paperwork.");
    showToast("Unverified salesperson-entered fee quote saved for this browser session.", "warning");
  } catch (error) {
    console.error("Could not save manual SOS fee quote:", error);
    showToast("Could not save the fee quote.", "error");
  }
}

async function clearCurrentSosFeeQuote() {
  try {
    await closeSosBackgroundWorkspace();
    await clearSosFeeQuote();
    currentSosFeeQuote = null;
    sosCalculator = null;
    pendingVinDecode = null;
    if (elements.sosManualAmount) elements.sosManualAmount.value = "";
    if (elements.sosVinLookupInput) elements.sosVinLookupInput.value = "";
    if (elements.sosVinLookupStatus) elements.sosVinLookupStatus.textContent = "";
    if (elements.sosLienStatus) {
      elements.sosLienStatus.textContent = "";
      elements.sosLienStatus.className = "sos-lien-status";
    }
    syncSosLienCheckButton();
    renderSosFeeQuote();
    renderSosWorkspace();
    setSosWorkspaceStatus("Quote cleared. Load official SOS choices to start another quote.");
    showToast("SOS fee quote cleared from this browser session.", "success");
  } catch (error) {
    console.error("Could not clear SOS fee quote:", error);
    showToast("Could not clear the SOS fee quote.", "error");
  }
}

async function handleSosQuoteModeChange() {
  await closeSosBackgroundWorkspace();
  sosCalculator = null;
  pendingVinDecode = null;
  if (currentSosFeeQuote && currentSosFeeQuote.mode !== selectedSosQuoteMode()) {
    await clearSosFeeQuote();
    currentSosFeeQuote = null;
  }
  renderSosFeeQuote();
  renderSosWorkspace();
  setSosWorkspaceStatus("Registration choice changed. Load the matching official SOS choices to continue.");
}

async function printSosFeeQuote() {
  const html = createSosFeeQuotePrintHTML(currentSosFeeQuote);
  if (!html) {
    showToast("Capture or enter a fee before printing the customer summary.", "info");
    return;
  }
  await printHtmlDocument(html);
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

  // SOS is sidebar-only: extension-owned calculator tabs are background-only
  // and are closed after the official result or any unrecoverable error.
  elements.startSosFeeWorkspaceBtn?.addEventListener("click", startSosFeeWorkspace);
  elements.calculateSosFeeBtn?.addEventListener("click", calculateSosFee);
  elements.printSosQuoteBtn?.addEventListener("click", printSosFeeQuote);
  elements.saveManualSosQuoteBtn?.addEventListener("click", saveManualSosQuote);
  elements.clearSosQuoteBtn?.addEventListener("click", clearCurrentSosFeeQuote);
  elements.lookupSosVinBtn?.addEventListener("click", handleSosVinLookup);
  elements.checkSosLienBtn?.addEventListener("click", handleSosLienCheck);
  elements.sosVinLookupInput?.addEventListener("input", handleSosVinInput);
  syncSosLienCheckButton();
  document.querySelectorAll('input[name="sosQuoteMode"]').forEach((input) => {
    input.addEventListener("change", handleSosQuoteModeChange);
  });

  window.addEventListener("pagehide", () => {
    // Do not await during teardown. The worker separately closes a recorded
    // background tab after a worker restart as a privacy backstop.
    chrome.runtime.sendMessage({ type: "SOS_FEE_CLOSE", data: {} }).catch(() => {});
  });

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
