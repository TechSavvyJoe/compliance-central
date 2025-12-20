/**
 * Compliance Central - Background Service Worker
 * Handles tab management and script injection for form automation
 *
 * MATCHES patterns from:
 * - TechSavvyJoe/Michigan-Repeat-Offender-Search/background.js
 * - TechSavvyJoe/OFAC-Search/background.js
 */

import { downloadAndParseSDN, needsUpdate } from "./ofac/ofac-data.js";
import { searchSDNEntries } from "./ofac/fuzzy-search.js";
import {
  initDB,
  storeSDNEntries,
  clearSDNEntries,
  saveSetting,
  getSetting,
  getSDNCount,
  getAllSDNEntries,
} from "./ofac/storage.js";
import {
  BACKEND_CONFIG,
  backendRepeatOffenderCheck,
  backendTitleCheck,
} from "./lib/backend-api.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const MDOS_BASE_URL = "https://dsvsesvc.sos.state.mi.us/TAP/_/";
const UPDATE_ALARM_NAME = "ofac-sdn-update";
const UPDATE_INTERVAL_HOURS = 24;

// ============================================================================
// STATE UPDATE LOCK (Prevents race conditions in concurrent storage updates)
// ============================================================================

let stateUpdateLock = Promise.resolve();

/**
 * Atomic state update helper - ensures no concurrent storage writes
 * @param {Function} updateFn - Function that receives current state and returns updates
 * @returns {Promise} - Resolves when update is complete
 */
async function atomicStateUpdate(updateFn) {
  // Chain updates to ensure they happen sequentially
  stateUpdateLock = stateUpdateLock.then(async () => {
    try {
      const current = await chrome.storage.local.get([
        "currentResults",
        "searchProgress",
        "searchStatus",
      ]);
      const updates = updateFn(current);
      if (updates && Object.keys(updates).length > 0) {
        await chrome.storage.local.set(updates);
      }
    } catch (e) {
      console.error("[State] Atomic update error:", e);
    }
  });
  return stateUpdateLock;
}

// ============================================================================
// SIDE PANEL SETUP
// ============================================================================

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ success: false, error: error.message }));

  return true; // Keep channel open for async response
});

// ============================================================================
// ORCHESTRATION (Background Process)
// ============================================================================

async function handleRunAllChecks(data) {
  const { customer, hasTrade } = data;

  // Initialize State
  const results = {
    customer: customer,
    timestamp: new Date().toISOString(),
    hasTrade: hasTrade,
    checks: {},
  };

  await chrome.storage.local.set({
    searchStatus: "running",
    searchProgress: 0,
    currentResults: results,
  });

  // Helper to save current state atomically (prevents race conditions)
  const saveState = async (progress) => {
    await atomicStateUpdate((current) => {
      const update = { currentResults: results };
      if (progress !== undefined) update.searchProgress = progress;
      return update;
    });
  };

  try {
    // Run OFAC in parallel with MDOS checks
    // But run MDOS checks SEQUENTIALLY to avoid session conflicts
    const hasCoBuyer = customer.hasCoBuyer && customer.coBuyer;

    // BUYER OFAC CHECK
    const ofacPromise = handleOfacCheck(customer).then(async (result) => {
      if (result.success) {
        const checkRes = result.result;
        checkRes.passed = !checkRes.hasMatch;
        results.checks.ofac = checkRes;
      } else {
        results.checks.ofac = { passed: true, error: result.error };
      }
      await saveState(hasCoBuyer ? 15 : 20);
    });

    // CO-BUYER OFAC CHECK (if has co-buyer)
    const coBuyerOfacPromise = hasCoBuyer
      ? handleOfacCheck(customer.coBuyer).then(async (result) => {
          if (result.success) {
            const checkRes = result.result;
            checkRes.passed = !checkRes.hasMatch;
            results.checks.coBuyerOfac = checkRes;
          } else {
            results.checks.coBuyerOfac = {
              passed: true,
              error: result.error,
            };
          }
          await saveState(25);
        })
      : Promise.resolve();

    // MDOS checks run sequentially (one after the other)
    const mdosPromise = (async () => {
      // 1. BUYER REPEAT OFFENDER CHECK
      await saveState(10);
      try {
        // Add storage key to customer object for this check
        const customerWithKey = {
          ...customer,
          screenshotStorageKey: "repeatOffenderScreenshot",
        };
        const roResult = await handleRepeatOffenderCheck(customerWithKey);
        if (roResult.success) {
          const checkRes = roResult.result;
          checkRes.passed = checkRes.status === "eligible";
          const roStorage = await chrome.storage.local.get(
            "repeatOffenderScreenshot"
          );
          if (roStorage.repeatOffenderScreenshot) {
            checkRes.screenshotData = roStorage.repeatOffenderScreenshot;
          }
          results.checks.repeatOffender = checkRes;
        } else {
          results.checks.repeatOffender = {
            passed: false,
            error: roResult.error,
            status: "error",
          };
        }
      } catch (e) {
        console.error("Repeat Offender Error:", e);
        results.checks.repeatOffender = {
          passed: false,
          error: e.message,
          status: "error",
        };
      }
      // Save after RO check
      await saveState(hasCoBuyer ? 35 : hasTrade ? 50 : 90);

      // 2. CO-BUYER REPEAT OFFENDER CHECK (if has co-buyer)
      if (hasCoBuyer) {
        await saveState(40);
        try {
          const coBuyerWithKey = {
            ...customer.coBuyer,
            screenshotStorageKey: "coBuyerRepeatOffenderScreenshot",
          };
          const cbRoResult = await handleRepeatOffenderCheck(coBuyerWithKey);
          if (cbRoResult.success) {
            const checkRes = cbRoResult.result;
            checkRes.passed = checkRes.status === "eligible";
            const cbRoStorage = await chrome.storage.local.get(
              "coBuyerRepeatOffenderScreenshot"
            );
            if (cbRoStorage.coBuyerRepeatOffenderScreenshot) {
              checkRes.screenshotData =
                cbRoStorage.coBuyerRepeatOffenderScreenshot;
            }
            results.checks.coBuyerRepeatOffender = checkRes;
          } else {
            results.checks.coBuyerRepeatOffender = {
              passed: false,
              error: cbRoResult.error,
              status: "error",
            };
          }
        } catch (e) {
          console.error("Co-Buyer Repeat Offender Error:", e);
          results.checks.coBuyerRepeatOffender = {
            passed: false,
            error: e.message,
            status: "error",
          };
        }
        await saveState(hasTrade ? 60 : 90);
      }

      // 3. TITLE CHECK (after Repeat Offender completes)
      if (hasTrade) {
        await saveState(70);
        try {
          const titleResult = await handleTitleCheck({
            vin: customer.tradeVin,
          });
          if (titleResult.success) {
            const checkRes = titleResult.result;
            const titleStorage = await chrome.storage.local.get(
              "titleScreenshot"
            );
            if (titleStorage.titleScreenshot) {
              checkRes.screenshotData = titleStorage.titleScreenshot;
            }
            results.checks.title = checkRes;
          } else {
            results.checks.title = {
              passed: false,
              error: titleResult.error,
              warning: true,
            };
          }
        } catch (e) {
          console.error("Title Check Error:", e);
          results.checks.title = {
            passed: false,
            error: e.message,
            warning: true,
          };
        }
        await saveState(90);
      }
    })();

    // Wait for all checks to complete
    await Promise.all([ofacPromise, coBuyerOfacPromise, mdosPromise]);

    // COMPLETE
    await chrome.storage.local.set({
      searchStatus: "complete",
      searchProgress: 100,
      currentResults: results, // Ensure final state is saved
    });
    return { success: true };
  } catch (globalError) {
    console.error("Global Check Error:", globalError);
    await chrome.storage.local.set({
      searchStatus: "error",
      lastError: globalError.message,
    });
    return { success: false, error: globalError.message };
  }
}

async function handleMessage(message, sender) {
  switch (message.type) {
    case "RUN_ALL_CHECKS":
      // Don't await this if we want to return immediately,
      // BUT we usually want to know if it accepted the command.
      // For background persistence, we fire and let the storage listeners handle UI.
      handleRunAllChecks(message.data);
      return { success: true, status: "started" };

    case "RUN_OFAC_CHECK":
      return await handleOfacCheck(message.data);

    case "RUN_REPEAT_OFFENDER":
    case "RUN_SEARCH": // Support original message type
      return await handleRepeatOffenderCheck(message.data);

    case "RUN_TITLE_CHECK":
      return await handleTitleCheck(message.data);

    case "EXPORT_PDF":
      return await handleExportPdf(message.data);

    case "CAPTURE_SCREENSHOT":
      return await capturePageAsScreenshot();

    case "getDataStatus":
      return await handleGetDataStatus();

    case "forceUpdate":
      return await performSDNUpdate();

    case "getSDNEntries":
      return await handleGetSDNEntries();

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ============================================================================
// OFAC CHECK (Matching original OFAC-Search)
// ============================================================================

async function handleOfacCheck(data) {
  try {
    await initDB();

    // Check if we have SDN data
    let entries = await getAllSDNEntries();

    if (entries.length === 0) {
      // Download SDN data first
      await performSDNUpdate();
      entries = await getAllSDNEntries();
    }

    if (entries.length === 0) {
      return {
        success: false,
        error: "Could not load SDN database. Please check internet connection.",
      };
    }

    // Prepare search name object
    const searchName = {
      firstName: data.firstName || "",
      middleName: data.middleName || "",
      lastName: data.lastName || "",
    };

    // Search for matches using fuzzy matching
    const matches = searchSDNEntries(searchName, entries, 85);

    const result = {
      hasMatch: matches.length > 0,
      matchCount: matches.length,
      matches: matches.slice(0, 5).map((m) => ({
        name: m.matchedName,
        score: m.score,
        type: m.entry.type,
        program: m.entry.program,
        country: m.entry.country,
      })),
      entriesSearched: entries.length,
      timestamp: new Date().toISOString(),
    };

    return { success: true, result };
  } catch (error) {
    console.error("OFAC check error:", error);
    return { success: false, error: error.message };
  }
}

async function handleGetDataStatus() {
  try {
    await initDB();
    const lastUpdate = await getSetting("lastUpdate");
    const publishDate = await getSetting("publishDate");
    const entryCount =
      (await getSetting("entryCount")) || (await getSDNCount());
    const updateStatus = await getSetting("updateStatus");
    const lastError = await getSetting("lastError");

    return {
      success: true,
      lastUpdate,
      publishDate,
      entryCount,
      updateStatus,
      lastError,
      needsUpdate: needsUpdate(lastUpdate) || entryCount === 0,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleGetSDNEntries() {
  try {
    await initDB();
    const entries = await getAllSDNEntries();
    return { success: true, entries };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function performSDNUpdate() {
  try {
    await saveSetting("updateStatus", "downloading");
    await saveSetting("lastError", null);

    const result = await downloadAndParseSDN();

    // Clear old entries and store new ones
    await clearSDNEntries();
    await storeSDNEntries(result.entries);

    // Save metadata
    await saveSetting("lastUpdate", result.downloadedAt);
    await saveSetting("publishDate", result.publishDate);
    await saveSetting("entryCount", result.count);
    await saveSetting("updateStatus", "complete");

    return { success: true, updated: true, count: result.count };
  } catch (error) {
    console.error("Failed to update SDN data:", error);
    await saveSetting("updateStatus", "error");
    await saveSetting("lastError", error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// REPEAT OFFENDER CHECK (Matching original Michigan-Repeat-Offender-Search)
// ============================================================================

async function handleRepeatOffenderCheck(searchData) {
  // Use backend API if enabled (headless browser on Fly.io)
  if (BACKEND_CONFIG.USE_BACKEND) {
    console.log("[RepeatOffender] Using Fly.io backend API");
    try {
      console.log("[RepeatOffender] Calling backendRepeatOffenderCheck...");
      const result = await backendRepeatOffenderCheck(searchData);
      console.log(
        "[RepeatOffender] Backend returned:",
        result.success ? "SUCCESS" : "FAILED"
      );

      if (result.success) {
        console.log("[RepeatOffender] Processing successful result...");
        // Store screenshot for later use
        const screenshotKey =
          searchData.screenshotStorageKey || "repeatOffenderScreenshot";
        if (result.result.screenshotData) {
          console.log("[RepeatOffender] Storing screenshot...");
          await chrome.storage.local.set({
            [screenshotKey]: result.result.screenshotData,
            lastResult: result.result,
          });
        }
        // Set badge
        const badgeText =
          result.result.status === "eligible"
            ? "✓"
            : result.result.status === "ineligible"
            ? "!"
            : "?";
        const badgeColor =
          result.result.status === "eligible"
            ? "#2e7d32"
            : result.result.status === "ineligible"
            ? "#c62828"
            : "#f57c00";
        await chrome.action.setBadgeText({ text: badgeText });
        await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
        // Save to history
        console.log("[RepeatOffender] Saving to history...");
        await addToRepeatOffenderHistory(searchData, result.result);
        console.log(
          "[RepeatOffender] Backend check complete, returning result"
        );
        return result;
      }
      // If backend fails, fall through to local execution
      console.warn(
        "[RepeatOffender] Backend failed, falling back to local:",
        result.error
      );
    } catch (backendError) {
      console.warn(
        "[RepeatOffender] Backend error, falling back to local:",
        backendError.message
      );
    }
  }

  // Local tab-based execution (fallback or when backend disabled)
  let tab = null;
  try {
    // Create NEW tab for independent execution
    tab = await chrome.tabs.create({ url: MDOS_BASE_URL, active: false });

    // Navigate to the form with retries
    const MAX_RETRIES = 5;
    let formReached = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await waitForTabReady(tab.id);

      const navResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: navigateToRepeatOffenderForm,
      });

      if (navResult?.[0]?.result?.success) {
        formReached = true;
        break;
      }

      if (navResult?.[0]?.result?.needsRetry) {
        await sleep(1000);
        continue;
      }

      if (navResult?.[0]?.result?.error) {
        throw new Error(navResult[0].result.error);
      }

      await sleep(1000);
    }

    if (!formReached) {
      throw new Error(
        "Could not navigate to the Repeat Offender Search form. Please ensure you are logged into MDOS."
      );
    }

    // Wait for form to be fully ready
    await sleep(300);

    // Execute automation script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: automateRepeatOffenderSearch,
      args: [searchData],
    });

    if (!results?.[0]?.result) {
      throw new Error("No result returned from automation script.");
    }

    const result = results[0].result;
    if (result.error) {
      throw new Error(result.error);
    }

    // Store result
    await chrome.storage.session.set({ lastResult: result });

    // Set badge
    const badgeText =
      result.status === "eligible"
        ? "✓"
        : result.status === "ineligible"
        ? "!"
        : "?";
    const badgeColor =
      result.status === "eligible"
        ? "#2e7d32"
        : result.status === "ineligible"
        ? "#c62828"
        : "#f57c00";
    await chrome.action.setBadgeText({ text: badgeText });
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor });

    // Capture screenshot (Serialized)
    const FAIL_IMAGE =
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMy9zdmciIHdpZHRoPSI1MDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgNTAwIDIwMCI+CiAgPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2ZmZTRlNCIgc3Ryb2tlPSIjZWMwMDAwIiBzdHJva2Utd2lkdGg9IjQiLz4KICA8dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9ImFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjI0IiBmaWxsPSIjZWMwMDAwIj4KICAgIFNjcmVlbnNob3QgQ2FwdHVyZSBGYWlsZWQKICA8L3RleHQ+CiAgPHRleHQgeD0iNTAlIiB5PSI3MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJhcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzY2NiI+CiAgICBTZWUgZGV0YWlscyBpbiByZXBvcnQgdGV4dAogIDwvdGV4dD4KPC9zdmc+";

    try {
      const screenshotResult = await capturePageAsScreenshotSerialized(tab.id);

      const storageUpdate = {
        lastResult: result,
      };

      // Use specific key if provided (e.g., 'coBuyerRepeatOffenderScreenshot'), otherwise default
      const screenshotKey =
        searchData.screenshotStorageKey || "repeatOffenderScreenshot";
      storageUpdate[screenshotKey] = screenshotResult.success
        ? screenshotResult.screenshotData
        : FAIL_IMAGE;

      await chrome.storage.local.set(storageUpdate);
    } catch (captureError) {
      console.error("[RepeatOffender] Screenshot error:", captureError.message);
      result.captureError = captureError.message;
      const screenshotKey =
        searchData.screenshotStorageKey || "repeatOffenderScreenshot";
      await chrome.storage.local.set({
        lastResult: result,
        [screenshotKey]: FAIL_IMAGE,
      });
    }

    // Save to history
    await addToRepeatOffenderHistory(searchData, result);

    // Close the tab
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {
        console.error("[RepeatOffender] Error closing tab:", e);
      }
    }

    return { success: true, result };
  } catch (error) {
    console.error("Repeat Offender check error:", error);
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {}
    }
    return { success: false, error: error.message };
  }
}

async function addToRepeatOffenderHistory(searchData, result) {
  try {
    const data = await chrome.storage.local.get("searchHistory");
    let history = data.searchHistory || [];

    const entry = {
      id: Date.now(),
      name: `${searchData.firstName} ${searchData.lastName}`,
      firstName: searchData.firstName,
      middleName: searchData.middleName || "",
      lastName: searchData.lastName,
      suffix: searchData.suffix || "",
      dob: searchData.dob,
      dlnPid: searchData.dlnPid,
      status: result.status,
      timestamp: result.timestamp || new Date().toISOString(),
      rawText: result.rawText,
      hasScreenshot: false,
    };

    history.unshift(entry);

    // Keep only last 6 entries (matching original)
    if (history.length > 6) {
      history.pop();
    }

    await chrome.storage.local.set({ searchHistory: history });
  } catch (err) {
    console.error("Failed to save history:", err);
  }
}

// ============================================================================
// TITLE CHECK
// ============================================================================

async function handleTitleCheck(data) {
  // Use backend API if enabled (headless browser on Fly.io)
  if (BACKEND_CONFIG.USE_BACKEND) {
    console.log("[TitleCheck] Using Fly.io backend API");
    try {
      const result = await backendTitleCheck(data);
      if (result.success) {
        // Store screenshot for later use
        if (result.result.screenshotData) {
          await chrome.storage.local.set({
            titleScreenshot: result.result.screenshotData,
          });
        }
        return result;
      }
      // If backend fails, fall through to local execution
      console.warn(
        "[TitleCheck] Backend failed, falling back to local:",
        result.error
      );
    } catch (backendError) {
      console.warn(
        "[TitleCheck] Backend error, falling back to local:",
        backendError.message
      );
    }
  }

  // Local tab-based execution (fallback or when backend disabled)
  let tab = null;
  try {
    // Step 1: Create tab at MDOS homepage
    tab = await chrome.tabs.create({ url: MDOS_BASE_URL, active: false });
    await waitForTabReady(tab.id);
    await sleep(300);

    // Step 1.5: Check for "Start Over" error page and handle it
    const startOverCheck = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const pageText = document.body.innerText.toLowerCase();
        if (
          pageText.includes("duplicated") ||
          pageText.includes("start over")
        ) {
          const clickables = document.querySelectorAll(
            "a, button, input[type='submit'], input[type='button'], div[role='button']"
          );
          for (const el of clickables) {
            if (
              (el.innerText &&
                el.innerText.toLowerCase().includes("start over")) ||
              (el.value && el.value.toLowerCase().includes("start over"))
            ) {
              el.click();
              return { clicked: true, wasStartOver: true };
            }
          }
          return { clicked: false, wasStartOver: true };
        }
        return { wasStartOver: false };
      },
    });

    if (startOverCheck?.[0]?.result?.wasStartOver) {
      if (startOverCheck[0].result.clicked) {
        await sleep(1500);
        await waitForTabReady(tab.id);
      } else {
        await chrome.tabs.update(tab.id, { url: MDOS_BASE_URL });
        await waitForTabReady(tab.id);
        await sleep(1000);
      }
    }

    // Step 2: Click "Search for Liens and Brands" link
    const clickResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const pageText = document.body.innerText.toLowerCase();
        const links = document.querySelectorAll("a");
        for (const link of links) {
          if (link.textContent.includes("Search for Liens and Brands")) {
            link.click();
            return { clicked: true };
          }
        }
        return { clicked: false };
      },
    });

    if (!clickResult?.[0]?.result?.clicked) {
      throw new Error(
        "Could not find 'Search for Liens and Brands' link on homepage"
      );
    }

    // Step 3: Wait for page/tab change
    await sleep(300);

    // Check if a new tab opened (the link may open a new tab)
    const allTabs = await chrome.tabs.query({
      url: "https://dsvsesvc.sos.state.mi.us/*",
    });

    // Use the most recently created tab (highest ID)
    if (allTabs.length > 0) {
      const newestTab = allTabs.reduce(
        (newest, t) => (t.id > newest.id ? t : newest),
        allTabs[0]
      );
      tab = newestTab;
      // Don't activate - keep in background
    }

    await waitForTabReady(tab.id);
    await sleep(1000);

    // Step 4: Verify we're on the vehicle type selection page
    const MAX_RETRIES = 5;
    let formReached = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const checkResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const pageText = document.body.innerText.toLowerCase();
          if (
            pageText.includes("select the type of vehicle") ||
            pageText.includes("lien and vehicle brand") ||
            pageText.includes("lien and brand information") ||
            pageText.includes("vehicle information, liens, and brands") ||
            (pageText.includes("watercraft") &&
              pageText.includes("snowmobile") &&
              pageText.includes("vehicle")) ||
            pageText.includes("car/truck")
          ) {
            return { success: true };
          }
          return { needsRetry: true };
        },
      });

      if (checkResult?.[0]?.result?.success) {
        formReached = true;
        break;
      }

      await sleep(300);
      await waitForTabReady(tab.id);
    }

    if (!formReached) {
      throw new Error(
        "Could not reach vehicle type selection. Please try again."
      );
    }

    await sleep(200);

    // Step 5: Click "Vehicle" link to go to the VIN entry form
    const vehicleClickResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const links = document.querySelectorAll("a");
        for (const link of links) {
          const text = link.textContent.trim().toLowerCase();
          if (text === "vehicle" || text.includes("vehicle information")) {
            link.click();
            return { clicked: true };
          }
        }
        for (const link of links) {
          const text = link.textContent.trim().toLowerCase();
          if (text.includes("car") || text.includes("truck")) {
            link.click();
            return { clicked: true };
          }
        }
        return { clicked: false };
      },
    });

    if (!vehicleClickResult?.[0]?.result?.clicked) {
      throw new Error("Could not find 'Vehicle' link on type selection page");
    }

    // Wait for VIN entry page to load
    await sleep(1500);
    await waitForTabReady(tab.id);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: automateTitleSearch,
      args: [data],
    });

    if (!results?.[0]?.result) {
      throw new Error("No result returned from Title search");
    }

    const result = results[0].result;
    if (result.error) {
      throw new Error(result.error);
    }

    // Capture screenshot (Serialized)
    const FAIL_IMAGE =
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMy9zdmciIHdpZHRoPSI1MDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgNTAwIDIwMCI+CiAgPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2ZmZTRlNCIgc3Ryb2tlPSIjZWMwMDAwIiBzdHJva2Utd2lkdGg9IjQiLz4KICA8dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9ImFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjI0IiBmaWxsPSIjZWMwMDAwIj4KICAgIFNjcmVlbnNob3QgQ2FwdHVyZSBGYWlsZWQKICA8L3RleHQ+CiAgPHRleHQgeD0iNTAlIiB5PSI3MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJhcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzY2NiI+CiAgICBTZWUgZGV0YWlscyBpbiByZXBvcnQgdGV4dAogIDwvdGV4dD4KPC9zdmc+";

    try {
      const screenshotResult = await capturePageAsScreenshotSerialized(tab.id);

      await chrome.storage.local.set({
        titleScreenshot: screenshotResult.success
          ? screenshotResult.screenshotData
          : FAIL_IMAGE,
      });
    } catch (captureError) {
      console.error("[TitleCheck] Screenshot capture error:", captureError);
      result.captureError = captureError.message;
      await chrome.storage.local.set({
        titleScreenshot: FAIL_IMAGE,
      });
    }

    await chrome.storage.session.set({ lastTitleResult: result });

    // Close the tab
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {
        console.error("[TitleCheck] Error closing tab:", e);
      }
    }

    return { success: true, result };
  } catch (error) {
    console.error("Title check error:", error);
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {}
    }
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// MDOS TAB MANAGEMENT
// ============================================================================

async function getOrCreateMDOSTab() {
  const tabs = await chrome.tabs.query({
    url: "https://dsvsesvc.sos.state.mi.us/*",
  });

  if (tabs.length > 0) {
    // Tab exists - keep it, don't make active
    return tabs[0];
  }

  // Create new tab in background (won't steal focus)
  return await chrome.tabs.create({ url: MDOS_BASE_URL, active: false });
}

async function waitForTabReady(tabId, maxWait = 30000) {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkTab = async () => {
      if (Date.now() - startTime > maxWait) {
        reject(new Error("Timeout waiting for page to load."));
        return;
      }

      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          await sleep(300); // Brief delay for SPA rendering
          resolve();
        } else {
          setTimeout(checkTab, 200);
        }
      } catch (err) {
        reject(err);
      }
    };

    checkTab();
  });
}

// ============================================================================
// SCREENSHOT CAPTURE (Matching original)
// ============================================================================

// Serialized screenshot capture to prevent conflicts
let captureLock = Promise.resolve();

async function capturePageAsScreenshotSerialized(targetTabId) {
  const next = captureLock.then(() => capturePageAsScreenshot(targetTabId));
  captureLock = next.catch(() => {}); // prevent chain failure
  return next;
}

async function capturePageAsScreenshot(targetTabId = null) {
  let mdosTabId = null;
  let mdosTab = null;

  console.log(
    "[Screenshot] Starting capture (Background Mode with html2canvas)..."
  );

  try {
    // 1. Identify valid tab
    if (targetTabId) {
      try {
        mdosTab = await chrome.tabs.get(targetTabId);
        mdosTabId = mdosTab.id;
      } catch (e) {
        console.warn("[Screenshot] Target tab invalid:", e);
      }
    }

    if (!mdosTab) {
      // Fallback search
      const tabs = await chrome.tabs.query({
        url: "https://dsvsesvc.sos.state.mi.us/*",
      });
      if (tabs.length > 0) {
        mdosTab = tabs[0];
        mdosTabId = mdosTab.id;
      } else {
        throw new Error("No MDOS tab found");
      }
    }

    // 2. Wait for page to be ready and validate URL
    await sleep(400);

    // Refresh tab info to get latest URL
    try {
      mdosTab = await chrome.tabs.get(mdosTabId);
    } catch (e) {}

    console.log("[Screenshot] Target URL:", mdosTab?.url);

    if (
      !mdosTab?.url ||
      mdosTab.url.startsWith("chrome:") ||
      mdosTab.url.startsWith("about:") ||
      mdosTab.url.startsWith("edge:")
    ) {
      throw new Error(
        `Cannot capture restricted URL: ${mdosTab?.url || "unknown"}`
      );
    }

    // 3. First inject html2canvas library as a file
    console.log("[Screenshot] Injecting html2canvas library...");
    try {
      await chrome.scripting.executeScript({
        target: { tabId: mdosTabId },
        files: ["lib/html2canvas.min.js"],
      });
    } catch (e) {
      console.log(
        "[Screenshot] Library injection skipped (may already exist):",
        e.message
      );
    }

    // 4. Wait for library to initialize
    await sleep(300);

    // 5. Now run the capture script
    console.log("[Screenshot] Capturing with html2canvas...");
    const results = await chrome.scripting.executeScript({
      target: { tabId: mdosTabId },
      func: async () => {
        return new Promise(async (resolve) => {
          try {
            // Check html2canvas is loaded
            if (typeof html2canvas === "undefined") {
              resolve({ success: false, error: "html2canvas not loaded" });
              return;
            }

            // Scroll to top first
            window.scrollTo({ top: 0, behavior: "instant" });

            // Wait a moment for any animations
            await new Promise((r) => setTimeout(r, 500));

            // Capture with html2canvas
            const canvas = await html2canvas(document.body, {
              useCORS: true,
              allowTaint: true,
              backgroundColor: "#ffffff",
              scale: 1.5, // Higher quality
              logging: false,
              windowWidth: 1200,
              windowHeight: 900,
              x: 0,
              y: 0,
              scrollX: 0,
              scrollY: 0,
            });

            // Convert to base64
            const dataUrl = canvas.toDataURL("image/png");
            const base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");

            resolve({
              success: true,
              screenshotData: base64,
              format: "png",
            });
          } catch (err) {
            resolve({ success: false, error: err.message });
          }
        });
      },
    });

    if (!results?.[0]?.result) {
      throw new Error("No result from screenshot script");
    }

    const result = results[0].result;
    if (!result.success) {
      throw new Error(result.error || "Screenshot capture failed");
    }

    console.log("[Screenshot] Capture successful (background mode)");
    return result;
  } catch (error) {
    console.error("[Screenshot] Capture Failed:", error.message);
    throw error;
  }
}

// ============================================================================
// PDF EXPORT
// ============================================================================

async function handleExportPdf(data) {
  return {
    success: false,
    error: "PDF generation not implemented - using HTML fallback",
  };
}

// ============================================================================
// CONTENT SCRIPT FUNCTIONS (Injected into MDOS pages)
// ============================================================================

/**
 * Navigate to Repeat Offender form
 * MATCHES: TechSavvyJoe/Michigan-Repeat-Offender-Search/background.js
 */
function navigateToRepeatOffenderForm() {
  function clickElementWithText(searchText) {
    const lowerText = searchText.toLowerCase();

    const links = document.querySelectorAll("a");
    for (const link of links) {
      if (link.textContent.toLowerCase().includes(lowerText)) {
        link.click();
        return true;
      }
    }

    const clickables = document.querySelectorAll(
      'button, [role="button"], [onclick]'
    );
    for (const el of clickables) {
      if (el.textContent.toLowerCase().includes(lowerText)) {
        el.click();
        return true;
      }
    }

    const allElements = document.querySelectorAll("span, div, p");
    for (const el of allElements) {
      if (
        el.textContent.toLowerCase().includes(lowerText) &&
        el.children.length === 0
      ) {
        el.click();
        return true;
      }
    }

    return false;
  }

  const pageText = document.body.innerText;

  // Check if we're already on the form
  if (
    pageText.includes("Repeat Offender Search") &&
    (pageText.includes("Enter the full name") || pageText.includes("Last Name"))
  ) {
    return { success: true };
  }

  // Handle "Start Over" error page (duplicated tab/window message)
  if (pageText.includes("duplicated") || pageText.includes("Start Over")) {
    const clicked =
      clickElementWithText("Start Over") ||
      clickElementWithText("Click Here to Start Over");
    if (clicked) {
      return { needsRetry: true, step: "clicked Start Over" };
    }
  }

  // Click "Dealer Services" from main page
  if (
    pageText.includes("Dealer Services") &&
    !pageText.includes("Search Repeat Offender") &&
    !pageText.includes("Enter the full name")
  ) {
    const clicked = clickElementWithText("Dealer Services");
    if (clicked) {
      return { needsRetry: true, step: "clicked Dealer Services" };
    }
  }

  // Click "Search Repeat Offender" from Dealer Services menu
  if (
    pageText.includes("Search Repeat Offender") ||
    pageText.includes("Repeat Offender")
  ) {
    const clicked =
      clickElementWithText("Search Repeat Offender") ||
      clickElementWithText("Repeat Offender");
    if (clicked) {
      return { needsRetry: true, step: "clicked Search Repeat Offender" };
    }
  }

  // If we get here, we don't know where we are
  return {
    error:
      "Could not find navigation elements. Please manually navigate to Dealer Services → Search Repeat Offender and try again.",
  };
}

/**
 * Automate Repeat Offender search
 * MATCHES: TechSavvyJoe/Michigan-Repeat-Offender-Search/background.js automateSearch()
 */
function automateRepeatOffenderSearch(searchData) {
  return new Promise((resolve) => {
    const TIMEOUT = 15000;

    function waitForTextOnPage(text, timeout = TIMEOUT) {
      return new Promise((res, rej) => {
        const start = Date.now();
        const check = () => {
          if (document.body.innerText.includes(text)) {
            res(true);
            return;
          }
          if (Date.now() - start > timeout) {
            rej(new Error(`Timeout waiting for "${text}". Are you logged in?`));
            return;
          }
          setTimeout(check, 300);
        };
        check();
      });
    }

    function findInputNearLabel(labelText) {
      const lowerLabel = labelText.toLowerCase();

      const labels = document.querySelectorAll("label");
      for (const label of labels) {
        if (label.textContent.toLowerCase().includes(lowerLabel)) {
          if (label.htmlFor) {
            const input = document.getElementById(label.htmlFor);
            if (input) return input;
          }

          const innerInput = label.querySelector("input, select");
          if (innerInput) return innerInput;

          const container = label.closest(
            ".form-group, .field, .input-group, div"
          );
          if (container) {
            const containerInput = container.querySelector("input, select");
            if (containerInput) return containerInput;
          }

          let sibling = label.nextElementSibling;
          while (sibling) {
            if (sibling.tagName === "INPUT" || sibling.tagName === "SELECT") {
              return sibling;
            }
            const siblingInput = sibling.querySelector("input, select");
            if (siblingInput) return siblingInput;
            sibling = sibling.nextElementSibling;
          }
        }
      }

      // XPath fallback
      const xpath = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${lowerLabel}')]`;
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i);
        let parent = node.parentElement;
        for (let j = 0; j < 5 && parent; j++) {
          const input = parent.querySelector(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select'
          );
          if (input) return input;
          parent = parent.parentElement;
        }
      }

      // Check placeholders
      const allInputs = document.querySelectorAll("input, select");
      for (const input of allInputs) {
        if (input.placeholder?.toLowerCase().includes(lowerLabel)) return input;
        if (
          input.getAttribute("aria-label")?.toLowerCase().includes(lowerLabel)
        )
          return input;
      }

      return null;
    }

    function setInputValue(input, value) {
      if (!input || value === undefined || value === null) return false;

      const strValue = String(value);

      if (input.tagName === "SELECT") {
        for (const option of input.options) {
          if (
            option.value === strValue ||
            option.textContent.trim() === strValue
          ) {
            input.value = option.value;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }

      // Use native setter for reactivity
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      );
      if (descriptor?.set) {
        descriptor.set.call(input, strValue);
      } else {
        input.value = strValue;
      }

      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));

      return true;
    }

    function clickButtonByText(buttonText) {
      const lowerText = buttonText.toLowerCase();
      const buttons = document.querySelectorAll(
        'button, input[type="submit"], input[type="button"], [role="button"]'
      );

      for (const btn of buttons) {
        const text = (btn.textContent || btn.value || "").toLowerCase().trim();
        if (text.includes(lowerText)) {
          btn.click();
          return true;
        }
      }

      return false;
    }

    function extractResultText() {
      const selectors = [
        ".modal-body",
        ".dialog-content",
        ".result",
        ".alert",
        ".message",
        '[role="dialog"]',
        '[role="alert"]',
        ".notification",
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el?.innerText.trim()) {
          return el.innerText.trim();
        }
      }

      const keywords = ["eligible", "ineligible", "denial", "repeat offender"];
      const allElements = document.querySelectorAll("div, p, span, section");

      for (const el of allElements) {
        const text = el.innerText.toLowerCase();
        for (const kw of keywords) {
          if (text.includes(kw) && el.innerText.length < 1000) {
            return el.innerText.trim();
          }
        }
      }

      return document.body.innerText.substring(0, 500);
    }

    function classifyResult(rawText) {
      const lower = rawText.toLowerCase();

      if (
        lower.includes("ineligible") ||
        lower.includes("denial") ||
        lower.includes("not eligible")
      ) {
        return "ineligible";
      }

      if (lower.includes("eligible") && !lower.includes("ineligible")) {
        return "eligible";
      }

      if (lower.includes("no record") || lower.includes("not found")) {
        return "eligible";
      }

      return "unknown";
    }

    async function run() {
      try {
        await waitForTextOnPage("Repeat Offender Search");
        await new Promise((r) => setTimeout(r, 500));

        // Fill First Name
        if (searchData.firstName) {
          const firstNameInput = findInputNearLabel("First Name");
          if (firstNameInput)
            setInputValue(firstNameInput, searchData.firstName);
        }

        // Fill Middle Name
        if (searchData.middleName) {
          const middleNameInput = findInputNearLabel("Middle Name");
          if (middleNameInput)
            setInputValue(middleNameInput, searchData.middleName);
        }

        // Fill Last Name (required)
        const lastNameInput = findInputNearLabel("Last Name");
        if (!lastNameInput) {
          return resolve({
            error: "Could not find Last Name field. Is the form loaded?",
          });
        }
        setInputValue(lastNameInput, searchData.lastName);

        // Fill Suffix
        if (searchData.suffix) {
          const suffixInput = findInputNearLabel("Suffix");
          if (suffixInput) setInputValue(suffixInput, searchData.suffix);
        }

        // Fill Date of Birth
        const dobInput = findInputNearLabel("Date of Birth");
        if (!dobInput) {
          return resolve({ error: "Could not find Date of Birth field." });
        }
        setInputValue(dobInput, searchData.dob);

        // Fill DLN/PID
        const dlnInput = findInputNearLabel("DLN") || findInputNearLabel("PID");
        if (!dlnInput) {
          return resolve({ error: "Could not find DLN/PID Number field." });
        }
        setInputValue(dlnInput, searchData.dlnPid);

        await new Promise((r) => setTimeout(r, 300));

        // Click Search button
        const clicked = clickButtonByText("Search");
        if (!clicked) {
          return resolve({ error: "Could not find Search button." });
        }

        // Poll for results (up to 15s)
        const pollStart = Date.now();
        let finalRawText = "";
        let finalStatus = "unknown";

        while (Date.now() - pollStart < 15000) {
          const rawText = extractResultText();
          const status = classifyResult(rawText);

          if (status !== "unknown") {
            finalRawText = rawText;
            finalStatus = status;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        // If still unknown after timeout, settle for whatever text we have
        if (finalStatus === "unknown") {
          finalRawText = extractResultText();
        }

        resolve({
          status: finalStatus,
          rawText: finalRawText,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        resolve({ error: err.message });
      }
    }

    run();
  });
}

/**
 * Navigate to Title Status form
 */
/**
 * Navigate to Lien and Brand Information form
 * Workflow: Homepage → "Search for Liens and Brands" → Form page
 */
function navigateToTitleStatusForm() {
  function clickElementWithText(searchText) {
    const lowerText = searchText.toLowerCase();

    // Try links first
    const links = document.querySelectorAll("a");
    for (const link of links) {
      if (link.textContent.toLowerCase().includes(lowerText)) {
        link.click();
        return true;
      }
    }

    // Try buttons and clickable elements
    const clickables = document.querySelectorAll(
      'button, [role="button"], [onclick]'
    );
    for (const el of clickables) {
      if (el.textContent.toLowerCase().includes(lowerText)) {
        el.click();
        return true;
      }
    }

    return false;
  }

  const pageText = document.body.innerText;
  const lowerPageText = pageText.toLowerCase();

  // Check if we're already on the Lien and Brand form (has VIN input)
  if (
    lowerPageText.includes("lien and brand information") &&
    (lowerPageText.includes("vehicle identification number") ||
      lowerPageText.includes("enter the vehicle") ||
      document.querySelector('input[type="text"]'))
  ) {
    return { success: true };
  }

  // Handle "Start Over" error page (duplicated session)
  if (
    lowerPageText.includes("duplicated") ||
    lowerPageText.includes("click here to start over")
  ) {
    const clicked =
      clickElementWithText("Start Over") ||
      clickElementWithText("Click Here to Start Over");
    if (clicked) {
      return { needsRetry: true, step: "clicked Start Over" };
    }
  }

  // If we're in Dealer Services area (wrong section), click Home to go back
  if (
    lowerPageText.includes("dealer services") ||
    lowerPageText.includes("repeat offender")
  ) {
    const clicked = clickElementWithText("Home") || clickElementWithText("TAP");
    if (clicked) {
      return { needsRetry: true, step: "clicked Home to go back" };
    }
  }

  // From homepage: Click "Search for Liens and Brands" under Vehicle Searches
  if (
    lowerPageText.includes("vehicle searches") ||
    lowerPageText.includes("search for liens and brands")
  ) {
    const clicked = clickElementWithText("Search for Liens and Brands");
    if (clicked) {
      return { needsRetry: true, step: "clicked Search for Liens and Brands" };
    }
  }

  // Fallback: try any link containing "lien" or "brand"
  if (
    clickElementWithText("Liens and Brands") ||
    clickElementWithText("Lien")
  ) {
    return { needsRetry: true, step: "clicked lien link" };
  }

  return {
    error:
      "Could not find Lien and Brand search. Please navigate to MDOS homepage and look for 'Search for Liens and Brands' under Vehicle Searches.",
  };
}

/**
 * Automate Lien and Brand search
 * Workflow: Select Car/Truck → Enter VIN → Click Search → Parse Results
 */
function automateTitleSearch(data) {
  return new Promise((resolve) => {
    async function run() {
      try {
        await new Promise((r) => setTimeout(r, 500));

        // Step 1: Select "Car/Truck" radio button (if present)
        const radioButtons = document.querySelectorAll('input[type="radio"]');
        for (const radio of radioButtons) {
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);
          const labelText = label?.textContent?.toLowerCase() || "";
          const radioValue = radio.value?.toLowerCase() || "";

          if (
            labelText.includes("car") ||
            labelText.includes("truck") ||
            radioValue.includes("car") ||
            radioValue.includes("truck")
          ) {
            radio.checked = true;
            radio.click();
            radio.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }

        await new Promise((r) => setTimeout(r, 2000));

        // Step 2: Find and fill VIN input
        // Look for input near "Vehicle Identification Number" label or any text input
        let vinInput = null;

        // Strategy 1: Look for input near VIN label
        const labels = document.querySelectorAll("label, span, div, p");
        for (const label of labels) {
          const text = label.textContent.toLowerCase();
          if (text.includes("vehicle identification") || text.includes("vin")) {
            // Find nearby input
            const container = label.closest("div, form, section");
            if (container) {
              vinInput = container.querySelector(
                'input[type="text"], input:not([type])'
              );
              if (vinInput) break;
            }
            // Check next siblings
            let sibling = label.nextElementSibling;
            while (sibling && !vinInput) {
              if (sibling.tagName === "INPUT") {
                vinInput = sibling;
                break;
              }
              vinInput = sibling.querySelector(
                'input[type="text"], input:not([type])'
              );
              sibling = sibling.nextElementSibling;
            }
            if (vinInput) break;
          }
        }

        // Strategy 2: Find any visible text input
        if (!vinInput) {
          const inputs = document.querySelectorAll(
            'input[type="text"], input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="submit"]):not([type="button"])'
          );
          for (const input of inputs) {
            if (input.offsetParent !== null) {
              // visible
              vinInput = input;
              break;
            }
          }
        }

        if (!vinInput) {
          return resolve({ error: "Could not find VIN input field" });
        }

        // Fill VIN using native setter for framework reactivity
        vinInput.focus();
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        );
        if (descriptor?.set) {
          descriptor.set.call(vinInput, data.vin);
        } else {
          vinInput.value = data.vin;
        }
        vinInput.dispatchEvent(new Event("input", { bubbles: true }));
        vinInput.dispatchEvent(new Event("change", { bubbles: true }));
        vinInput.dispatchEvent(new Event("blur", { bubbles: true }));

        await new Promise((r) => setTimeout(r, 300));

        // Step 3: Click Search button
        let clicked = false;
        const buttons = document.querySelectorAll(
          'button, input[type="submit"], input[type="button"], [role="button"]'
        );
        for (const btn of buttons) {
          const text = (btn.textContent || btn.value || "")
            .toLowerCase()
            .trim();
          if (text.includes("search") && !text.includes("start over")) {
            btn.click();
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          // Try any submit-like button
          for (const btn of buttons) {
            const text = (btn.textContent || btn.value || "")
              .toLowerCase()
              .trim();
            if (
              text.includes("submit") ||
              text.includes("go") ||
              text.includes("lookup")
            ) {
              btn.click();
              clicked = true;
              break;
            }
          }
        }

        if (!clicked) {
          return resolve({ error: "Could not find Search button" });
        }

        // Step 4: Wait for results to load
        await new Promise((r) => setTimeout(r, 4000));

        // Step 5: Parse the results page
        const resultText = document.body.innerText;
        const lower = resultText.toLowerCase();

        // Check for "No record found" error
        if (
          lower.includes("no record found") ||
          lower.includes("no vehicle found")
        ) {
          return resolve({ error: "No record found for this VIN" });
        }

        // Initialize result object
        const result = {
          vin: data.vin,
          year: null,
          make: null,
          model: null,
          unladenWeight: null,
          titleType: "UNKNOWN",
          titleIssued: null,
          lienStatus: "UNKNOWN",
          hasLien: false,
          vehicleBrands: [],
          titleBrand: "CLEAN", // Default to clean
          rawText: resultText.substring(0, 1500),
          timestamp: new Date().toISOString(),
        };

        // Parse Year
        const yearMatch = resultText.match(/Year:\s*(\d{4})/i);
        if (yearMatch) result.year = yearMatch[1];

        // Parse Make
        const makeMatch = resultText.match(
          /Make:\s*([A-Z][A-Za-z\s]+?)(?=\n|Model:|$)/i
        );
        if (makeMatch) result.make = makeMatch[1].trim();

        // Parse Model
        const modelMatch = resultText.match(
          /Model:\s*([A-Z][A-Za-z0-9\s-]+?)(?=\n|Unladen|$)/i
        );
        if (modelMatch) result.model = modelMatch[1].trim();

        // Parse Unladen Weight
        const weightMatch = resultText.match(
          /Unladen Weight:\s*([\d,]+(?:\.\d+)?)\s*lbs/i
        );
        if (weightMatch) result.unladenWeight = weightMatch[1];

        // Parse Title Type (Paper or Electronic)
        const titleTypeMatch = resultText.match(
          /Title Type:\s*(Paper|Electronic)/i
        );
        if (titleTypeMatch) result.titleType = titleTypeMatch[1].toUpperCase();

        // Parse Title Issued date
        const issuedMatch = resultText.match(
          /Title Issued:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
        );
        if (issuedMatch) result.titleIssued = issuedMatch[1];

        // Parse Lien Status
        if (
          lower.includes("no active liens on vehicle") ||
          lower.includes("no active lien")
        ) {
          result.lienStatus = "NO ACTIVE LIENS";
          result.hasLien = false;
        } else if (
          lower.includes("active lien") ||
          lower.includes("lien holder") ||
          lower.includes("lienholder")
        ) {
          result.lienStatus = "ACTIVE LIEN";
          result.hasLien = true;
          // Try to extract lien holder name
          const lienHolderMatch = resultText.match(
            /Lien(?:\s*Holder)?:\s*([^\n]+)/i
          );
          if (lienHolderMatch) result.lienHolder = lienHolderMatch[1].trim();
        }

        // Parse Vehicle Brands
        if (
          lower.includes("no brands were returned") ||
          lower.includes("no brands")
        ) {
          result.vehicleBrands = [];
          result.titleBrand = "CLEAN";
        } else {
          // Check for specific brand types
          const brandKeywords = [
            "salvage",
            "rebuilt",
            "flood",
            "fire",
            "junk",
            "lemon",
            "odometer",
          ];
          for (const brand of brandKeywords) {
            if (lower.includes(brand)) {
              result.vehicleBrands.push(brand.toUpperCase());
              result.titleBrand = brand.toUpperCase();
            }
          }
        }

        // Determine pass/fail status
        result.passed = result.titleBrand === "CLEAN" && !result.hasLien;

        resolve(result);
      } catch (err) {
        resolve({ error: err.message });
      }
    }

    run();
  });
}

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// OFAC DATABASE UPDATE (Scheduled)
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await initDB();
    await performSDNUpdate();
  } else if (details.reason === "update") {
    await initDB();
    const status = await handleGetDataStatus();
    if (status.needsUpdate) {
      await performSDNUpdate();
    }
  }

  await setupUpdateAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await initDB();
  const status = await handleGetDataStatus();
  if (status.needsUpdate) {
    await performSDNUpdate();
  }
  await setupUpdateAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === UPDATE_ALARM_NAME) {
    await performSDNUpdate();
  }
});

async function setupUpdateAlarm() {
  await chrome.alarms.clear(UPDATE_ALARM_NAME);
  chrome.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes: UPDATE_INTERVAL_HOURS * 60,
    periodInMinutes: UPDATE_INTERVAL_HOURS * 60,
  });
}

console.log("Compliance Central service worker loaded");
