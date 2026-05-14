/**
 * Compliance Central — Sidebar entry.
 *
 * Wires DOM, events, message routing, and storage listeners.
 * All UI logic lives in src/sidepanel/.
 */

import { $, sanitizeHTML } from "./src/sidepanel/dom-utils.js";
import { ICONS } from "./src/sidepanel/icons.js";
import { showToast } from "./src/sidepanel/toast.js";
import {
  getFormData,
  validateCustomerFields,
  cacheFormData,
  loadCachedFormData,
} from "./src/sidepanel/form.js";
import {
  runOfacCheck,
  runRepeatOffenderCheck,
  runTitleCheck,
} from "./src/sidepanel/checks.js";
import {
  resetProgress,
  updateProgress,
  setCheckStatus,
  displayResults,
  displayIndividualResult,
  setButtonsDisabled,
} from "./src/sidepanel/results.js";
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
  downloadAllReportsPDF,
} from "./src/sidepanel/export.js";
import { showModal, hideModal } from "./src/sidepanel/modals.js";
import {
  getCurrentResults,
  setCurrentResults,
  loadPersistedResults,
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
};

// ---------- Icon injection (replace emoji at runtime) ----------

function applyIcons() {
  const iconMap = [
    ["icon-user", ICONS.user],
    ["icon-users", ICONS.users],
    ["icon-car", ICONS.car],
    ["icon-globe", ICONS.globe],
    ["icon-ban", ICONS.ban],
    ["icon-file", ICONS.fileText],
    ["icon-play", ICONS.play],
    ["icon-trash", ICONS.trash],
    ["icon-history", ICONS.history],
    ["icon-printer", ICONS.printer],
    ["icon-download", ICONS.download],
    ["icon-chevron", ICONS.chevron],
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

document.addEventListener("DOMContentLoaded", async () => {
  applyIcons();
  initEventListeners();
  await loadCachedFormData(elements);
  await applyPersistedResults();
  await updateHistoryCount(elements.historyCount);
  await purgeOldHistoryEntries();
});

async function applyPersistedResults() {
  const persisted = await loadPersistedResults();

  if (persisted.state === "running") {
    setButtonsDisabled(elements, true);
    elements.resultsSection.classList.add("hidden");
    elements.progressSection.classList.remove("hidden");
    updateProgress(elements, persisted.progress);
    const results = persisted.results;
    if (results) {
      const checks = results.checks || {};
      if (checks.ofac) {
        setCheckStatus(elements.ofacStatus, checks.ofac.passed ? "pass" : "fail");
      }
      if (checks.repeatOffender) {
        setCheckStatus(
          elements.repeatStatus,
          checks.repeatOffender.passed ? "pass" : "fail"
        );
      }
      if (checks.title) {
        setCheckStatus(
          elements.titleStatus,
          checks.title.passed ? "pass" : "warning"
        );
      }
    }
    return;
  }

  if (persisted.state === "complete" && persisted.results) {
    displayResults(elements, persisted.results);
    elements.resultsSection.classList.remove("hidden");
    elements.progressSection.classList.add("hidden");
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
    const { complianceHistory } = await chrome.storage.local.get(
      "complianceHistory"
    );
    const history = complianceHistory || [];
    if (index < 0 || index >= history.length) return;
    const item = history[index];

    if (btn.classList.contains("history-view-btn")) {
      loadHistoryItem(item);
    } else if (btn.classList.contains("history-print-ofac")) {
      withTempResults(item.fullResults, () => printOfacReport(item.fullResults));
    } else if (btn.classList.contains("history-print-repeat")) {
      withTempResults(item.fullResults, () => printRepeatScreenshot(item.fullResults));
    } else if (btn.classList.contains("history-print-title")) {
      withTempResults(item.fullResults, () => printTitleScreenshot(item.fullResults));
    } else if (btn.classList.contains("history-print-all")) {
      withTempResults(item.fullResults, () => printAllReports(item.fullResults));
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

  // Co-Buyer print buttons
  elements.printCbOfacBtn?.addEventListener("click", () =>
    printCoBuyerOfacReport(getCurrentResults())
  );
  elements.printCbRepeatBtn?.addEventListener("click", () =>
    printCoBuyerRepeatScreenshot(getCurrentResults())
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

  // Trade-In collapse
  const tradeHeader = $("tradeSectionHeader");
  const tradeContent = $("tradeSectionContent");
  if (tradeHeader && tradeContent) {
    tradeHeader.addEventListener("click", () => {
      const isCollapsed = tradeContent.classList.toggle("collapsed");
      tradeHeader.querySelector(".section-toggle")?.classList.toggle("rotated", !isCollapsed);
    });
  }
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

// ---------- Action handlers ----------

let isRunning = false;

async function handleRunAllChecks() {
  const customerData = getFormData(elements);
  if (!validateCustomerFields(customerData)) return;
  if (isRunning) return;

  isRunning = true;
  setButtonsDisabled(elements, true);

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
    showToast("Could not start checks: " + e.message, "error");
    isRunning = false;
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
  showLoading("Running OFAC screening...");
  try {
    const result = await runOfacCheck(customerData);
    hideLoading();
    // Patch into currentResults so downstream Print works.
    const cur = getCurrentResults() || { customer: customerData, checks: {}, timestamp: new Date().toISOString() };
    cur.customer = customerData;
    cur.checks = cur.checks || {};
    cur.checks.ofac = result;
    setCurrentResults(cur);
    displayIndividualResult(elements, "ofac", result);
  } catch (error) {
    hideLoading();
    showToast("OFAC check failed: " + error.message, "error");
  }
}

async function handleRunRepeatOffender() {
  const customerData = getFormData(elements);
  if (!validateCustomerFields(customerData)) return;
  showLoading("Checking Repeat Offender status...");
  try {
    const result = await runRepeatOffenderCheck(customerData);
    hideLoading();
    const cur = getCurrentResults() || { customer: customerData, checks: {}, timestamp: new Date().toISOString() };
    cur.customer = customerData;
    cur.checks = cur.checks || {};
    cur.checks.repeatOffender = result;
    setCurrentResults(cur);
    displayIndividualResult(elements, "repeatOffender", result);
  } catch (error) {
    hideLoading();
    showToast("Repeat Offender check failed: " + error.message, "error");
  }
}

async function handleRunTitle() {
  const customerData = getFormData(elements);
  if (!customerData.tradeVin) {
    showToast("VIN is required for title check", "warning");
    return;
  }
  showLoading("Checking Title & Lien status...");
  try {
    const result = await runTitleCheck(customerData);
    hideLoading();
    const cur = getCurrentResults() || { customer: customerData, checks: {}, timestamp: new Date().toISOString() };
    cur.customer = customerData;
    cur.checks = cur.checks || {};
    cur.checks.title = result;
    setCurrentResults(cur);
    displayIndividualResult(elements, "title", result);
  } catch (error) {
    hideLoading();
    showToast("Title check failed: " + error.message, "error");
  }
}

function handleClear() {
  isRunning = false;
  setButtonsDisabled(elements, false);
  chrome.storage.local.set({ searchStatus: "idle", searchProgress: 0 });

  // Clear buyer
  elements.firstName.value = "";
  elements.middleName.value = "";
  elements.lastName.value = "";
  elements.suffix.value = "";
  elements.dob.value = "";
  elements.dlnPid.value = "";
  elements.tradeVin.value = "";

  // Clear co-buyer
  if (elements.cbFirstName) elements.cbFirstName.value = "";
  if (elements.cbMiddleName) elements.cbMiddleName.value = "";
  if (elements.cbLastName) elements.cbLastName.value = "";
  if (elements.cbSuffix) elements.cbSuffix.value = "";
  if (elements.cbDob) elements.cbDob.value = "";
  if (elements.cbDlnPid) elements.cbDlnPid.value = "";
  if (elements.hasCoBuyer) elements.hasCoBuyer.checked = false;
  elements.coBuyerSection?.classList.add("hidden");

  chrome.storage.session.remove([
    "cachedFormData",
    "cachedAt",
    "repeatOffenderScreenshot",
    "titleScreenshot",
  ]);

  setCurrentResults(null);
  chrome.storage.local.remove([
    "currentResults",
    "repeatOffenderScreenshot",
    "coBuyerRepeatOffenderScreenshot",
    "titleScreenshot",
  ]);
  chrome.action.setBadgeText({ text: "" });

  elements.resultsSection.classList.add("hidden");
  elements.progressSection.classList.add("hidden");

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
    elements.dob.value = cust.dob || "";
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
      elements.cbDob.value = cust.coBuyer.dob || "";
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
    displayResults(elements, item.fullResults);
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
  printWindow.document.write(
    `<html><head><title>Compliance Screenshot</title></head><body style="margin:0;padding:20px;"><img src="${src}" style="max-width:100%;"/></body></html>`
  );
  printWindow.document.close();
  printWindow.print();
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

chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace !== "local") return;

  if (changes.searchProgress) {
    updateProgress(elements, changes.searchProgress.newValue || 0);
  }

  if (changes.currentResults?.newValue) {
    const next = changes.currentResults.newValue;
    setCurrentResults(next);
    const checks = next.checks || {};
    if (checks.ofac) {
      setCheckStatus(elements.ofacStatus, checks.ofac.passed ? "pass" : "fail");
    }
    if (checks.repeatOffender) {
      setCheckStatus(
        elements.repeatStatus,
        checks.repeatOffender.passed ? "pass" : "fail"
      );
    }
    if (checks.title) {
      setCheckStatus(
        elements.titleStatus,
        checks.title.passed ? "pass" : "warning"
      );
    }
  }

  if (changes.searchStatus) {
    const status = changes.searchStatus.newValue;

    if (status === "running") {
      isRunning = true;
      setButtonsDisabled(elements, true);
      elements.resultsSection.classList.add("hidden");
      elements.progressSection.classList.remove("hidden");

      // Reset pending result UI.
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
    } else if (status === "complete") {
      isRunning = false;
      setButtonsDisabled(elements, false);

      const results = getCurrentResults();
      if (results) {
        try {
          displayResults(elements, results);
          await saveToHistory(results);
          await updateHistoryCount(elements.historyCount);
        } catch (e) {
          console.error("Display/save error:", e);
        }
      }
      setTimeout(() => {
        elements.progressSection.classList.add("hidden");
        elements.resultsSection.classList.remove("hidden");
      }, 400);
    } else if (status === "error") {
      isRunning = false;
      setButtonsDisabled(elements, false);
      const errorMsg = changes.lastError?.newValue || "An error occurred.";
      showToast("Error: " + errorMsg, "error");
    }
  }
});
