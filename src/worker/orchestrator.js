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

export async function handleRunAllChecks(data) {
  const { customer, hasTrade } = data;

  const results = {
    customer,
    timestamp: new Date().toISOString(),
    hasTrade,
    checks: {},
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.running,
    [STORAGE_KEYS.searchProgress]: 0,
    [STORAGE_KEYS.currentResults]: results,
    [STORAGE_KEYS.inFlightCheck]: IN_FLIGHT.ofac,
  });

  const saveState = async (progress) => {
    await atomicStateUpdate(() => {
      const update = { [STORAGE_KEYS.currentResults]: results };
      if (progress !== undefined) update[STORAGE_KEYS.searchProgress] = progress;
      return update;
    });
  };

  const setInFlight = async (key) => {
    await chrome.storage.local.set({ [STORAGE_KEYS.inFlightCheck]: key });
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
        results.checks.ofac = { passed: true, error: result.error };
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
            results.checks.coBuyerOfac = { passed: true, error: result.error };
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

      // 1. Buyer Repeat Offender.
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
          const roStorage = await chrome.storage.local.get(
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

      // 2. Co-Buyer Repeat Offender.
      if (hasCoBuyer) {
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
            const cbStorage = await chrome.storage.local.get(
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
            const titleStorage = await chrome.storage.local.get(
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

    await Promise.all([ofacPromise, coBuyerOfacPromise, mdosPromise]);

    await chrome.storage.local.set({
      [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.complete,
      [STORAGE_KEYS.searchProgress]: 100,
      [STORAGE_KEYS.currentResults]: results,
      [STORAGE_KEYS.inFlightCheck]: null,
    });
    return { success: true };
  } catch (err) {
    console.error("Run-all error:", err);
    await chrome.storage.local.set({
      [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.error,
      [STORAGE_KEYS.lastError]: err.message,
      [STORAGE_KEYS.inFlightCheck]: null,
    });
    return { success: false, error: err.message };
  }
}
