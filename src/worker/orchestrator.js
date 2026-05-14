/**
 * Run-all orchestration.
 *
 * - OFAC checks (buyer + optional co-buyer) run in parallel locally.
 * - MDOS checks (repeat offender, title) run sequentially because the
 *   MDOS portal session is single-tenant per IP — concurrent requests
 *   from the backend collide. Confirmed by commit f64281c.
 *
 * Progress weighting: OFAC 0-20%, MDOS 20-95%, finalization 95-100%.
 */

import { handleOfacCheck } from "./ofac-check.js";
import { handleRepeatOffenderCheck, handleTitleCheck } from "./mdos-check.js";
import { atomicStateUpdate } from "./state.js";

export async function handleRunAllChecks(data) {
  const { customer, hasTrade } = data;

  const results = {
    customer,
    timestamp: new Date().toISOString(),
    hasTrade,
    checks: {},
  };

  await chrome.storage.local.set({
    searchStatus: "running",
    searchProgress: 0,
    currentResults: results,
  });

  const saveState = async (progress) => {
    await atomicStateUpdate(() => {
      const update = { currentResults: results };
      if (progress !== undefined) update.searchProgress = progress;
      return update;
    });
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
      await updateMdosProgress(0);
      try {
        const customerWithKey = {
          ...customer,
          screenshotStorageKey: "repeatOffenderScreenshot",
        };
        await updateMdosProgress(0.2);
        const roResult = await handleRepeatOffenderCheck(customerWithKey);
        await updateMdosProgress(0.8);

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
        try {
          const coBuyerWithKey = {
            ...customer.coBuyer,
            screenshotStorageKey: "coBuyerRepeatOffenderScreenshot",
          };
          await updateMdosProgress(0.2);
          const cbRoResult = await handleRepeatOffenderCheck(coBuyerWithKey);
          await updateMdosProgress(0.8);

          if (cbRoResult.success) {
            const checkRes = cbRoResult.result;
            checkRes.passed = checkRes.status === "eligible";
            const cbStorage = await chrome.storage.local.get(
              "coBuyerRepeatOffenderScreenshot"
            );
            if (cbStorage.coBuyerRepeatOffenderScreenshot) {
              checkRes.screenshotData = cbStorage.coBuyerRepeatOffenderScreenshot;
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
        try {
          await updateMdosProgress(0.2);
          const titleResult = await handleTitleCheck({
            vin: customer.tradeVin,
          });
          await updateMdosProgress(0.8);

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
      searchStatus: "complete",
      searchProgress: 100,
      currentResults: results,
    });
    return { success: true };
  } catch (err) {
    console.error("Run-all error:", err);
    await chrome.storage.local.set({
      searchStatus: "error",
      lastError: err.message,
    });
    return { success: false, error: err.message };
  }
}
