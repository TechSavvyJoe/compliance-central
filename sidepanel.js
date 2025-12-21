/**
 * Compliance Central - Sidebar Panel JavaScript
 * Main UI orchestration for the unified compliance tool
 */

import { CONFIG } from "./lib/config.js";

// ============================================================================
// SECURITY UTILITIES
// ============================================================================

/**
 * Sanitize a string for safe HTML insertion
 * Prevents XSS attacks by escaping HTML special characters
 * @param {string} str - The string to sanitize
 * @returns {string} - The sanitized string
 */
function sanitizeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Build a full name string from customer data (sanitized)
 * @param {Object} customer - Customer object with firstName, middleName, lastName, suffix
 * @returns {string} - Sanitized full name string
 */
function buildSanitizedName(customer) {
  const parts = [
    sanitizeHTML(customer.firstName),
    sanitizeHTML(customer.middleName || ""),
    sanitizeHTML(customer.lastName),
  ].filter((p) => p.trim());

  let name = parts.join(" ");
  if (customer.suffix) {
    name += " " + sanitizeHTML(customer.suffix);
  }
  return name;
}

/**
 * Set up safe cleanup for print windows
 * Ensures window closes after print OR after timeout if user cancels
 * @param {Window} printWindow - The print window to manage
 * @param {number} timeoutMs - Timeout in ms before forcing close (default 5 min)
 */
function setupPrintWindowCleanup(printWindow, timeoutMs = 300000) {
  let closed = false;

  const closeWindow = () => {
    if (!closed && printWindow && !printWindow.closed) {
      closed = true;
      try {
        printWindow.close();
      } catch (e) {
        // Window may already be closed
      }
    }
  };

  // Primary: close after print dialog closes
  printWindow.onafterprint = closeWindow;

  // Fallback: close after timeout if still open (handles user cancel)
  setTimeout(() => {
    if (!closed && printWindow && !printWindow.closed) {
      console.log("[Print] Window still open after timeout, closing...");
      closeWindow();
    }
  }, timeoutMs);

  // Also close if window loses focus after print dialog
  // (handles ESC/cancel in many browsers)
  let printStarted = false;
  printWindow.onbeforeprint = () => {
    printStarted = true;
  };

  // Track when focus returns to main window (print dialog closed)
  const checkClose = () => {
    if (printStarted && !closed) {
      // Give a short delay for onafterprint to fire first
      setTimeout(() => {
        if (!closed && printWindow && !printWindow.closed) {
          closeWindow();
        }
      }, 1000);
    }
  };
  window.addEventListener("focus", checkClose, { once: true });
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let currentResults = null;
let isRunning = false;

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const elements = {
  // Form inputs - Buyer
  firstName: document.getElementById("firstName"),
  middleName: document.getElementById("middleName"),
  lastName: document.getElementById("lastName"),
  suffix: document.getElementById("suffix"),
  dob: document.getElementById("dob"),
  dlnPid: document.getElementById("dlnPid"),
  tradeVin: document.getElementById("tradeVin"),

  // Co-Buyer toggle and section
  hasCoBuyer: document.getElementById("hasCoBuyer"),
  coBuyerSection: document.getElementById("coBuyerSection"),

  // Form inputs - Co-Buyer
  cbFirstName: document.getElementById("cbFirstName"),
  cbMiddleName: document.getElementById("cbMiddleName"),
  cbLastName: document.getElementById("cbLastName"),
  cbSuffix: document.getElementById("cbSuffix"),
  cbDob: document.getElementById("cbDob"),
  cbDlnPid: document.getElementById("cbDlnPid"),

  // Buttons
  runAllChecksBtn: document.getElementById("runAllChecksBtn"),
  clearBtn: document.getElementById("clearBtn"),
  runOfacBtn: document.getElementById("runOfacBtn"),
  runRepeatOffenderBtn: document.getElementById("runRepeatOffenderBtn"),
  runTitleBtn: document.getElementById("runTitleBtn"),

  viewHistoryBtn: document.getElementById("viewHistoryBtn"),

  // Progress section
  progressSection: document.getElementById("progressSection"),
  ofacStatus: document.getElementById("ofacStatus"),
  repeatStatus: document.getElementById("repeatStatus"),
  titleStatus: document.getElementById("titleStatus"),
  titleCheckItem: document.getElementById("titleCheckItem"),
  progressFill: document.getElementById("progressFill"),
  progressPercent: document.getElementById("progressPercent"),
  progressSpinner: document.getElementById("progressSpinner"),
  progressLabel: document.getElementById("progressLabel"),

  // Results section
  resultsSection: document.getElementById("resultsSection"),
  finalDecision: document.getElementById("finalDecision"),
  ofacResultCard: document.getElementById("ofacResultCard"),
  ofacResultStatus: document.getElementById("ofacResultStatus"),
  ofacResultDetail: document.getElementById("ofacResultDetail"),
  repeatResultCard: document.getElementById("repeatResultCard"),
  repeatResultStatus: document.getElementById("repeatResultStatus"),
  repeatResultDetail: document.getElementById("repeatResultDetail"),
  titleResultCard: document.getElementById("titleResultCard"),
  titleResultStatus: document.getElementById("titleResultStatus"),
  titleResultDetail: document.getElementById("titleResultDetail"),
  // Individual print buttons
  printOfacBtn: document.getElementById("printOfacBtn"),
  printRepeatBtn: document.getElementById("printRepeatBtn"),
  printTitleBtn: document.getElementById("printTitleBtn"),
  // All actions buttons
  printAllBtn: document.getElementById("printAllBtn"),

  // Co-Buyer results section
  coBuyerResultsSection: document.getElementById("coBuyerResultsSection"),
  cbOfacResultCard: document.getElementById("cbOfacResultCard"),
  cbOfacResultStatus: document.getElementById("cbOfacResultStatus"),
  cbOfacResultDetail: document.getElementById("cbOfacResultDetail"),
  cbRepeatResultCard: document.getElementById("cbRepeatResultCard"),
  cbRepeatResultStatus: document.getElementById("cbRepeatResultStatus"),
  cbRepeatResultDetail: document.getElementById("cbRepeatResultDetail"),
  printCbOfacBtn: document.getElementById("printCbOfacBtn"),
  printCbRepeatBtn: document.getElementById("printCbRepeatBtn"),

  // History
  historyCount: document.getElementById("historyCount"),
  historyModal: document.getElementById("historyModal"),
  historyList: document.getElementById("historyList"),
  closeHistoryModal: document.getElementById("closeHistoryModal"),
  clearAllHistoryBtn: document.getElementById("clearAllHistoryBtn"),

  // Screenshot modal
  screenshotModal: document.getElementById("screenshotModal"),
  screenshotTitle: document.getElementById("screenshotTitle"),
  screenshotImage: document.getElementById("screenshotImage"),
  closeScreenshotModal: document.getElementById("closeScreenshotModal"),
  printScreenshot: document.getElementById("printScreenshotBtn"),
  downloadScreenshot: document.getElementById("downloadScreenshotBtn"),

  // Loading
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  initEventListeners();
  await loadCachedFormData();
  await loadPersistedResults(); // Load previous results if they exist
  await updateHistoryCount();

  // Privacy: Purge entries older than retention period on startup
  await purgeOldHistoryEntries();
});

// Load persisted results when sidebar reopens
async function loadPersistedResults() {
  try {
    const storage = await chrome.storage.local.get([
      "currentResults",
      "searchStatus",
      "searchProgress",
    ]);

    // 1. RESTORE RUNNING STATE (with timeout protection)
    if (storage.searchStatus === "running") {
      // Check if the search has been running too long (>2 minutes = likely stuck)
      const startTime = storage.currentResults?.timestamp;
      if (startTime) {
        const elapsed = Date.now() - new Date(startTime).getTime();
        const maxRunTime = CONFIG.timeouts.stuckSearchTimeout;
        if (elapsed > maxRunTime) {
          console.warn("[Sidepanel] Search appears stuck, resetting state...");
          await chrome.storage.local.set({
            searchStatus: "idle",
            searchProgress: 0,
          });
          isRunning = false;
          setButtonsDisabled(false);
          elements.progressSection.classList.add("hidden");
          return;
        }
      }

      isRunning = true;
      setButtonsDisabled(true);
      elements.resultsSection.classList.add("hidden");
      elements.progressSection.classList.remove("hidden");

      // Restore progress bar
      if (storage.searchProgress) {
        updateProgress(storage.searchProgress);
      }

      // Restore partial check statuses
      if (storage.currentResults) {
        currentResults = storage.currentResults;
        const checks = currentResults.checks || {};

        if (checks.ofac) {
          setCheckStatus("ofacStatus", checks.ofac.passed ? "pass" : "fail");
        }
        if (checks.repeatOffender) {
          setCheckStatus(
            "repeatStatus",
            checks.repeatOffender.passed ? "pass" : "fail"
          );
        }
        if (checks.title) {
          setCheckStatus(
            "titleStatus",
            checks.title.passed ? "pass" : "warning"
          );
        }
      }
      return; // Done restoring running state
    }

    // 2. RESTORE COMPLETED RESULTS
    if (storage.currentResults) {
      currentResults = storage.currentResults;
      // Only display if results are recent (within last 8 hours)
      const resultTime = new Date(currentResults.timestamp);
      const now = new Date();
      const hoursDiff = (now - resultTime) / (1000 * 60 * 60);

      if (hoursDiff < 8) {
        displayResults(currentResults);
        elements.resultsSection.classList.remove("hidden");
        elements.progressSection.classList.add("hidden");
      } else {
        // Results too old, clear them
        currentResults = null;
        await chrome.storage.local.remove([
          "currentResults",
          "searchStatus",
          "searchProgress",
        ]);
      }
    }
  } catch (error) {
    console.error("Error loading persisted results:", error);
  }
}

// Save results to storage whenever they change
async function persistResults() {
  if (currentResults) {
    try {
      await chrome.storage.local.set({ currentResults: currentResults });
    } catch (error) {
      console.error("Error persisting results:", error);
    }
  }
}

function initEventListeners() {
  // Main action buttons
  elements.runAllChecksBtn.addEventListener("click", handleRunAllChecks);
  elements.clearBtn.addEventListener("click", handleClear);
  elements.runOfacBtn.addEventListener("click", handleRunOfac);
  elements.runRepeatOffenderBtn.addEventListener(
    "click",
    handleRunRepeatOffender
  );
  elements.runTitleBtn.addEventListener("click", handleRunTitle);

  // Enable/disable title button based on VIN input
  elements.tradeVin.addEventListener("input", (e) => {
    const hasVin = e.target.value.trim().length > 0;
    elements.runTitleBtn.disabled = !hasVin;
  });

  // History
  elements.viewHistoryBtn.addEventListener("click", () => showModal("history"));
  elements.closeHistoryModal.addEventListener("click", () =>
    hideModal("history")
  );
  elements.clearAllHistoryBtn.addEventListener("click", clearAllHistory);

  // Delegated event handler for history list buttons (prevents memory leaks)
  // Single listener handles all button types instead of attaching per-button
  elements.historyList.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    e.stopPropagation();
    const index = parseInt(btn.getAttribute("data-index"));
    const history = window._historyData;
    if (!history || index < 0 || index >= history.length) return;

    const item = history[index];

    if (btn.classList.contains("history-view-btn")) {
      loadHistoryItem(item);
    } else if (btn.classList.contains("history-print-ofac")) {
      printHistoryOfac(item);
    } else if (btn.classList.contains("history-print-repeat")) {
      printHistoryRepeat(item);
    } else if (btn.classList.contains("history-print-title")) {
      printHistoryTitle(item);
    } else if (btn.classList.contains("history-print-all")) {
      printHistoryAll(item);
    }
  });

  // Screenshot modal
  elements.closeScreenshotModal.addEventListener("click", () =>
    hideModal("screenshot")
  );
  elements.printScreenshot.addEventListener("click", printScreenshot);
  elements.downloadScreenshot.addEventListener("click", downloadScreenshot);

  // Individual print buttons
  elements.printOfacBtn.addEventListener("click", printOfacReport);
  elements.printRepeatBtn.addEventListener("click", printRepeatScreenshot);
  elements.printTitleBtn.addEventListener("click", printTitleScreenshot);

  // Co-Buyer print buttons
  elements.printCbOfacBtn?.addEventListener("click", printCoBuyerOfacReport);
  elements.printCbRepeatBtn?.addEventListener(
    "click",
    printCoBuyerRepeatScreenshot
  );

  // Print All
  elements.printAllBtn.addEventListener("click", printAllReports);

  // Cache form data on change
  [
    "firstName",
    "middleName",
    "lastName",
    "suffix",
    "dob",
    "dlnPid",
    "tradeVin",
    "cbFirstName",
    "cbMiddleName",
    "cbLastName",
    "cbSuffix",
    "cbDob",
    "cbDlnPid",
  ].forEach((id) => {
    elements[id]?.addEventListener("change", cacheFormData);
  });

  // Co-Buyer checkbox toggle
  elements.hasCoBuyer?.addEventListener("change", (e) => {
    if (elements.coBuyerSection) {
      elements.coBuyerSection.classList.toggle("hidden", !e.target.checked);
    }
  });

  // Trade-In Section Toggle
  const tradeHeader = document.getElementById("tradeSectionHeader");
  const tradeContent = document.getElementById("tradeSectionContent");
  if (tradeHeader && tradeContent) {
    tradeHeader.addEventListener("click", () => {
      const isCollapsed = tradeContent.classList.toggle("collapsed");
      const toggleIcon = tradeHeader.querySelector(".section-toggle");
      if (toggleIcon) {
        // Rotate if NOT collapsed
        toggleIcon.classList.toggle("rotated", !isCollapsed);
      }
    });
  }
}

// ============================================================================
// FORM DATA HELPERS
// ============================================================================

function getFormData() {
  const hasCoBuyer = elements.hasCoBuyer?.checked || false;

  const data = {
    firstName: elements.firstName.value.trim(),
    middleName: elements.middleName?.value.trim() || "",
    lastName: elements.lastName.value.trim(),
    suffix: elements.suffix?.value || "",
    dob: elements.dob.value,
    dlnPid: elements.dlnPid.value.trim(),
    tradeVin: elements.tradeVin.value.trim().toUpperCase(),
    hasCoBuyer: hasCoBuyer,
  };

  // Include co-buyer data if checkbox is checked
  if (hasCoBuyer) {
    data.coBuyer = {
      firstName: elements.cbFirstName?.value.trim() || "",
      middleName: elements.cbMiddleName?.value.trim() || "",
      lastName: elements.cbLastName?.value.trim() || "",
      suffix: elements.cbSuffix?.value || "",
      dob: elements.cbDob?.value || "",
      dlnPid: elements.cbDlnPid?.value.trim() || "",
    };
  }

  return data;
}

function validateCustomerFields(data) {
  const missing = [];
  if (!data.firstName) missing.push("First Name");
  if (!data.lastName) missing.push("Last Name");
  if (!data.dob) missing.push("Date of Birth");
  if (!data.dlnPid) missing.push("DLN/PID");

  if (missing.length > 0) {
    alert(`Please fill in required fields: ${missing.join(", ")}`);
    return false;
  }
  return true;
}

async function cacheFormData() {
  const data = getFormData();
  await chrome.storage.session.set({
    cachedFormData: data,
    cachedAt: Date.now(),
  });
}

async function loadCachedFormData() {
  try {
    const result = await chrome.storage.session.get([
      "cachedFormData",
      "cachedAt",
    ]);
    if (result.cachedFormData && result.cachedAt) {
      // Only use cache if less than 10 minutes old
      const cacheAge = Date.now() - result.cachedAt;
      if (cacheAge < CONFIG.timeouts.formCacheExpiry) {
        const data = result.cachedFormData;
        elements.firstName.value = data.firstName || "";
        if (elements.middleName)
          elements.middleName.value = data.middleName || "";
        elements.lastName.value = data.lastName || "";
        if (elements.suffix) elements.suffix.value = data.suffix || "";
        elements.dob.value = data.dob || "";
        elements.dlnPid.value = data.dlnPid || "";
        elements.tradeVin.value = data.tradeVin || "";

        // Update title button state
        elements.runTitleBtn.disabled = !data.tradeVin;
      }
    }
  } catch (error) {
    console.error("Error loading cached form data:", error);
  }
}

// ============================================================================
// CLEAR FORM AND RESULTS
// ============================================================================

function handleClear() {
  // Reset running state to fix stuck buttons
  isRunning = false;
  setButtonsDisabled(false);
  chrome.storage.local.set({
    searchStatus: "idle",
    searchProgress: 0,
  });

  // Clear form inputs - Buyer
  elements.firstName.value = "";
  elements.middleName.value = "";
  elements.lastName.value = "";
  elements.suffix.value = "";
  elements.dob.value = "";
  elements.dlnPid.value = "";
  elements.tradeVin.value = "";

  // Clear form inputs - Co-Buyer
  if (elements.cbFirstName) elements.cbFirstName.value = "";
  if (elements.cbMiddleName) elements.cbMiddleName.value = "";
  if (elements.cbLastName) elements.cbLastName.value = "";
  if (elements.cbSuffix) elements.cbSuffix.value = "";
  if (elements.cbDob) elements.cbDob.value = "";
  if (elements.cbDlnPid) elements.cbDlnPid.value = "";

  // Reset co-buyer checkbox and hide section
  if (elements.hasCoBuyer) {
    elements.hasCoBuyer.checked = false;
  }
  if (elements.coBuyerSection) {
    elements.coBuyerSection.classList.add("hidden");
  }

  // Clear cached form data from session storage
  chrome.storage.session.remove([
    "cachedFormData",
    "cachedAt",
    "repeatOffenderScreenshot",
    "titleScreenshot",
  ]);

  // Clear results from local storage
  currentResults = null;
  chrome.storage.local.remove([
    "currentResults",
    "repeatOffenderScreenshot",
    "titleScreenshot",
  ]);

  // Reset extension badge
  chrome.action.setBadgeText({ text: "" });

  // Hide results section and show form
  elements.resultsSection.classList.add("hidden");
  elements.progressSection.classList.add("hidden");

  // Reset progress indicators
  setCheckStatus("ofacStatus", "waiting");
  setCheckStatus("repeatStatus", "waiting");
  setCheckStatus("titleStatus", "waiting");
  updateProgress(0);

  // Disable title button (no VIN entered)
  elements.runTitleBtn.disabled = true;

  // Focus on first input
  elements.firstName.focus();
}

// ============================================================================
// RUN ALL CHECKS (Sequential Automation)
// ============================================================================

// ============================================================================
// RUN ALL CHECKS (Background Orchestration)
// ============================================================================

async function handleRunAllChecks() {
  const customerData = getFormData();

  if (!validateCustomerFields(customerData)) return;
  if (isRunning) return;

  isRunning = true;
  setButtonsDisabled(true);

  const hasTrade = customerData.tradeVin && customerData.tradeVin.length > 0;

  // Show progress section, hide results
  elements.resultsSection.classList.add("hidden");
  elements.progressSection.classList.remove("hidden");

  // Setup initial UI state
  resetProgress();
  if (!hasTrade) {
    elements.titleCheckItem.style.opacity = "0.5";
    setCheckStatus("titleStatus", "skipped");
  } else {
    elements.titleCheckItem.style.opacity = "1";
    setCheckStatus("titleStatus", "waiting");
  }

  // Persist form data immediately
  await cacheFormData();

  // Send start command to Service Worker
  try {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_ALL_CHECKS",
      data: {
        customer: customerData,
        hasTrade: hasTrade,
      },
    });

    if (!response || !response.success) {
      throw new Error("Failed to start background checks");
    }
  } catch (e) {
    console.error("Start Check Error:", e);
    alert("Could not start checks: " + e.message);
    isRunning = false;
    setButtonsDisabled(false);
    elements.progressSection.classList.add("hidden");
  }
}

// STORAGE LISTENER - THE CORE OF REACTIVITY
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace !== "local") return;

  // 1. Progress Updates
  if (changes.searchProgress) {
    updateProgress(changes.searchProgress.newValue || 0);
  }

  // 2. Result Updates (Incremental)
  if (changes.currentResults && changes.currentResults.newValue) {
    currentResults = changes.currentResults.newValue;
    const checks = currentResults.checks || {};

    // Update individual statuses as they come in
    if (checks.ofac) {
      setCheckStatus("ofacStatus", checks.ofac.passed ? "pass" : "fail");
    }
    if (checks.repeatOffender) {
      setCheckStatus(
        "repeatStatus",
        checks.repeatOffender.passed ? "pass" : "fail"
      );
    }
    if (checks.title) {
      setCheckStatus("titleStatus", checks.title.passed ? "pass" : "warning");
    }
  }

  // 3. Status Changes (Running -> Complete/Error)
  if (changes.searchStatus) {
    const status = changes.searchStatus.newValue;
    console.log("[Sidepanel] Status changed to:", status);

    if (status === "running") {
      isRunning = true;
      setButtonsDisabled(true);
      elements.resultsSection.classList.add("hidden");
      elements.progressSection.classList.remove("hidden");

      // Clear previous results to prevent stale data
      if (elements.ofacResultStatus) {
        elements.ofacResultStatus.textContent = "Pending...";
        elements.ofacResultStatus.className = "result-status";
        elements.ofacResultDetail.textContent = "";
      }
      if (elements.repeatResultStatus) {
        elements.repeatResultStatus.textContent = "Pending...";
        elements.repeatResultStatus.className = "result-status";
        elements.repeatResultDetail.textContent = "";
      }
      if (elements.titleResultStatus) {
        elements.titleResultStatus.textContent = "Pending...";
        elements.titleResultStatus.className = "result-status";
        elements.titleResultDetail.textContent = "";
      }
      // Reset Final Decision
      if (elements.finalDecision) elements.finalDecision.innerHTML = "";
    } else if (status === "complete") {
      isRunning = false;
      setButtonsDisabled(false);

      // Load final results to be sure we have latest
      // Use the storage value if available in changes, or fall back to current
      if (currentResults) {
        try {
          console.log("[Sidepanel] Displaying final results...");
          displayResults(currentResults);

          // Save to history
          console.log("[Sidepanel] Saving to history...");
          await saveToHistory(currentResults);
        } catch (e) {
          console.error("[Sidepanel] Error displaying/saving results:", e);
        }
      }

      // Force Transition of UI
      console.log("[Sidepanel] Transitioning to Results UI...");
      setTimeout(() => {
        elements.progressSection.classList.add("hidden");
        elements.resultsSection.classList.remove("hidden");
      }, 500);
    } else if (status === "error") {
      isRunning = false;
      setButtonsDisabled(false);
      const errorMsg = changes.lastError?.newValue || "An error occurred.";
      alert("Error: " + errorMsg);
    }
  }
});

// ============================================================================
// INDIVIDUAL CHECK HANDLERS
// ============================================================================

async function handleRunOfac() {
  const customerData = getFormData();
  if (!customerData.firstName || !customerData.lastName) {
    alert("Name is required for OFAC check");
    return;
  }

  showLoading("Running OFAC screening...");
  try {
    const result = await runOfacCheck(customerData);
    hideLoading();
    displayIndividualResult("ofac", result);
  } catch (error) {
    hideLoading();
    alert("OFAC check failed: " + error.message);
  }
}

async function handleRunRepeatOffender() {
  const customerData = getFormData();
  if (!validateCustomerFields(customerData)) return;

  showLoading("Checking Repeat Offender status...");
  try {
    const result = await runRepeatOffenderCheck(customerData);
    hideLoading();
    displayIndividualResult("repeatOffender", result);
  } catch (error) {
    hideLoading();
    alert("Repeat Offender check failed: " + error.message);
  }
}

async function handleRunTitle() {
  const customerData = getFormData();
  if (!customerData.tradeVin) {
    alert("VIN is required for title check");
    return;
  }

  showLoading("Checking Title & Lien status...");
  try {
    const result = await runTitleCheck(customerData);
    hideLoading();
    displayIndividualResult("title", result);
  } catch (error) {
    hideLoading();
    alert("Title check failed: " + error.message);
  }
}

// ============================================================================
// CHECK EXECUTION (Messaging to Service Worker)
// ============================================================================

async function runOfacCheck(customerData) {
  const response = await chrome.runtime.sendMessage({
    type: "RUN_OFAC_CHECK",
    data: {
      firstName: customerData.firstName,
      middleName: customerData.middleName,
      lastName: customerData.lastName,
      dob: customerData.dob,
    },
  });

  if (!response.success) {
    throw new Error(response.error || "OFAC check failed");
  }

  return {
    passed: !response.result.hasMatch,
    matches: response.result.matches || [],
    matchCount: response.result.matchCount || 0,
    entriesSearched: response.result.entriesSearched || 0,
    timestamp: new Date().toISOString(),
  };
}

async function runRepeatOffenderCheck(customerData) {
  const response = await chrome.runtime.sendMessage({
    type: "RUN_REPEAT_OFFENDER",
    data: {
      firstName: customerData.firstName,
      middleName: customerData.middleName,
      lastName: customerData.lastName,
      suffix: customerData.suffix,
      dob: customerData.dob,
      dlnPid: customerData.dlnPid,
    },
  });

  if (!response.success) {
    throw new Error(response.error || "Repeat Offender check failed");
  }

  let screenshotData = response.result.screenshotData;

  // If screenshotData wasn't in the message (possibly due to size limits),
  // try to retrieve it from local storage
  if (!screenshotData) {
    console.log(
      "[runRepeatOffenderCheck] No screenshotData in response, checking local storage..."
    );
    try {
      const stored = await chrome.storage.local.get("repeatOffenderScreenshot");
      if (stored.repeatOffenderScreenshot) {
        screenshotData = stored.repeatOffenderScreenshot;
        console.log(
          "[runRepeatOffenderCheck] Retrieved screenshot from storage, length:",
          screenshotData?.length
        );
        // Clear it after reading to prevent stale data in future
        chrome.storage.local.remove("repeatOffenderScreenshot");
      }
    } catch (e) {
      console.log(
        "[runRepeatOffenderCheck] Could not retrieve from local storage:",
        e.message
      );
    }
  } else {
    console.log(
      "[runRepeatOffenderCheck] Screenshot in response, length:",
      screenshotData?.length
    );
  }

  // Status is "eligible" or "ineligible" from original extension
  return {
    passed: response.result.status === "eligible",
    status: response.result.status,
    rawText: response.result.rawText || "",
    screenshotData: screenshotData,
    timestamp: new Date().toISOString(),
  };
}

async function runTitleCheck(customerData) {
  const response = await chrome.runtime.sendMessage({
    type: "RUN_TITLE_CHECK",
    data: {
      vin: customerData.tradeVin,
    },
  });

  if (!response.success) {
    throw new Error(response.error || "Title check failed");
  }

  const result = response.result;

  // Get screenshot - try message first, then local storage
  let screenshotData = result.screenshotData;
  if (!screenshotData) {
    try {
      const stored = await chrome.storage.local.get("titleScreenshot");
      if (stored.titleScreenshot) {
        screenshotData = stored.titleScreenshot;
        // Clear it after reading
        chrome.storage.local.remove("titleScreenshot");
      }
    } catch (e) {
      console.log(
        "[runTitleCheck] Could not retrieve from local storage:",
        e.message
      );
    }
  }

  return {
    passed: result.passed ?? (result.titleBrand === "CLEAN" && !result.hasLien),
    // Vehicle info
    year: result.year,
    make: result.make,
    model: result.model,
    unladenWeight: result.unladenWeight,
    // Title info
    titleBrand: result.titleBrand || "CLEAN",
    titleType: result.titleType || "UNKNOWN",
    titleIssued: result.titleIssued,
    // Lien info
    lienStatus: result.lienStatus || "UNKNOWN",
    hasLien: result.hasLien || false,
    lienHolder: result.lienHolder,
    // Brands
    vehicleBrands: result.vehicleBrands || [],
    // Screenshot & metadata
    screenshotData: screenshotData,
    rawText: result.rawText,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// DECISION LOGIC
// ============================================================================

function calculateFinalDecision(checks) {
  const ofacPass = checks.ofac?.passed ?? false;
  const repeatPass = checks.repeatOffender?.passed ?? false;

  // Co-Buyer status
  const cbOfacPass = checks.coBuyerOfac ? checks.coBuyerOfac.passed : true;
  const cbRepeatPass = checks.coBuyerRepeatOffender
    ? checks.coBuyerRepeatOffender.passed
    : true;

  console.log(
    "[Verdicts] OFAC:",
    ofacPass,
    "Co-Buyer OFAC:",
    cbOfacPass,
    "Full Objects:",
    checks
  );

  // Hard stops (customer checks)
  if (!ofacPass || !cbOfacPass) {
    return {
      approved: false,
      level: "DENIED",
      reason: "OFAC match found - cannot proceed with transaction",
    };
  }

  if (!repeatPass || !cbRepeatPass) {
    return {
      approved: false,
      level: "DENIED",
      reason: "Repeat offender status - registration will be denied",
    };
  }

  // Trade warnings (if trade exists)
  if (checks.title) {
    const titleBrand = checks.title.titleBrand;

    // Only flag if there's an actual brand (not clean, unknown, undefined, null, or empty)
    const hasProblemBrand =
      titleBrand &&
      titleBrand !== "CLEAN" &&
      titleBrand !== "UNKNOWN" &&
      titleBrand !== "undefined" &&
      titleBrand.toLowerCase() !== "none" &&
      titleBrand.toLowerCase() !== "no brands" &&
      !titleBrand.toLowerCase().includes("no brand");

    if (hasProblemBrand) {
      return {
        approved: false,
        level: "REVIEW",
        reason: `Trade title branded as ${titleBrand} - requires disclosure`,
        warnings: [],
      };
    }

    if (checks.title.hasLien) {
      return {
        approved: true,
        level: "APPROVED",
        reason: "Customer checks passed - trade has active lien",
        warnings: [
          `Trade lien: ${
            checks.title.lienHolder || "Unknown"
          } - payoff required`,
        ],
      };
    }
  }

  // All clear
  return {
    approved: true,
    level: "APPROVED",
    reason: "All checks passed - clear to proceed",
    warnings: [],
  };
}

// ============================================================================
// UI UPDATE FUNCTIONS
// ============================================================================

function resetProgress() {
  updateProgress(0);
  setCheckStatus("ofacStatus", "waiting");
  setCheckStatus("repeatStatus", "waiting");
  setCheckStatus("titleStatus", "waiting");
}

// Progress Bar Animation State
let currentProgress = 0;
let targetProgress = 0;
let progressAnimationId = null;

function updateProgress(percent, label) {
  // Update target, but don't jump immediately
  targetProgress = percent;

  // Custom label handling
  if (label && elements.progressLabel) {
    elements.progressLabel.textContent = label;
  }

  // Start animation loop if not running
  if (!progressAnimationId) {
    animateProgress();
  }
}

function animateProgress() {
  // Smoothly move current towards target
  if (currentProgress < targetProgress) {
    // Variable speed: faster at start, slower as it gets closer (ease-out)
    // But maintain a minimum speed so it doesn't stall
    const delta = targetProgress - currentProgress;
    const step = Math.max(0.1, delta * 0.05);
    currentProgress = Math.min(targetProgress, currentProgress + step);
  } else if (currentProgress > targetProgress) {
    // Instant reset if going backwards (e.g. new search)
    currentProgress = targetProgress;
  }

  // Render
  const displayPercent = Math.round(currentProgress * 10) / 10; // 1 decimal place
  elements.progressFill.style.width = displayPercent + "%";
  elements.progressPercent.textContent = Math.round(displayPercent) + "%";

  // Auto-generate label if not set manually
  if (
    elements.progressLabel &&
    !elements.progressLabel.textContent.includes("Extracting")
  ) {
    if (displayPercent < 20) {
      elements.progressLabel.textContent = "Running OFAC check...";
    } else if (displayPercent < 50) {
      elements.progressLabel.textContent = "Checking Repeat Offender...";
    } else if (displayPercent < 90) {
      elements.progressLabel.textContent = "Verifying Title & Lien...";
    } else if (displayPercent < 100) {
      elements.progressLabel.textContent = "Finalizing report...";
    } else {
      elements.progressLabel.textContent = "Complete!";
    }
  }

  // Stop or continue animation
  if (
    Math.abs(currentProgress - targetProgress) < 0.1 &&
    targetProgress >= 100
  ) {
    progressAnimationId = null;
    // Hide spinner when fully complete (visual delay)
    if (elements.progressSpinner) {
      setTimeout(() => (elements.progressSpinner.style.display = "none"), 500);
    }
  } else {
    // Keep animating if not at target or not complete
    progressAnimationId = requestAnimationFrame(animateProgress);
    if (elements.progressSpinner) {
      elements.progressSpinner.style.display = "inline-block";
    }
  }
}

function setCheckStatus(elementId, status) {
  const el = elements[elementId];
  if (!el) return;

  const statusMap = {
    waiting: { text: "⏳ Waiting", class: "status-waiting" },
    running: { text: "⏳ Running...", class: "status-running" },
    pass: { text: "✅ Pass", class: "status-pass" },
    fail: { text: "❌ Failed", class: "status-fail" },
    warning: { text: "⚠️ Review", class: "status-warning" },
    skipped: { text: "⏭️ Skipped", class: "status-skipped" },
  };

  const config = statusMap[status] || { text: status, class: "" };
  el.textContent = config.text;
  el.className = "status-indicator " + config.class;
}

function displayResults(results) {
  // Compute finalDecision locally if not provided by Service Worker
  if (!results.finalDecision) {
    results.finalDecision = calculateFinalDecision(results.checks);
  }
  const decision = results.finalDecision;

  // Set decision badge
  let badgeClass, badgeText;

  if (decision.level === "APPROVED") {
    badgeClass = "decision-approved";
    badgeText = "✅ APPROVED";
  } else if (decision.level === "REVIEW") {
    badgeClass = "decision-review";
    badgeText = "⚠️ REVIEW REQUIRED";
  } else {
    badgeClass = "decision-denied";
    badgeText = "❌ DENIED";
  }

  elements.finalDecision.innerHTML = `
    <div class="decision-badge ${badgeClass}">
      ${badgeText}
    </div>
    <p class="decision-text">${decision.reason}</p>
    ${
      decision.warnings?.length
        ? '<p class="decision-warnings">' +
          decision.warnings.join("<br>") +
          "</p>"
        : ""
    }
  `;

  // Update OFAC result
  if (results.checks.ofac) {
    elements.ofacResultStatus.textContent = results.checks.ofac.passed
      ? "✅ Pass"
      : "❌ Match";
    elements.ofacResultStatus.className =
      "result-status " +
      (results.checks.ofac.passed ? "status-pass" : "status-fail");
    elements.ofacResultDetail.textContent = results.checks.ofac.passed
      ? "No matches in SDN list"
      : `${results.checks.ofac.matches?.length || 0} potential match(es) found`;
  }

  // Update Repeat Offender result
  if (results.checks.repeatOffender) {
    // Determine status text/class
    if (results.checks.repeatOffender.status === "error") {
      elements.repeatResultStatus.textContent = "⚠️ Error";
      elements.repeatResultStatus.className = "result-status status-warning";
      elements.repeatResultDetail.textContent =
        results.checks.repeatOffender.error || "Unknown error occurred";
    } else {
      elements.repeatResultStatus.textContent = results.checks.repeatOffender
        .passed
        ? "✅ Pass"
        : "❌ Found";
      elements.repeatResultStatus.className =
        "result-status " +
        (results.checks.repeatOffender.passed ? "status-pass" : "status-fail");
      elements.repeatResultDetail.textContent = results.checks.repeatOffender
        .passed
        ? "No offenses found"
        : results.checks.repeatOffender.status;
    }

    const hasScreenshot = !!results.checks.repeatOffender.screenshotData;
    console.log(
      "[displayResults] Repeat Offender screenshotData present:",
      hasScreenshot,
      "Length:",
      results.checks.repeatOffender.screenshotData?.length || 0
    );
    // FORCE SHOW BUTTONS regardless of screenshot presence
    // This ensures UI availability even if capture has issues
    elements.printRepeatBtn.classList.remove("hidden");
  }

  // Update Title result
  if (results.checks.title) {
    const title = results.checks.title;
    let statusText, statusClass;

    // Handle error case first
    if (title.error) {
      statusText = "⚠️ Check Failed";
      statusClass = "status-warning";
      elements.titleResultStatus.textContent = statusText;
      elements.titleResultStatus.className = "result-status " + statusClass;
      elements.titleResultDetail.textContent =
        title.error || "Unable to complete Title check";
      elements.printTitleBtn.classList.add("hidden");
    } else {
      // Normal result case
      if (title.passed) {
        statusText = "✅ Clear";
        statusClass = "status-pass";
      } else if (title.hasLien) {
        statusText = "⚠️ Lien";
        statusClass = "status-warning";
      } else if (title.titleBrand && title.titleBrand !== "CLEAN") {
        statusText = `⚠️ ${title.titleBrand}`;
        statusClass = "status-warning";
      } else {
        statusText = "✅ Clear";
        statusClass = "status-pass";
      }

      elements.titleResultStatus.textContent = statusText;
      elements.titleResultStatus.className = "result-status " + statusClass;

      // Build detailed text with vehicle info
      let detailLines = [];

      // Vehicle info
      if (title.year && title.make && title.model) {
        detailLines.push(`${title.year} ${title.make} ${title.model}`);
      }

      // Title info
      if (title.titleType && title.titleType !== "UNKNOWN") {
        detailLines.push(
          `Title: ${title.titleType}${
            title.titleIssued ? ` (${title.titleIssued})` : ""
          }`
        );
      }

      // Lien status
      if (title.lienStatus && title.lienStatus !== "UNKNOWN") {
        detailLines.push(`Lien: ${title.lienStatus}`);
      }

      // Brands
      if (title.vehicleBrands && title.vehicleBrands.length > 0) {
        detailLines.push(`Brands: ${title.vehicleBrands.join(", ")}`);
      } else if (title.titleBrand === "CLEAN") {
        detailLines.push("No title brands");
      }

      elements.titleResultDetail.textContent =
        detailLines.length > 0
          ? detailLines.join("\n")
          : "Title information retrieved";

      // Show/hide print and download buttons
      const hasTitleScreenshot = !!title.screenshotData;
      console.log(
        "[displayResults] Title screenshotData present:",
        hasTitleScreenshot,
        "Length:",
        title.screenshotData?.length || 0
      );
      // FORCE SHOW BUTTONS regardless of screenshot presence
      // This ensures UI availability even if capture has issues
      elements.printTitleBtn.classList.remove("hidden");
    }
  } else {
    elements.titleResultStatus.textContent = "⏭️ No Trade";
    elements.titleResultStatus.className = "result-status status-skipped";
    elements.titleResultDetail.textContent = "No trade-in provided";
    elements.printTitleBtn.classList.add("hidden");
  }

  // ========== CO-BUYER RESULTS ==========
  const hasCoBuyer =
    results.checks.coBuyerOfac || results.checks.coBuyerRepeatOffender;

  if (hasCoBuyer) {
    // Show co-buyer results section
    if (elements.coBuyerResultsSection) {
      elements.coBuyerResultsSection.classList.remove("hidden");
    }

    // Update Co-Buyer OFAC result
    if (results.checks.coBuyerOfac) {
      const cbOfac = results.checks.coBuyerOfac;
      elements.cbOfacResultStatus.textContent = cbOfac.passed
        ? "✅ Pass"
        : "❌ Match";
      elements.cbOfacResultStatus.className =
        "result-status " + (cbOfac.passed ? "status-pass" : "status-fail");
      elements.cbOfacResultDetail.textContent = cbOfac.passed
        ? "No matches in SDN list"
        : `${cbOfac.matches?.length || 0} potential match(es) found`;
    }

    // Update Co-Buyer Repeat Offender result
    if (results.checks.coBuyerRepeatOffender) {
      const cbRepeat = results.checks.coBuyerRepeatOffender;
      elements.cbRepeatResultStatus.textContent = cbRepeat.passed
        ? "✅ Pass"
        : "❌ Found";
      elements.cbRepeatResultStatus.className =
        "result-status " + (cbRepeat.passed ? "status-pass" : "status-fail");
      elements.cbRepeatResultDetail.textContent = cbRepeat.passed
        ? "No offenses found"
        : cbRepeat.status;
      // Show print button
      elements.printCbRepeatBtn?.classList.remove("hidden");
    }
  } else {
    // Hide co-buyer results section
    if (elements.coBuyerResultsSection) {
      elements.coBuyerResultsSection.classList.add("hidden");
    }
  }
}

function displayIndividualResult(type, result) {
  elements.resultsSection.classList.remove("hidden");

  if (type === "ofac") {
    elements.ofacResultStatus.textContent = result.passed
      ? "✅ Pass"
      : "❌ Match";
    elements.ofacResultStatus.className =
      "result-status " + (result.passed ? "status-pass" : "status-fail");
    elements.ofacResultDetail.textContent = result.passed
      ? "No matches in SDN list"
      : `${result.matches?.length || 0} potential match(es) found`;
  } else if (type === "repeatOffender") {
    elements.repeatResultStatus.textContent = result.passed
      ? "✅ Pass"
      : "❌ Found";
    elements.repeatResultStatus.className =
      "result-status " + (result.passed ? "status-pass" : "status-fail");
    elements.repeatResultDetail.textContent = result.passed
      ? "No offenses found"
      : result.status;
    if (result.screenshotData) {
      currentResults = currentResults || { checks: {} };
      currentResults.checks.repeatOffender = result;
    }
  } else if (type === "title") {
    const title = result;
    elements.titleResultStatus.textContent = title.passed
      ? "✅ Clear"
      : "⚠️ Review";
    elements.titleResultStatus.className =
      "result-status " + (title.passed ? "status-pass" : "status-warning");

    let detailText = `Title: ${title.titleBrand}`;
    if (title.hasLien) detailText += `\nLien: ${title.lienHolder || "Yes"}`;
    elements.titleResultDetail.textContent = detailText;

    if (title.screenshotData) {
      currentResults = currentResults || { checks: {} };
      currentResults.checks.title = result;
    }
  }
}

function setButtonsDisabled(disabled) {
  elements.runAllChecksBtn.disabled = disabled;
  elements.runOfacBtn.disabled = disabled;
  elements.runRepeatOffenderBtn.disabled = disabled;
  elements.runTitleBtn.disabled = disabled || !elements.tradeVin.value.trim();
}

// ============================================================================
// HISTORY MANAGEMENT
// ============================================================================

// Data retention: automatically purge entries older than configured days
const DATA_RETENTION_DAYS = CONFIG.limits.dataRetentionDays;

/**
 * Purge history entries older than retention period
 * @returns {Promise<number>} - Number of entries purged
 */
async function purgeOldHistoryEntries() {
  try {
    const storage = await chrome.storage.local.get("complianceHistory");
    const history = storage.complianceHistory || [];

    if (history.length === 0) return 0;

    const cutoffDate = Date.now() - DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const filtered = history.filter((entry) => {
      try {
        const entryTime = new Date(entry.timestamp).getTime();
        return entryTime > cutoffDate;
      } catch {
        // If timestamp is invalid, keep the entry
        return true;
      }
    });

    const purgedCount = history.length - filtered.length;

    if (purgedCount > 0) {
      await chrome.storage.local.set({ complianceHistory: filtered });
      console.log(
        `[Privacy] Purged ${purgedCount} entries older than ${DATA_RETENTION_DAYS} days`
      );
    }

    return purgedCount;
  } catch (error) {
    console.error("Error purging old history:", error);
    return 0;
  }
}

async function saveToHistory(results) {
  try {
    // Purge old entries before adding new ones (privacy/data retention)
    await purgeOldHistoryEntries();

    // Ensure finalDecision is calculated
    if (!results.finalDecision) {
      results.finalDecision = calculateFinalDecision(results.checks);
    }

    const storage = await chrome.storage.local.get("complianceHistory");
    const history = storage.complianceHistory || [];

    history.unshift({
      id: Date.now(),
      customer: `${results.customer.firstName} ${results.customer.lastName}`,
      vin: results.customer.tradeVin || null,
      timestamp: results.timestamp,
      decision: results.finalDecision?.level || "UNKNOWN",
      checks: {
        ofac: results.checks.ofac?.passed,
        repeatOffender: results.checks.repeatOffender?.passed,
        title: results.checks.title?.passed,
      },
      // Store full results for restoration (enabled by unlimitedStorage)
      fullResults: results,
    });

    // Keep only the configured max number of entries
    if (history.length > CONFIG.limits.maxHistoryEntries) {
      history.length = CONFIG.limits.maxHistoryEntries;
    }

    await chrome.storage.local.set({ complianceHistory: history });
    console.log("[Sidepanel] History saved successfully");

    // Update the history count display
    await updateHistoryCount();
  } catch (error) {
    console.error("Error saving to history:", error);
  }
}

async function updateHistoryCount() {
  try {
    const storage = await chrome.storage.local.get("complianceHistory");
    const history = storage.complianceHistory || [];

    // Count today's checks
    const today = new Date().toDateString();
    const todayCount = history.filter((item) => {
      try {
        return new Date(item.timestamp).toDateString() === today;
      } catch (e) {
        return false;
      }
    }).length;

    elements.historyCount.textContent = `${todayCount} today`;

    // Also show total count if there are more in history
    if (history.length > todayCount) {
      elements.historyCount.textContent = `${todayCount} today, ${history.length} total`;
    }
  } catch (error) {
    console.error("Error updating history count:", error);
  }
}

async function clearAllHistory() {
  // Show confirmation dialog
  const confirmed = confirm(
    "Are you sure you want to clear ALL compliance history?\n\nThis action cannot be undone."
  );

  if (!confirmed) {
    return;
  }

  // Second confirmation for safety
  const doubleConfirmed = confirm(
    "Final confirmation: Delete all history entries permanently?"
  );

  if (!doubleConfirmed) {
    return;
  }

  try {
    await chrome.storage.local.remove("complianceHistory");

    // Update UI
    elements.historyList.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #94a3b8;">
        <p>📋 No history entries</p>
        <p style="font-size: 12px;">Completed checks will appear here</p>
      </div>
    `;

    await updateHistoryCount();

    alert("All history has been cleared.");
  } catch (error) {
    console.error("Error clearing history:", error);
    alert("Failed to clear history. Please try again.");
  }
}

async function populateHistoryModal() {
  try {
    const storage = await chrome.storage.local.get("complianceHistory");
    const history = storage.complianceHistory || [];

    if (history.length === 0) {
      elements.historyList.innerHTML =
        '<p class="history-empty">No compliance checks yet</p>';
      return;
    }

    // Store history for later access by download functions
    window._historyData = history;

    elements.historyList.innerHTML = history
      .slice(0, 50)
      .map((item, index) => {
        const date = new Date(item.timestamp);
        const timeStr = date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const dateStr = date.toLocaleDateString();

        let decisionClass = "status-pass";
        let decisionIcon = "✅";
        if (item.decision === "DENIED") {
          decisionClass = "status-fail";
          decisionIcon = "❌";
        } else if (item.decision === "REVIEW") {
          decisionClass = "status-warning";
          decisionIcon = "⚠️";
        }

        // Build check status icons
        const checks = item.checks || {};
        const fullResults = item.fullResults;

        // OFAC status
        const ofacStatus =
          checks.ofac !== undefined ? (checks.ofac ? "✅" : "❌") : "—";

        // Repeat Offender status
        const repeatStatus =
          checks.repeatOffender !== undefined
            ? checks.repeatOffender
              ? "✅"
              : "❌"
            : "—";

        // Title status
        const titleStatus =
          checks.title !== undefined ? (checks.title ? "✅" : "⚠️") : "—";

        // Check if we have downloadable data
        const hasOfac = fullResults?.checks?.ofac;
        const hasRepeat = fullResults?.checks?.repeatOffender?.screenshotData;
        const hasTitle = fullResults?.checks?.title?.screenshotData;

        return `
        <div class="history-item" data-index="${index}">
          <div class="history-item-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="history-customer" style="font-weight: 600; font-size: 14px;">${
              item.customer
            }</span>
            <span class="history-decision ${decisionClass}" style="padding: 2px 8px; border-radius: 4px; font-size: 11px;">${decisionIcon} ${
          item.decision
        }</span>
          </div>
          
          <div class="history-meta" style="font-size: 11px; color: #94a3b8; margin: 6px 0;">
            ${dateStr} at ${timeStr}
            ${item.vin ? ` • VIN: ...${item.vin.slice(-6)}` : " • No Trade-In"}
          </div>
          
          <div class="history-checks" style="display: flex; gap: 12px; margin: 8px 0; font-size: 11px;">
            <span title="OFAC Screening">🌐 ${ofacStatus}</span>
            <span title="Repeat Offender">🚫 ${repeatStatus}</span>
            <span title="Title & Lien">📄 ${titleStatus}</span>
          </div>
          
          <div class="history-actions" style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;">
            <button class="btn-sm history-view-btn" data-index="${index}" style="background: #1e3a5f; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px;">
              👁️ View & Restore
            </button>
            ${
              hasOfac
                ? `
              <button class="btn-sm history-print-ofac" data-index="${index}" style="background: #334155; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px;">
                🖨️ OFAC
              </button>
            `
                : ""
            }
            ${
              hasRepeat
                ? `
              <button class="btn-sm history-print-repeat" data-index="${index}" style="background: #334155; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px;">
                🖨️ Repeat
              </button>
            `
                : ""
            }
            ${
              hasTitle
                ? `
              <button class="btn-sm history-print-title" data-index="${index}" style="background: #334155; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px;">
                🖨️ Title
              </button>
            `
                : ""
            }
            ${
              hasOfac || hasRepeat || hasTitle
                ? `
              <button class="btn-sm history-print-all" data-index="${index}" style="background: #0f766e; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px;">
                📋 Print All
              </button>
            `
                : ""
            }
          </div>
        </div>
      `;
      })
      .join("");

    // Store history data for event delegation
    window._historyData = history;
  } catch (error) {
    console.error("Error populating history:", error);
    elements.historyList.innerHTML =
      '<p class="history-empty">Error loading history</p>';
  }
}

// Print OFAC from history
function printHistoryOfac(item) {
  if (!item.fullResults?.checks?.ofac) {
    alert("No OFAC data saved for this entry.");
    return;
  }
  // Temporarily set currentResults for the print function
  const originalResults = currentResults;
  currentResults = item.fullResults;
  printOfacReport();
  currentResults = originalResults;
}

// Print Repeat Offender from history
function printHistoryRepeat(item) {
  if (!item.fullResults?.checks?.repeatOffender?.screenshotData) {
    alert("No Repeat Offender screenshot saved for this entry.");
    return;
  }
  const originalResults = currentResults;
  currentResults = item.fullResults;
  printRepeatScreenshot();
  currentResults = originalResults;
}

// Print Title from history
function printHistoryTitle(item) {
  if (!item.fullResults?.checks?.title?.screenshotData) {
    alert("No Title/Lien screenshot saved for this entry.");
    return;
  }
  const originalResults = currentResults;
  currentResults = item.fullResults;
  printTitleScreenshot();
  currentResults = originalResults;
}

// Print All from history
function printHistoryAll(item) {
  if (!item.fullResults) {
    alert("No saved results for this entry.");
    return;
  }
  const originalResults = currentResults;
  currentResults = item.fullResults;
  printAllReports();
  currentResults = originalResults;
}

// Restore session from history
async function loadHistoryItem(item) {
  // Close modal
  hideModal("history");

  // Set global results for printing/export
  if (item.fullResults) {
    currentResults = item.fullResults;
  }

  // Repopulate form inputs
  if (item.fullResults && item.fullResults.customer) {
    const cust = item.fullResults.customer;
    if (elements.firstName) elements.firstName.value = cust.firstName || "";
    if (elements.middleName) elements.middleName.value = cust.middleName || "";
    if (elements.lastName) elements.lastName.value = cust.lastName || "";
    if (elements.suffix) elements.suffix.value = cust.suffix || "None";
    if (elements.dob) elements.dob.value = cust.dob || "";
    if (elements.dlnPid) elements.dlnPid.value = cust.dlnPid || "";
    if (elements.tradeVin) elements.tradeVin.value = cust.tradeVin || "";

    // Restore Co-Buyer info if present
    const hasCoBuyer = item.fullResults.customer.hasCoBuyer;
    if (elements.hasCoBuyer) {
      elements.hasCoBuyer.checked = hasCoBuyer;
      // Trigger change event to show/hide section
      elements.hasCoBuyer.dispatchEvent(new Event("change"));
    }

    if (hasCoBuyer && cust.coBuyer) {
      if (elements.cbFirstName)
        elements.cbFirstName.value = cust.coBuyer.firstName || "";
      if (elements.cbMiddleName)
        elements.cbMiddleName.value = cust.coBuyer.middleName || "";
      if (elements.cbLastName)
        elements.cbLastName.value = cust.coBuyer.lastName || "";
      if (elements.cbSuffix)
        elements.cbSuffix.value = cust.coBuyer.suffix || "";
      if (elements.cbDob) elements.cbDob.value = cust.coBuyer.dob || "";
      if (elements.cbDlnPid)
        elements.cbDlnPid.value = cust.coBuyer.dlnPid || "";
    }
  } else if (item.customer) {
    // Legacy support
    try {
      const names = item.customer.split(" ");
      if (names.length > 0) elements.firstName.value = names[0];
      if (names.length > 1) elements.lastName.value = names[names.length - 1];
      if (item.vin) elements.tradeVin.value = item.vin;
    } catch (e) {
      console.error("Error parsing legacy history item", e);
    }
  }

  // Show results if we have them
  if (item.fullResults) {
    displayResults(item.fullResults);

    // Switch view
    if (elements.progressSection)
      elements.progressSection.classList.add("hidden");
    if (elements.resultsSection)
      elements.resultsSection.classList.remove("hidden");

    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    // Legacy item
    alert(
      "History item loaded. Form populated. Please click 'Run All Checks' to refresh results."
    );
  }
}

// ============================================================================
// MODALS
// ============================================================================

function showModal(type) {
  if (type === "history") {
    populateHistoryModal();
    elements.historyModal.classList.remove("hidden");
  } else if (type === "screenshot") {
    elements.screenshotModal.classList.remove("hidden");
  }
}

function hideModal(type) {
  if (type === "history") {
    elements.historyModal.classList.add("hidden");
  } else if (type === "screenshot") {
    elements.screenshotModal.classList.add("hidden");
  }
}

function showScreenshot(type) {
  if (!currentResults?.checks) return;

  let screenshotData, title;

  if (
    type === "repeat" &&
    currentResults.checks.repeatOffender?.screenshotData
  ) {
    screenshotData = currentResults.checks.repeatOffender.screenshotData;
    title = "Repeat Offender Check";
  } else if (type === "title" && currentResults.checks.title?.screenshotData) {
    screenshotData = currentResults.checks.title.screenshotData;
    title = "Title & Lien Check";
  }

  if (screenshotData) {
    elements.screenshotTitle.textContent = title;
    // Add data URL prefix if not already present
    if (!screenshotData.startsWith("data:")) {
      screenshotData = "data:image/png;base64," + screenshotData;
    }
    elements.screenshotImage.src = screenshotData;
    showModal("screenshot");
  } else {
    alert("No screenshot available. The check may not have captured an image.");
  }
}

function printScreenshot() {
  const img = elements.screenshotImage;
  if (!img.src) return;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <html>
      <head><title>Compliance Screenshot</title></head>
      <body style="margin:0;padding:20px;">
        <img src="${img.src}" style="max-width:100%;"/>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
}

function downloadScreenshot() {
  const img = elements.screenshotImage;
  if (!img.src) return;

  const link = document.createElement("a");
  link.download = `compliance-screenshot-${Date.now()}.png`;
  link.href = img.src;
  link.click();
}

// Download OFAC report (opens print dialog for "Save as PDF")

// Download Repeat Offender screenshot (opens print dialog for "Save as PDF")

// Print Repeat Offender screenshot
function printRepeatScreenshot() {
  if (!currentResults?.checks?.repeatOffender?.screenshotData) {
    alert("No Repeat Offender screenshot available.");
    return;
  }

  let screenshotData = currentResults.checks.repeatOffender.screenshotData;
  if (!screenshotData.startsWith("data:")) {
    screenshotData = "data:image/png;base64," + screenshotData;
  }

  const customer = currentResults.customer;
  const timestamp = new Date().toLocaleString();

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Repeat Offender Check</title>
        <style>
          @page { size: landscape; margin: 0.25in; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 15px; background: white; }
          .header { border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
          .header h2 { color: #1e3a5f; font-size: 16px; }
          .header-info { font-size: 10px; text-align: right; }
          .header-info p { margin: 2px 0; }
          .screenshot-container { text-align: center; }
          .screenshot-container img { max-width: 100%; max-height: 65vh; border: 1px solid #ccc; }
          .footer { font-size: 8px; color: #666; text-align: center; margin-top: 8px; border-top: 1px solid #ccc; padding-top: 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>Michigan Repeat Offender Check</h2>
          <div class="header-info">
            <p><strong>Customer:</strong> ${customer?.firstName || ""} ${
    customer?.lastName || ""
  }</p>
            <p><strong>Date:</strong> ${timestamp}</p>
          </div>
        </div>
        <div class="screenshot-container">
          <img id="screenshot" src="${screenshotData}" />
        </div>
        <div class="footer">Source: Michigan Department of State MDOS Portal | Compliance Central</div>
      </body>
    </html>
  `);
  printWindow.document.close();

  // Wait for image to load, then print from parent window
  const img = printWindow.document.getElementById("screenshot");

  // Set up safe cleanup for print window (handles cancel/timeout)
  setupPrintWindowCleanup(printWindow);

  if (img.complete) {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  } else {
    img.onload = () => {
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 500);
    };
  }
}

// Download Title/Lien screenshot (opens print dialog for "Save as PDF")

// Print Title/Lien screenshot
function printTitleScreenshot() {
  if (!currentResults?.checks?.title?.screenshotData) {
    alert("No Title/Lien screenshot available.");
    return;
  }

  let screenshotData = currentResults.checks.title.screenshotData;
  if (!screenshotData.startsWith("data:")) {
    screenshotData = "data:image/png;base64," + screenshotData;
  }

  const vin = currentResults.customer?.tradeVin || "N/A";
  const timestamp = new Date().toLocaleString();

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Title & Lien Check</title>
        <style>
          @page { size: portrait; margin: 0.25in; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 15px; background: white; }
          .header { border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
          .header h2 { color: #1e3a5f; font-size: 16px; }
          .header-info { font-size: 10px; text-align: right; }
          .header-info p { margin: 2px 0; }
          .screenshot-container { text-align: center; }
          .screenshot-container img { max-width: 100%; max-height: 80vh; border: 1px solid #ccc; }
          .footer { font-size: 8px; color: #666; text-align: center; margin-top: 8px; border-top: 1px solid #ccc; padding-top: 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>Michigan Title & Lien Check</h2>
          <div class="header-info">
            <p><strong>VIN:</strong> ${vin}</p>
            <p><strong>Date:</strong> ${timestamp}</p>
          </div>
        </div>
        <div class="screenshot-container">
          <img id="screenshot" src="${screenshotData}" />
        </div>
        <div class="footer">Source: Michigan Department of State MDOS Portal | Compliance Central</div>
      </body>
    </html>
  `);
  printWindow.document.close();

  // Wait for image to load, then print from parent window
  const img = printWindow.document.getElementById("screenshot");

  // Set up safe cleanup for print window (handles cancel/timeout)
  setupPrintWindowCleanup(printWindow);

  if (img.complete) {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  } else {
    img.onload = () => {
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 500);
    };
  }
}

// Print OFAC report
async function printOfacReport() {
  if (!currentResults?.checks?.ofac) {
    alert("No OFAC results available.");
    return;
  }

  const customer = currentResults.customer;
  const ofac = currentResults.checks.ofac;
  const timestamp = new Date().toLocaleString();
  const screeningDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Get SDN database status
  let dbInfo = { lastUpdate: "Unknown", entryCount: 0 };

  if (ofac.lastUpdate) {
    // Use stored date from the check result
    try {
      dbInfo.lastUpdate = new Date(ofac.lastUpdate).toLocaleDateString();
      if (dbInfo.lastUpdate === "Invalid Date")
        dbInfo.lastUpdate = ofac.lastUpdate;
    } catch (e) {
      dbInfo.lastUpdate = ofac.lastUpdate;
    }
  } else {
    // Fallback: Fetch current status
    try {
      const status = await chrome.runtime.sendMessage({
        type: "getDataStatus",
      });
      if (status.success) {
        dbInfo.lastUpdate = status.lastUpdate
          ? new Date(status.lastUpdate).toLocaleDateString()
          : "Unknown";
        dbInfo.entryCount = status.entryCount || 0;
      }
    } catch (e) {
      console.log("Could not get SDN status:", e);
    }
  }

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>OFAC Screening Report</title>
      <style>
        @page { margin: 0.5in; }
        body { font-family: 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 30px; }
        .header { border: 3px double #1e3a5f; padding: 25px; margin-bottom: 25px; background: linear-gradient(to bottom, #ffffff, #f0f4f8); }
        .header-title { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 15px; margin-bottom: 15px; }
        .header h1 { color: #1e3a5f; margin: 0; font-size: 20px; letter-spacing: 2px; }
        .header h2 { color: #1e3a5f; margin: 8px 0 0 0; font-size: 16px; }
        .header-subtitle { color: #64748b; font-size: 13px; margin: 8px 0 0 0; font-style: italic; }
        .header-info { display: flex; justify-content: space-between; font-size: 12px; color: #374151; }
        .result { padding: 30px; margin: 25px 0; border-radius: 8px; text-align: center; }
        .result.pass { background: linear-gradient(to bottom, #d1fae5, #a7f3d0); border: 3px solid #10b981; }
        .result.fail { background: linear-gradient(to bottom, #fee2e2, #fecaca); border: 3px solid #ef4444; }
        .result h2 { margin: 0; font-size: 36px; }
        .result.pass h2 { color: #065f46; }
        .result.fail h2 { color: #991b1b; }
        .result p { margin: 15px 0 0 0; font-size: 16px; }
        .result.pass p { color: #047857; }
        .result.fail p { color: #b91c1c; }
        .subject { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0; }
        .subject h3 { margin: 0 0 15px 0; color: #1e3a5f; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; }
        .subject table { width: 100%; font-size: 13px; border-collapse: collapse; }
        .subject td { padding: 5px 0; }
        .subject td:first-child { width: 30%; }
        .certification { background: #fefce8; padding: 15px; border-radius: 6px; margin: 25px 0; border: 1px solid #fde047; }
        .certification p { margin: 0; font-size: 12px; color: #713f12; }
        .footer { color: #64748b; font-size: 10px; text-align: center; margin-top: 30px; border-top: 2px solid #e2e8f0; padding-top: 15px; }
        .footer p { margin: 5px 0; }
        .matches { margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.7); border-radius: 6px; text-align: left; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-title">
          <h1>U.S. DEPARTMENT OF THE TREASURY</h1>
          <h2>Office of Foreign Assets Control (OFAC)</h2>
          <p class="header-subtitle">Specially Designated Nationals and Blocked Persons List (SDN) Screening Report</p>
        </div>
        <div class="header-info">
          <div>
            <p><strong>Report Generated:</strong> ${timestamp}</p>
            <p><strong>Screening Date:</strong> ${screeningDate}</p>
          </div>
          <div style="text-align: right;">
            <p><strong>Database Updated:</strong> ${dbInfo.lastUpdate}</p>
            <p><strong>Entries Searched:</strong> ${
              ofac.entriesSearched?.toLocaleString() ||
              dbInfo.entryCount.toLocaleString()
            }</p>
          </div>
        </div>
      </div>
      
      <div class="subject">
        <h3>SUBJECT SCREENED</h3>
        <table>
          <tr>
            <td><strong>Full Name:</strong></td>
            <td>${buildSanitizedName(customer)}</td>
          </tr>
          <tr>
            <td><strong>Date of Birth:</strong></td>
            <td>${sanitizeHTML(customer.dob) || "Not Provided"}</td>
          </tr>
          <tr>
            <td><strong>Driver License / PID:</strong></td>
            <td>${sanitizeHTML(customer.dlnPid) || "Not Provided"}</td>
          </tr>
          ${
            customer.tradeVin
              ? `
          <tr>
            <td><strong>Trade-In VIN:</strong></td>
            <td>${sanitizeHTML(customer.tradeVin)}</td>
          </tr>
          `
              : ""
          }
        </table>
      </div>
      
      <div class="result ${ofac.passed ? "pass" : "fail"}">
        <h2>${ofac.passed ? "✓ NO MATCH FOUND" : "⚠ POTENTIAL MATCH"}</h2>
        <p>${
          ofac.passed
            ? "Subject is NOT listed on the OFAC SDN List"
            : "REVIEW REQUIRED - Potential match found on SDN List"
        }</p>
        ${
          !ofac.passed && ofac.matches?.length > 0
            ? `
        <div class="matches">
          <strong>Potential Matches (${ofac.matches.length}):</strong>
          <ul>
            ${ofac.matches
              .slice(0, 5)
              .map(
                (m) =>
                  `<li>${sanitizeHTML(m.name)} (Score: ${sanitizeHTML(
                    m.score
                  )}%, Type: ${sanitizeHTML(m.type)})</li>`
              )
              .join("")}
          </ul>
        </div>
        `
            : ""
        }
      </div>
      
      <div class="certification">
        <p><strong>Compliance Certification:</strong> This screening was performed in accordance with OFAC regulations requiring financial institutions and businesses to screen customers against the SDN List. This report serves as documentation of compliance efforts.</p>
      </div>
      
      <div class="footer">
        <p><strong>Data Source:</strong> OFAC Specially Designated Nationals List via OpenSanctions</p>
        <p>Database is automatically updated every 24 hours to ensure compliance accuracy.</p>
        <p><em>This report is generated for compliance documentation purposes. Results are advisory and should be verified for high-risk transactions.</em></p>
        <p><strong>Compliance Central - Michigan Dealer Compliance Hub</strong></p>
      </div>
    </body>
    </html>
  `);
  printWindow.document.close();

  // Set up safe cleanup for print window (handles cancel/timeout)
  setupPrintWindowCleanup(printWindow);

  // Print with slight delay to ensure rendering
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 500);
}
// Print Co-Buyer OFAC Report
async function printCoBuyerOfacReport() {
  if (!currentResults?.checks?.coBuyerOfac) {
    alert("No Co-Buyer OFAC results available.");
    return;
  }

  const coBuyer = currentResults.customer.coBuyer;
  const ofac = currentResults.checks.coBuyerOfac;
  const timestamp = new Date().toLocaleString();
  const screeningDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Get SDN database status
  let dbInfo = { lastUpdate: "Unknown", entryCount: 0 };
  try {
    const status = await chrome.runtime.sendMessage({ type: "getDataStatus" });
    if (status.success) {
      dbInfo.lastUpdate = status.lastUpdate
        ? new Date(status.lastUpdate).toLocaleDateString()
        : "Unknown";
      dbInfo.entryCount = status.entryCount || 0;
    }
  } catch (e) {
    console.log("Could not get SDN status:", e);
  }

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Co-Buyer OFAC Screening Report</title>
      <style>
        @page { margin: 0.5in; }
        body { font-family: 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 30px; }
        .header { border: 3px double #1e3a5f; padding: 25px; margin-bottom: 25px; background: linear-gradient(to bottom, #ffffff, #f0f4f8); }
        .header-title { text-align: center; border-bottom: 2px solid #1e3a5f; padding-bottom: 15px; margin-bottom: 15px; }
        .header h1 { color: #1e3a5f; margin: 0; font-size: 20px; letter-spacing: 2px; }
        .header h2 { color: #1e3a5f; margin: 8px 0 0 0; font-size: 16px; }
        .header-subtitle { color: #64748b; font-size: 13px; margin: 8px 0 0 0; font-style: italic; }
        .header-info { display: flex; justify-content: space-between; font-size: 12px; color: #374151; }
        .result { padding: 30px; margin: 25px 0; border-radius: 8px; text-align: center; }
        .result.pass { background: linear-gradient(to bottom, #d1fae5, #a7f3d0); border: 3px solid #10b981; }
        .result.fail { background: linear-gradient(to bottom, #fee2e2, #fecaca); border: 3px solid #ef4444; }
        .result h2 { margin: 0; font-size: 36px; }
        .result.pass h2 { color: #065f46; }
        .result.fail h2 { color: #991b1b; }
        .result p { margin: 15px 0 0 0; font-size: 16px; }
        .result.pass p { color: #047857; }
        .result.fail p { color: #b91c1c; }
        .subject { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0; }
        .subject h3 { margin: 0 0 15px 0; color: #1e3a5f; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 8px; }
        .subject table { width: 100%; font-size: 13px; border-collapse: collapse; }
        .subject td { padding: 5px 0; }
        .subject td:first-child { width: 30%; }
        .certification { background: #fefce8; padding: 15px; border-radius: 6px; margin: 25px 0; border: 1px solid #fde047; }
        .certification p { margin: 0; font-size: 12px; color: #713f12; }
        .footer { color: #64748b; font-size: 10px; text-align: center; margin-top: 30px; border-top: 2px solid #e2e8f0; padding-top: 15px; }
        .footer p { margin: 5px 0; }
        .matches { margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.7); border-radius: 6px; text-align: left; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-title">
          <h1>U.S. DEPARTMENT OF THE TREASURY</h1>
          <h2>Office of Foreign Assets Control (OFAC)</h2>
          <p class="header-subtitle">Specially Designated Nationals and Blocked Persons List (SDN) Screening Report</p>
        </div>
        <div class="header-info">
          <div>
            <p><strong>Report Generated:</strong> ${timestamp}</p>
            <p><strong>Screening Date:</strong> ${screeningDate}</p>
          </div>
          <div style="text-align: right;">
            <p><strong>Database Updated:</strong> ${dbInfo.lastUpdate}</p>
            <p><strong>Entries Searched:</strong> ${
              ofac.entriesSearched?.toLocaleString() ||
              dbInfo.entryCount.toLocaleString()
            }</p>
          </div>
        </div>
      </div>

      <div class="subject">
        <h3>CO-BUYER SUBJECT SCREENED</h3>
        <table>
          <tr><td><strong>First Name:</strong></td><td>${
            coBuyer?.firstName || ""
          }</td></tr>
          <tr><td><strong>Middle Name:</strong></td><td>${
            coBuyer?.middleName || ""
          }</td></tr>
          <tr><td><strong>Last Name:</strong></td><td>${
            coBuyer?.lastName || ""
          }</td></tr>
          <tr><td><strong>Suffix:</strong></td><td>${
            coBuyer?.suffix || ""
          }</td></tr>
          <tr><td><strong>Date of Birth:</strong></td><td>${
            coBuyer?.dob || "Not Provided"
          }</td></tr>
          <tr><td><strong>DLN/PID:</strong></td><td>${
            coBuyer?.dlnPid || "Not Provided"
          }</td></tr>
        </table>
      </div>

      <div class="result ${ofac.passed ? "pass" : "fail"}">
        <h2>${ofac.passed ? "✓ NO MATCH FOUND" : "⚠ POTENTIAL MATCH"}</h2>
        <p>${
          ofac.passed
            ? "Subject is NOT listed on the OFAC SDN List"
            : "REVIEW REQUIRED - Potential match found with similarity score > 85%"
        }</p>
      </div>

      ${
        !ofac.passed && ofac.matches?.length > 0
          ? `
          <div class="matches">
            <h3>Potential Matches:</h3>
            ${ofac.matches
              .map(
                (m) => `
              <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
                <strong>${m.name}</strong> (Score: ${(
                  m.similarity * 100
                ).toFixed(1)}%)<br>
                Type: ${m.type} | ID: ${m.id} | Program: ${m.program}<br>
                ${m.remarks ? `Remarks: ${m.remarks}` : ""}
              </div>
            `
              )
              .join("")}
          </div>
        `
          : ""
      }

      <div class="certification">
        <p><strong>Compliance Certification:</strong> This screening was performed using the current OFAC SDN List. The system utilizes fuzzy matching logic to identify potential matches. This report documents due diligence in compliance with U.S. sanctions regulations.</p>
      </div>

      <div class="footer">
        <p>Generated by Compliance Central Chrome Extension</p>
        <p>This document is for internal compliance records only.</p>
      </div>
    </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}

// Print Co-Buyer Repeat Offender Screenshot
async function printCoBuyerRepeatScreenshot() {
  const result = currentResults?.checks?.coBuyerRepeatOffender;
  if (!result || !result.screenshotData) {
    alert("No Co-Buyer Repeat Offender screenshot available.");
    return;
  }

  let screenshotData = result.screenshotData;
  if (!screenshotData.startsWith("data:")) {
    screenshotData = "data:image/png;base64," + screenshotData;
  }

  const customer = currentResults.customer;
  const coBuyer = customer.coBuyer;
  const timestamp = new Date().toLocaleString();

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Repeat Offender Check (Co-Buyer)</title>
        <style>
          @page { size: landscape; margin: 0.25in; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 15px; background: white; }
          .header { border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
          .header h2 { color: #1e3a5f; font-size: 16px; }
          .header-info { font-size: 10px; text-align: right; }
          .header-info p { margin: 2px 0; }
          .screenshot-container { text-align: center; }
          .screenshot-container img { max-width: 100%; max-height: 65vh; border: 1px solid #ccc; }
          .footer { font-size: 8px; color: #666; text-align: center; margin-top: 8px; border-top: 1px solid #ccc; padding-top: 5px; }
          .print-btn {
            position: fixed; top: 10px; right: 10px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; z-index: 1000;
          }
          @media print {
            .print-btn { display: none; }
          }
        </style>
      </head>
      <body>
        <button id="printBtn" class="print-btn">🖨️ PRINT NOW</button>
        <div class="header">
          <h2>Michigan Repeat Offender Check (Co-Buyer)</h2>
          <div class="header-info">
            <p><strong>Co-Buyer:</strong> ${coBuyer?.firstName || ""} ${
    coBuyer?.lastName || ""
  } ${coBuyer?.suffix || ""}</p>
            <p><strong>Date:</strong> ${timestamp}</p>
          </div>
        </div>
        <div class="screenshot-container">
          <img id="screenshot" src="${screenshotData}" />
        </div>
        <div class="footer">Source: Michigan Department of State MDOS Portal | Compliance Central</div>
      </body>
    </html>
  `);
  printWindow.document.close();

  // Set up safe cleanup for print window (handles cancel/timeout)
  setupPrintWindowCleanup(printWindow);

  // SAFELY attach events from parent context (No CSP violation)
  const btn = printWindow.document.getElementById("printBtn");
  if (btn) {
    btn.onclick = () => {
      printWindow.focus();
      printWindow.print();
    };
  }

  // Auto-print logic
  // Wait for image just in case (though we want it robust, waiting for 'load' is standard)
  const img = printWindow.document.getElementById("screenshot");

  const triggerPrint = () => {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  };

  if (img.complete) {
    triggerPrint();
  } else {
    img.onload = triggerPrint;
    img.onerror = triggerPrint; // Print anyway if image fails
  }
}
// Print All Reports - Single combined document with page breaks
async function printAllReports() {
  if (!currentResults) {
    alert("No results to print.");
    return;
  }

  const customer = currentResults.customer;
  const timestamp = new Date().toLocaleString();
  const ofac = currentResults.checks?.ofac;
  const repeatOffender = currentResults.checks?.repeatOffender;
  const title = currentResults.checks?.title;

  // Co-Buyer data
  const coBuyer = currentResults.customer.coBuyer;
  const cbOfac = currentResults.checks?.coBuyerOfac;
  const cbRepeatOffender = currentResults.checks?.coBuyerRepeatOffender;

  // Build combined HTML sections
  let sections = [];

  // OFAC Section (always present)
  if (ofac) {
    const screeningDate = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    sections.push(`
      <div class="page ofac-page">
        <div class="ofac-header">
          <h1>U.S. DEPARTMENT OF THE TREASURY</h1>
          <h2>Office of Foreign Assets Control (OFAC)</h2>
          <p class="subtitle">Specially Designated Nationals and Blocked Persons List (SDN) Screening Report</p>
        </div>
        <div class="ofac-meta">
          <div><strong>Report Generated:</strong> ${timestamp}<br><strong>Screening Date:</strong> ${screeningDate}</div>
          <div style="text-align: right;"><strong>Database Updated:</strong> ${
            ofac.lastUpdate || "N/A"
          }<br><strong>Entries Searched:</strong> ${
      ofac.entriesSearched?.toLocaleString() || "N/A"
    }</div>
        </div>
        <div class="subject-box">
          <h3>SUBJECT SCREENED</h3>
          <p><strong>Name:</strong> ${
            customer ? buildSanitizedName(customer) : "N/A"
          }</p>
          <p><strong>DOB:</strong> ${
            sanitizeHTML(customer?.dob) || "Not Provided"
          }</p>
          <p><strong>DLN/PID:</strong> ${
            sanitizeHTML(customer?.dlnPid) || "Not Provided"
          }</p>
          ${
            customer?.tradeVin
              ? `<p><strong>Trade VIN:</strong> ${sanitizeHTML(
                  customer.tradeVin
                )}</p>`
              : ""
          }
        </div>
        <div class="result-box ${ofac.passed ? "passed" : "failed"}">
          <h2>${ofac.passed ? "✓ NO MATCH FOUND" : "⚠ POTENTIAL MATCH"}</h2>
          <p>${
            ofac.passed
              ? "Subject is NOT listed on the OFAC SDN List"
              : "REVIEW REQUIRED - Potential match found"
          }</p>
        </div>
        <div class="footer">Compliance Central - OFAC Screening Report</div>
      </div>
    `);
  }

  // Co-Buyer OFAC Section (if exists)
  if (cbOfac) {
    const screeningDate = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    sections.push(`
      <div class="page ofac-page">
        <div class="ofac-header">
          <h1>U.S. DEPARTMENT OF THE TREASURY</h1>
          <h2>Office of Foreign Assets Control (OFAC)</h2>
          <p class="subtitle">Specially Designated Nationals and Blocked Persons List (SDN) Screening Report</p>
        </div>
        <div class="ofac-meta">
          <div><strong>Report Generated:</strong> ${timestamp}<br><strong>Screening Date:</strong> ${screeningDate}</div>
          <div style="text-align: right;"><strong>Database Updated:</strong> ${
            ofac?.lastUpdate || "N/A"
          }<br><strong>Entries Searched:</strong> ${
      ofac?.entriesSearched?.toLocaleString() || "N/A"
    }</div>
        </div>
        <div class="subject-box">
          <h3>CO-BUYER SUBJECT SCREENED</h3>
          <p><strong>Name:</strong> ${coBuyer?.firstName || ""} ${
      coBuyer?.middleName || ""
    } ${coBuyer?.lastName || ""}${
      coBuyer?.suffix ? " " + coBuyer.suffix : ""
    }</p>
          <p><strong>DOB:</strong> ${coBuyer?.dob || "Not Provided"}</p>
          <p><strong>DLN/PID:</strong> ${coBuyer?.dlnPid || "Not Provided"}</p>
        </div>
        <div class="result-box ${cbOfac.passed ? "passed" : "failed"}">
          <h2>${cbOfac.passed ? "✓ NO MATCH FOUND" : "⚠ POTENTIAL MATCH"}</h2>
          <p>${
            cbOfac.passed
              ? "Subject is NOT listed on the OFAC SDN List"
              : "REVIEW REQUIRED - Potential match found"
          }</p>
        </div>
        <div class="footer">Compliance Central - Co-Buyer OFAC Screening Report</div>
      </div>
    `);
  }

  // Repeat Offender Section
  if (repeatOffender?.screenshotData) {
    let screenshotData = repeatOffender.screenshotData;
    if (!screenshotData.startsWith("data:")) {
      screenshotData = "data:image/png;base64," + screenshotData;
    }
    sections.push(`
      <div class="page repeat-page">
        <div class="header">
          <h2>Michigan Repeat Offender Check</h2>
          <div class="header-info">
            <p><strong>Customer:</strong> ${customer?.firstName || ""} ${
      customer?.lastName || ""
    }</p>
            <p><strong>Date:</strong> ${timestamp}</p>
          </div>
        </div>
        <div class="screenshot-container">
          <img src="${screenshotData}" />
        </div>
        <div class="footer">Source: Michigan Department of State MDOS Portal | Compliance Central</div>
      </div>
    `);
  }

  // Co-Buyer Repeat Offender Section
  if (cbRepeatOffender?.screenshotData) {
    let cbScreenshotData = cbRepeatOffender.screenshotData;
    if (!cbScreenshotData.startsWith("data:")) {
      cbScreenshotData = "data:image/png;base64," + cbScreenshotData;
    }
    sections.push(`
      <div class="page repeat-page">
        <div class="header">
          <h2>Michigan Repeat Offender Check (Co-Buyer)</h2>
          <div class="header-info">
            <p><strong>Co-Buyer:</strong> ${coBuyer?.firstName || ""} ${
      coBuyer?.lastName || ""
    }</p>
            <p><strong>Date:</strong> ${timestamp}</p>
          </div>
        </div>
        <div class="screenshot-container">
          <img src="${cbScreenshotData}" />
        </div>
        <div class="footer">Source: Michigan Department of State MDOS Portal | Compliance Central</div>
      </div>
    `);
  }

  // Title/Lien Section
  if (title?.screenshotData) {
    let screenshotData = title.screenshotData;
    if (!screenshotData.startsWith("data:")) {
      screenshotData = "data:image/png;base64," + screenshotData;
    }
    sections.push(`
      <div class="page title-page">
        <div class="header">
          <h2>Michigan Title & Lien Check</h2>
          <div class="header-info">
            <p><strong>VIN:</strong> ${customer?.tradeVin || "N/A"}</p>
            <p><strong>Date:</strong> ${timestamp}</p>
          </div>
        </div>
        <div class="screenshot-container">
          <img src="${screenshotData}" />
        </div>
        <div class="footer">Source: Michigan Department of State MDOS Portal | Compliance Central</div>
      </div>
    `);
  }

  // Create combined print window
  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Compliance Central - All Reports</title>
        <style>
          @page { size: portrait; margin: 0.5in; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; color: #333; background: white; }
          .page { page-break-after: always; min-height: 90vh; position: relative; }
          .page:last-child { page-break-after: auto; }
          
          .header { border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
          .header h2 { color: #1e3a5f; font-size: 18px; margin: 0; }
          
          .ofac-header { text-align: center; border-bottom: 3px double #1e3a5f; padding-bottom: 15px; margin-bottom: 20px; }
          .ofac-header h1 { font-size: 16px; margin: 0 0 5px 0; color: #000; text-transform: uppercase; }
          .ofac-header h2 { font-size: 20px; margin: 0 0 5px 0; color: #1e3a5f; }
          .ofac-header .subtitle { font-size: 12px; color: #666; font-style: italic; }
          
          .ofac-meta { display: flex; justify-content: space-between; font-size: 10px; color: #555; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
          
          .subject-box { background: #f8f9fa; border: 1px solid #ddd; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
          .subject-box h3 { font-size: 12px; margin: 0 0 10px 0; color: #666; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
          .subject-box p { margin: 5px 0; font-size: 14px; }
          
          .result-box { text-align: center; padding: 20px; border: 2px solid; border-radius: 8px; margin: 30px 0; }
          .result-box.passed { border-color: #28a745; background: #f0fff4; color: #28a745; }
          .result-box.failed { border-color: #dc3545; background: #fff5f5; color: #dc3545; }
          .result-box h2 { font-size: 24px; margin: 0 0 10px 0; }
          
          .screenshot-container { text-align: center; margin-top: 20px; }
          .screenshot-container img { max-width: 100%; max-height: 60vh; border: 1px solid #ccc; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          
          .footer { position: absolute; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9px; color: #999; border-top: 1px solid #eee; padding-top: 10px; }
          
          .print-btn {
            position: fixed; top: 10px; right: 10px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; z-index: 1000;
          }
          @media print {
            .print-btn { display: none; }
          }
        </style>
      </head>
      <body>
        ${sections.join("")}
      </body>
    </html>
  `);
  printWindow.document.close();

  // Wait for all images to load, then print
  const images = printWindow.document.querySelectorAll("img");
  let loadedCount = 0;
  const totalImages = images.length;

  const tryPrint = () => {
    // Set up safe cleanup for print window (handles cancel/timeout)
    setupPrintWindowCleanup(printWindow);
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  };

  if (totalImages === 0) {
    tryPrint();
  } else {
    images.forEach((img) => {
      if (img.complete) {
        loadedCount++;
        if (loadedCount === totalImages) tryPrint();
      } else {
        img.onload = () => {
          loadedCount++;
          if (loadedCount === totalImages) tryPrint();
        };
      }
    });
  }
}

// Download All Reports

// ============================================================================
// LOADING OVERLAY
// ============================================================================

function showLoading(text = "Processing...") {
  elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
  elements.loadingOverlay.classList.add("hidden");
}

// ============================================================================
// EXPORT FUNCTIONALITY
// ============================================================================

async function handleExport() {
  if (!currentResults) {
    alert("No results to export. Please run compliance checks first.");
    return;
  }

  showLoading("Generating Deal Jacket PDF...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "EXPORT_PDF",
      data: currentResults,
    });

    if (response.success) {
      // Open PDF in new tab or download
      const blob = new Blob([response.pdfData], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } else {
      // Fallback to simple HTML export
      generateSimpleExport(currentResults);
    }
  } catch (error) {
    console.error("PDF export error:", error);
    // Fallback to simple HTML export
    generateSimpleExport(currentResults);
  } finally {
    hideLoading();
  }
}

function generateSimpleExport(results) {
  const customer = results.customer;
  const decision = results.finalDecision;
  const timestamp = new Date(results.timestamp).toLocaleString();

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Compliance Check - ${sanitizeHTML(
        customer.firstName
      )} ${sanitizeHTML(customer.lastName)}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #00274C; border-bottom: 2px solid #00274C; padding-bottom: 10px; }
        .header { margin-bottom: 20px; }
        .decision { padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .decision.approved { background: #d1fae5; color: #065f46; }
        .decision.denied { background: #fee2e2; color: #991b1b; }
        .decision.review { background: #fef3c7; color: #92400e; }
        .section { margin: 20px 0; padding: 15px; background: #f9fafb; border-radius: 8px; }
        .section h3 { margin-top: 0; color: #00274C; }
        .check-result { margin: 10px 0; padding: 10px; background: white; border-radius: 4px; }
        .pass { border-left: 4px solid #10b981; }
        .fail { border-left: 4px solid #ef4444; }
        .warning { border-left: 4px solid #f59e0b; }
        .footer { margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: bold; }
        .badge-pass { background: #d1fae5; color: #065f46; }
        .badge-fail { background: #fee2e2; color: #991b1b; }
        .badge-warn { background: #fef3c7; color: #92400e; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Compliance Central - Deal Jacket</h1>
        <p><strong>Generated:</strong> ${timestamp}</p>
      </div>
      
      <div class="section">
        <h3>Customer Information</h3>
        <p><strong>Name:</strong> ${buildSanitizedName(customer)}</p>
        <p><strong>DOB:</strong> ${sanitizeHTML(customer.dob)}</p>
        <p><strong>DLN/PID:</strong> ${
          sanitizeHTML(customer.dlnPid) || "N/A"
        }</p>
        ${
          customer.tradeVin
            ? `<p><strong>Trade VIN:</strong> ${sanitizeHTML(
                customer.tradeVin
              )}</p>`
            : ""
        }
      </div>
      
      <div class="decision ${decision.level.toLowerCase()}">
        <h2><span class="badge ${
          decision.level === "APPROVED"
            ? "badge-pass"
            : decision.level === "DENIED"
            ? "badge-fail"
            : "badge-warn"
        }">${decision.level}</span></h2>
        <p>${decision.reason}</p>
      </div>
      
      <div class="section">
        <h3>Compliance Check Results</h3>
        
        <!-- OFAC Section - Official Style -->
        <div class="ofac-report" style="border: 2px solid #1e3a5f; border-radius: 8px; padding: 15px; margin: 15px 0; background: linear-gradient(to bottom, #f8fafc, #e2e8f0);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 10px;">
            <div>
              <h4 style="color: #1e3a5f; margin: 0; font-size: 14px;">U.S. DEPARTMENT OF THE TREASURY</h4>
              <h5 style="color: #1e3a5f; margin: 5px 0 0 0; font-size: 12px;">Office of Foreign Assets Control (OFAC)</h5>
              <p style="font-size: 11px; color: #64748b; margin: 5px 0 0 0;">Specially Designated Nationals (SDN) List Screening</p>
            </div>
            <div style="text-align: right; font-size: 11px; color: #64748b;">
              <p style="margin: 0;">Screening Date: ${timestamp}</p>
              <p style="margin: 2px 0 0 0;">Data Source: OpenSanctions SDN Database</p>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 10px; background: ${
            results.checks.ofac?.passed ? "#d1fae5" : "#fee2e2"
          }; border-radius: 4px;">
            <div>
              <p style="margin: 0; font-weight: bold; color: #374151;">Subject Screened:</p>
              <p style="margin: 5px 0 0 0; color: #374151;">${buildSanitizedName(
                customer
              )}</p>
              <p style="margin: 2px 0 0 0; font-size: 11px; color: #64748b;">DOB: ${sanitizeHTML(
                customer.dob
              )}</p>
            </div>
            <div style="text-align: center;">
              <p style="margin: 0; font-size: 24px; font-weight: bold; color: ${
                results.checks.ofac?.passed ? "#065f46" : "#991b1b"
              };">${
    results.checks.ofac?.passed ? "NO MATCH" : "POTENTIAL MATCH"
  }</p>
              <p style="margin: 5px 0 0 0; font-size: 11px; color: #64748b;">${
                results.checks.ofac?.passed
                  ? "Individual is NOT listed on the SDN List"
                  : "Review Required - Potential SDN Match Found"
              }</p>
            </div>
          </div>
          <p style="font-size: 10px; color: #64748b; margin: 10px 0 0 0; text-align: center;">This screening was performed against the OFAC SDN list maintained by the U.S. Department of the Treasury. Results are advisory.</p>
        </div>
        
        <div class="check-result ${
          results.checks.repeatOffender?.passed ? "pass" : "fail"
        }">
          <strong>Repeat Offender:</strong> ${
            results.checks.repeatOffender?.passed
              ? "PASSED - No Record Found"
              : "FAILED - Record Found"
          }
        </div>
        
        ${
          results.checks.title
            ? `
        <div class="check-result ${
          results.checks.title.passed ? "pass" : "warning"
        }">
          <strong>Title & Lien:</strong><br>
          Title Brand: ${results.checks.title.titleBrand}<br>
          Lien Status: ${
            results.checks.title.hasLien
              ? "Active - " + (results.checks.title.lienHolder || "Unknown")
              : "Clear"
          }<br>
          Title Type: ${results.checks.title.titleType}
        </div>
        `
            : "<p><em>No trade-in vehicle</em></p>"
        }
      </div>
      
      <div class="footer">
        <p>This document was generated by Compliance Central - Michigan Dealer Compliance Hub</p>
        <p>Report ID: ${Date.now()}</p>
      </div>
    </body>
    </html>
  `;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, "_blank");

  // Trigger print dialog
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

async function downloadFullReport() {
  if (!currentResults) return;

  let content = "COMPLIANCE CHECK REPORT\n";
  content += "=======================\n";
  content += `Date: ${new Date().toLocaleString()}\n\n`;

  // Customer Info
  content += "CUSTOMER INFORMATION\n";
  content += "--------------------\n";
  content += `Name: ${elements.firstName.value} ${elements.middleName.value} ${elements.lastName.value} ${elements.suffix.value}\n`;
  content += `DOB: ${elements.dob.value}\n\n`;

  // OFAC
  if (currentResults.checks.ofac) {
    content += "OFAC SCREENING\n";
    content += "--------------\n";
    content += `Status: ${
      currentResults.checks.ofac.passed ? "Pass" : "FAIL"
    }\n`;
    content += `Details: ${
      currentResults.checks.ofac.passed
        ? "No matches found"
        : "Potential matches found"
    }\n\n`;
  }

  // Repeat Offender
  if (currentResults.checks.repeatOffender) {
    content += "REPEAT OFFENDER CHECK\n";
    content += "---------------------\n";
    content += `Status: ${
      currentResults.checks.repeatOffender.passed ? "Pass" : "FAIL"
    }\n`;
    content += `Details: ${currentResults.checks.repeatOffender.status}\n\n`;
  }

  // Title
  if (currentResults.checks.title) {
    content += "TITLE & LIEN CHECK\n";
    content += "------------------\n";
    content += `VIN: ${currentResults.checks.title.vin}\n`;
    content += `Status: ${
      currentResults.checks.title.passed ? "Pass" : "FAIL"
    }\n`;
    const title = currentResults.checks.title;
    content += `Title Type: ${title.titleType} (${title.titleIssued})\n`;
    content += `Lien Status: ${title.lienStatus}\n`;
    if (title.brands && title.brands.length > 0) {
      content += `Brands: ${title.brands.join(", ")}\n`;
    }
    content += "\n";
  }

  const printWindow = window.open("", "_blank");

  // Re-generate HTML (quick copy from above for stability in this tool call)
  const reportHtml = `
    <html>
      <head>
        <title>Compliance Report</title>
        <style>
          body { font-family: sans-serif; padding: 40px; }
          h1 { border-bottom: 2px solid #ccc; padding-bottom: 10px; }
          .section { margin-bottom: 30px; border: 1px solid #ddd; padding: 20px; border-radius: 8px; page-break-inside: avoid; }
          .pass { color: green; font-weight: bold; }
          .fail { color: red; font-weight: bold; }
          img { max-width: 100%; border: 1px solid #ccc; margin-top: 10px; }
          @media print {
            body { padding: 0; }
            .section { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>Compliance Report</h1>
        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
        <div class="section">
          <h2>Customer</h2>
          <p><strong>Name:</strong> ${elements.firstName.value} ${
    elements.middleName.value
  } ${elements.lastName.value}</p>
          <p><strong>DOB:</strong> ${elements.dob.value}</p>
          <p><strong>VIN:</strong> ${elements.tradeVin.value}</p>
        </div>

        ${
          currentResults.checks.ofac
            ? `
        <div class="section">
          <h2>OFAC Screening</h2>
          <p>Status: <span class="${
            currentResults.checks.ofac.passed ? "pass" : "fail"
          }">${
                currentResults.checks.ofac.passed ? "PASSED" : "FAILED"
              }</span></p>
        </div>`
            : ""
        }

        ${
          currentResults.checks.repeatOffender
            ? `
        <div class="section">
          <h2>Repeat Offender Check</h2>
          <p>Status: <span class="${
            currentResults.checks.repeatOffender.passed ? "pass" : "fail"
          }">${
                currentResults.checks.repeatOffender.passed
                  ? "PASSED"
                  : "FAILED"
              }</span></p>
          <p>Result: ${currentResults.checks.repeatOffender.status}</p>
          ${
            currentResults.checks.repeatOffender.screenshotData
              ? `<h3>Screenshot</h3><img src="${
                  currentResults.checks.repeatOffender.screenshotData.startsWith(
                    "data:"
                  )
                    ? ""
                    : "data:image/png;base64,"
                }${currentResults.checks.repeatOffender.screenshotData}" />`
              : ""
          }
        </div>`
            : ""
        }

        ${
          currentResults.checks.title
            ? `
        <div class="section">
          <h2>Title & Lien Check</h2>
          <p>Status: <span class="${
            currentResults.checks.title.passed ? "pass" : "fail"
          }">${
                currentResults.checks.title.passed ? "PASSED" : "FAILED"
              }</span></p>
          <p>VIN: ${currentResults.checks.title.vin}</p>
          <p>Title: ${currentResults.checks.title.titleType} (${
                currentResults.checks.title.titleIssued
              })</p>
          <p>Lien: ${currentResults.checks.title.lienStatus}</p>
          ${
            currentResults.checks.title.screenshotData
              ? `<h3>Screenshot</h3><img src="${
                  currentResults.checks.title.screenshotData.startsWith("data:")
                    ? ""
                    : "data:image/png;base64,"
                }${currentResults.checks.title.screenshotData}" />`
              : ""
          }
        </div>`
            : ""
        }
      </body>
    </html>
  `;

  printWindow.document.write(reportHtml);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}
