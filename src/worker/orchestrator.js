/**
 * Run-all orchestration.
 *
 * - OFAC checks (buyer + optional co-buyer) run in parallel locally.
 * - MDOS checks (repeat offender, title) run sequentially because the
 *   MDOS portal session is single-tenant per IP — concurrent requests
 *   from the backend collide. Confirmed by commit f64281c.
 *
 * Progress weighting: OFAC 0-20%, MDOS 20-95%, finalization 95-100%.
 * `inFlightCheck` is written before each await so the sidepanel can mark
 * the current row as "Running" with a pulse animation.
 */

import { handleOfacCheck } from "./ofac-check.js";
import { handleRepeatOffenderCheck, handleTitleCheck } from "./mdos-check.js";
import { atomicStateUpdate } from "./state.js";
import {
  STORAGE_KEYS,
  SEARCH_STATUS,
  IN_FLIGHT,
} from "../../lib/storage-keys.js";

// Single-flight guard. The MDOS portal session is single-tenant per IP, so a
// second concurrent run would collide with the first. The sidepanel also
// disables its buttons while running; this is the worker-side backstop.
let runInFlight = false;

export async function handleRunAllChecks(data) {
  if (runInFlight) {
    return { success: false, error: "A compliance run is already in progress." };
  }
  runInFlight = true;
  try {
    return await runAllChecks(data);
  } finally {
    runInFlight = false;
  }
}

async function runAllChecks(data) {
  const { customer, hasTrade } = data;

  const results = {
    customer,
    timestamp: new Date().toISOString(),
    hasTrade,
    runType: "full",
    runLabel: "Run All Checks",
    checks: {},
  };

  await chrome.storage.session.set({
    [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.running,
    [STORAGE_KEYS.searchProgress]: 0,
    [STORAGE_KEYS.currentResults]: results,
    [STORAGE_KEYS.inFlightCheck]: IN_FLIGHT.ofac,
  });

  const saveState = async (progress) => {
    await atomicStateUpdate((current) => {
      const update = { [STORAGE_KEYS.currentResults]: results };
      if (progress !== undefined) {
        // Keep progress monotonic: the OFAC and MDOS branches write
        // concurrently, so never let a later write move the bar backwards.
        const prev = current[STORAGE_KEYS.searchProgress] || 0;
        update[STORAGE_KEYS.searchProgress] = Math.max(prev, progress);
      }
      return update;
    });
  };

  const setInFlight = async (key) => {
    await chrome.storage.session.set({ [STORAGE_KEYS.inFlightCheck]: key });
  };

  try {
    const hasCoBuyer = customer.hasCoBuyer && customer.coBuyer;

    // OFAC checks (parallel).
    const ofacPromise = handleOfacCheck(customer).then(async (result) => {
      if (result.success) {
        results.checks.ofac = {
          ...result.result,
          passed: !result.result.hasMatch,
        };
      } else {
        results.checks.ofac = {
          passed: false,
          status: "error",
          error: result.error || "OFAC screening failed",
        };
      }
      await saveState(hasCoBuyer ? 15 : 20);
    });

    const coBuyerOfacPromise = hasCoBuyer
      ? handleOfacCheck(customer.coBuyer).then(async (result) => {
          if (result.success) {
            results.checks.coBuyerOfac = {
              ...result.result,
              passed: !result.result.hasMatch,
            };
          } else {
            results.checks.coBuyerOfac = {
              passed: false,
              status: "error",
              error: result.error || "Co-Buyer OFAC screening failed",
            };
          }
          await saveState(25);
        })
      : Promise.resolve();

    // MDOS checks (sequential).
    const mdosPromise = (async () => {
      const totalMdosChecks =
        1 + (hasCoBuyer ? 1 : 0) + (hasTrade ? 1 : 0);
      let completedMdos = 0;

      const mdosStart = 20;
      const mdosEnd = 95;
      const progressPerCheck = (mdosEnd - mdosStart) / totalMdosChecks;

      const updateMdosProgress = async (checkProgress = 0) => {
        const overall = Math.round(
          mdosStart + completedMdos * progressPerCheck + checkProgress * progressPerCheck
        );
        await saveState(overall);
      };

      // 1. Buyer Repeat Offender (Michigan license/ID only).
      if (customer.buyerIsMichigan === false) {
        results.checks.repeatOffender = {
          passed: null,
          status: "not_applicable",
          message:
            "Out-of-state ID — the Michigan Repeat Offender check does not apply.",
        };
        completedMdos++;
        await updateMdosProgress(0);
      } else {
      await setInFlight(IN_FLIGHT.repeatOffender);
      await updateMdosProgress(0);
      try {
        const customerWithKey = {
          ...customer,
          screenshotStorageKey: STORAGE_KEYS.repeatOffenderScreenshot,
        };
        await updateMdosProgress(0.2);
        const roResult = await handleRepeatOffenderCheck(customerWithKey);
        await updateMdosProgress(0.8);

        if (roResult.success) {
          const checkRes = roResult.result;
          checkRes.passed = checkRes.status === "eligible";
          const roStorage = await chrome.storage.session.get(
            STORAGE_KEYS.repeatOffenderScreenshot
          );
          if (roStorage[STORAGE_KEYS.repeatOffenderScreenshot]) {
            checkRes.screenshotData =
              roStorage[STORAGE_KEYS.repeatOffenderScreenshot];
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
        console.error("Repeat Offender error:", e);
        results.checks.repeatOffender = {
          passed: false,
          error: e.message,
          status: "error",
        };
      }
      completedMdos++;
      await updateMdosProgress(0);
      }

      // 2. Co-Buyer Repeat Offender.
      if (hasCoBuyer) {
        if (customer.coBuyerIsMichigan === false) {
          results.checks.coBuyerRepeatOffender = {
            passed: null,
            status: "not_applicable",
            message:
              "Out-of-state ID — the Michigan Repeat Offender check does not apply.",
          };
          completedMdos++;
          await updateMdosProgress(0);
        } else {
        await setInFlight(IN_FLIGHT.coBuyerRepeatOffender);
        try {
          const coBuyerWithKey = {
            ...customer.coBuyer,
            screenshotStorageKey: STORAGE_KEYS.coBuyerRepeatOffenderScreenshot,
          };
          await updateMdosProgress(0.2);
          const cbRoResult = await handleRepeatOffenderCheck(coBuyerWithKey);
          await updateMdosProgress(0.8);

          if (cbRoResult.success) {
            const checkRes = cbRoResult.result;
            checkRes.passed = checkRes.status === "eligible";
            const cbStorage = await chrome.storage.session.get(
              STORAGE_KEYS.coBuyerRepeatOffenderScreenshot
            );
            if (cbStorage[STORAGE_KEYS.coBuyerRepeatOffenderScreenshot]) {
              checkRes.screenshotData =
                cbStorage[STORAGE_KEYS.coBuyerRepeatOffenderScreenshot];
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
          console.error("Co-Buyer Repeat Offender error:", e);
          results.checks.coBuyerRepeatOffender = {
            passed: false,
            error: e.message,
            status: "error",
          };
        }
        completedMdos++;
        await updateMdosProgress(0);
        }
      }

      // 3. Title check.
      if (hasTrade) {
        await setInFlight(IN_FLIGHT.title);
        try {
          await updateMdosProgress(0.2);
          const titleResult = await handleTitleCheck({
            vin: customer.tradeVin,
          });
          await updateMdosProgress(0.8);

          if (titleResult.success) {
            const checkRes = titleResult.result;
            const titleStorage = await chrome.storage.session.get(
              STORAGE_KEYS.titleScreenshot
            );
            if (titleStorage[STORAGE_KEYS.titleScreenshot]) {
              checkRes.screenshotData = titleStorage[STORAGE_KEYS.titleScreenshot];
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
          console.error("Title check error:", e);
          results.checks.title = {
            passed: false,
            error: e.message,
            warning: true,
          };
        }
        completedMdos++;
        await updateMdosProgress(0);
      }
    })();

    // allSettled (not all): one failing branch must not wipe the others, so
    // partial results (e.g. OFAC passed but MDOS errored) still render.
    await Promise.allSettled([ofacPromise, coBuyerOfacPromise, mdosPromise]);

    // Guard against any branch rejecting before it recorded a result, so a
    // finished run can never silently omit a check the user expected to run.
    const ensureResult = (key, label, extra = {}) => {
      if (!results.checks[key]) {
        results.checks[key] = {
          passed: false,
          status: "error",
          error: `${label} did not complete`,
          ...extra,
        };
      }
    };
    ensureResult("ofac", "OFAC screening");
    ensureResult("repeatOffender", "Repeat Offender check");
    if (hasCoBuyer) {
      ensureResult("coBuyerOfac", "Co-Buyer OFAC screening");
      ensureResult("coBuyerRepeatOffender", "Co-Buyer Repeat Offender check");
    }
    if (hasTrade) {
      ensureResult("title", "Title check", { warning: true });
    }

    await chrome.storage.session.set({
      [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.complete,
      [STORAGE_KEYS.searchProgress]: 100,
      [STORAGE_KEYS.currentResults]: results,
      [STORAGE_KEYS.inFlightCheck]: null,
    });
    return { success: true };
  } catch (err) {
    console.error("Run-all error:", err);
    await chrome.storage.session.set({
      [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.error,
      [STORAGE_KEYS.lastError]: err.message,
      [STORAGE_KEYS.inFlightCheck]: null,
    });
    return { success: false, error: err.message };
  }
}
