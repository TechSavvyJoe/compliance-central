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
 *
 * Cancellation: Clear / stuck-timeout persist a run-ID tombstone. Every write
 * verifies that its run is still active, so a late finish cannot publish.
 */

import { handleOfacCheck } from "./ofac-check.js";
import { handleRepeatOffenderCheck, handleTitleCheck } from "./mdos-check.js";
import { atomicStateUpdate } from "./state.js";
import { createRunId, isCurrentRunState } from "../../lib/run-fence.js";
import {
  STORAGE_KEYS,
  SEARCH_STATUS,
  IN_FLIGHT,
} from "../../lib/storage-keys.js";

// Single-flight guard. The MDOS portal session is single-tenant per IP, so a
// second concurrent run would collide with the first. The sidepanel also
// disables its buttons while running; this is the worker-side backstop.
let runInFlight = false;
let currentRunId = null;
let abortedRunId = null;
let currentAbortController = null;

function hasActiveRunState(current, runId) {
  return isCurrentRunState(
    {
      activeRunId: current[STORAGE_KEYS.activeRunId],
      stateRunId: current[STORAGE_KEYS.stateRunId],
      cancelledRunId: current[STORAGE_KEYS.cancelledRunId],
    },
    runId
  );
}

export function isRunInFlight() {
  return runInFlight;
}

/**
 * Wait for all branches during normal operation, but release the run lock as
 * soon as the shared signal is cancelled. Promise.allSettled keeps observing
 * any detached work so a late rejection cannot become unhandled; each branch
 * is independently fenced from publishing after cancellation.
 */
export async function waitForSettledOrAbort(promises, signal) {
  const settled = Promise.allSettled(promises);
  if (!signal) return settled;
  if (signal.aborted) return null;

  let onAbort;
  const aborted = new Promise((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([settled, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Request abort and persist a tombstone that fences all delayed writes. */
export async function cancelCurrentRun(requestedRunId) {
  const runId = requestedRunId || currentRunId;
  const wasRunning =
    runInFlight && (!requestedRunId || requestedRunId === currentRunId);
  if (wasRunning) {
    abortedRunId = currentRunId;
    currentAbortController?.abort();
  }
  let shouldCleanRunArtifacts = !runId;

  if (runId) {
    const stored = await chrome.storage.session.get(STORAGE_KEYS.activeRunId);
    const storedRunId = stored[STORAGE_KEYS.activeRunId];
    // Never let a delayed cancel for an older run invalidate a newer run.
    const targetsCurrentMemoryRun = !currentRunId || currentRunId === runId;
    if (storedRunId === runId || (!storedRunId && targetsCurrentMemoryRun)) {
      shouldCleanRunArtifacts = true;
      await chrome.storage.session.set({
        [STORAGE_KEYS.cancelledRunId]: runId,
        [STORAGE_KEYS.activeRunId]: null,
        [STORAGE_KEYS.stateRunId]: runId,
        [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.idle,
        [STORAGE_KEYS.searchProgress]: 0,
        [STORAGE_KEYS.inFlightCheck]: null,
      });
    }
  }

  if (shouldCleanRunArtifacts) {
    await chrome.storage.session.remove([
      STORAGE_KEYS.repeatOffenderScreenshot,
      STORAGE_KEYS.coBuyerRepeatOffenderScreenshot,
      STORAGE_KEYS.titleScreenshot,
      STORAGE_KEYS.lastResult,
    ]);
    await chrome.action.setBadgeText({ text: "" });
  }
  return { success: true, cancelled: wasRunning };
}

export async function handleRunAllChecks(data, onInitialized) {
  if (runInFlight) {
    return { success: false, error: "A compliance run is already in progress." };
  }
  const runId = data.runId || createRunId();
  const abortController = new AbortController();
  runInFlight = true;
  currentRunId = runId;
  abortedRunId = null;
  currentAbortController = abortController;
  try {
    return await runAllChecks(
      data,
      runId,
      abortController.signal,
      onInitialized
    );
  } finally {
    runInFlight = false;
    if (currentRunId === runId) currentRunId = null;
    if (abortedRunId === runId) abortedRunId = null;
    if (currentAbortController === abortController) {
      currentAbortController = null;
    }
  }
}

/**
 * Start a run and acknowledge it only after the initial session state has been
 * published. The remaining work continues in the background and reports via
 * storage events, preserving the side panel's existing event-driven flow.
 */
export async function startRunAllChecks(data) {
  if (runInFlight) {
    return { success: false, error: "A compliance run is already in progress." };
  }

  let resolveStarted;
  let acknowledged = false;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  const acknowledge = (result) => {
    if (acknowledged) return;
    acknowledged = true;
    resolveStarted(result);
  };

  handleRunAllChecks(data, acknowledge).then(
    (result) => acknowledge(result),
    (err) => {
      acknowledge({
        success: false,
        error: err instanceof Error ? err.message : "Could not start checks.",
      });
      console.error("[Orchestrator] RUN_ALL_CHECKS failed:", err);
    }
  );
  return started;
}

async function runAllChecks(data, runId, signal, onInitialized) {
  const { customer, hasTrade } = data;
  const isAborted = () => abortedRunId === runId || signal.aborted;

  const results = {
    customer,
    timestamp: new Date().toISOString(),
    hasTrade,
    runType: "full",
    runLabel: "Run All Checks",
    runId,
    checks: {},
  };

  try {
    const initialPublication = await atomicStateUpdate((current) => {
      // Clear may win before this delayed message reaches a restarted worker.
      // Honor its persisted tombstone before ever republishing RUNNING.
      if (
        isAborted() ||
        current[STORAGE_KEYS.cancelledRunId] === runId
      ) {
        return {};
      }
      return {
        [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.running,
        [STORAGE_KEYS.searchProgress]: 0,
        [STORAGE_KEYS.currentResults]: results,
        [STORAGE_KEYS.inFlightCheck]: IN_FLIGHT.ofac,
        [STORAGE_KEYS.activeRunId]: runId,
        [STORAGE_KEYS.stateRunId]: runId,
      };
    });
    if (initialPublication.error) throw initialPublication.error;
    if (!initialPublication.applied) {
      onInitialized?.({
        success: false,
        cancelled: true,
        error: "Run was cancelled before it started.",
        runId,
      });
      return { success: false, cancelled: true, runId };
    }

    // A side-panel tombstone can land while the storage write is pending.
    // Re-read before acknowledging start so that delayed initialization never
    // tells the UI a cleared run is active.
    const persisted = await chrome.storage.session.get([
      STORAGE_KEYS.activeRunId,
      STORAGE_KEYS.stateRunId,
      STORAGE_KEYS.cancelledRunId,
    ]);
    if (isAborted() || !hasActiveRunState(persisted, runId)) {
      onInitialized?.({
        success: false,
        cancelled: true,
        error: "Run was cancelled before it started.",
        runId,
      });
      return { success: false, cancelled: true, runId };
    }
    onInitialized?.({ success: true, status: "started", runId });
  } catch (error) {
    onInitialized?.({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not publish the initial check state.",
    });
    throw error;
  }

  if (isAborted()) {
    return { success: false, cancelled: true, runId };
  }
  const saveState = async (progress) => {
    if (isAborted()) return;
    await atomicStateUpdate((current) => {
      if (isAborted() || !hasActiveRunState(current, runId)) return {};
      const update = {
        [STORAGE_KEYS.currentResults]: results,
        [STORAGE_KEYS.stateRunId]: runId,
      };
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
    if (isAborted()) return;
    await atomicStateUpdate((current) => {
      if (!hasActiveRunState(current, runId)) return {};
      return {
        [STORAGE_KEYS.inFlightCheck]: key,
        [STORAGE_KEYS.stateRunId]: runId,
      };
    });
  };

  try {
    const hasCoBuyer = customer.hasCoBuyer && customer.coBuyer;

    // OFAC checks (parallel).
    const ofacPromise = handleOfacCheck(customer).then(async (result) => {
      if (isAborted()) return;
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
          if (isAborted()) return;
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
        if (isAborted()) return;
        const overall = Math.round(
          mdosStart +
            completedMdos * progressPerCheck +
            checkProgress * progressPerCheck
        );
        await saveState(overall);
      };

      // 1. Buyer Repeat Offender (Michigan license/ID only).
      if (isAborted()) return;
      if (customer.buyerIsMichigan === false) {
        // Flash the in-flight indicator so the progress row still reflects the
        // check before it resolves to skipped (parity with the run path).
        await setInFlight(IN_FLIGHT.repeatOffender);
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
        if (isAborted()) return;
        try {
          const customerWithKey = {
            ...customer,
            suppressSideEffects: true,
            signal,
          };
          await updateMdosProgress(0.2);
          const roResult = await handleRepeatOffenderCheck(customerWithKey);
          if (isAborted()) return;
          await updateMdosProgress(0.8);

          if (roResult.success) {
            const checkRes = roResult.result;
            checkRes.passed = checkRes.status === "eligible";
            results.checks.repeatOffender = checkRes;
          } else {
            results.checks.repeatOffender = {
              passed: false,
              error: roResult.error,
              status: "error",
            };
          }
        } catch (e) {
          if (isAborted()) return;
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
      if (isAborted()) return;
      if (hasCoBuyer) {
        if (customer.coBuyerIsMichigan === false) {
          await setInFlight(IN_FLIGHT.coBuyerRepeatOffender);
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
          if (isAborted()) return;
          try {
            const coBuyerWithKey = {
              ...customer.coBuyer,
              suppressSideEffects: true,
              signal,
            };
            await updateMdosProgress(0.2);
            const cbRoResult = await handleRepeatOffenderCheck(coBuyerWithKey);
            if (isAborted()) return;
            await updateMdosProgress(0.8);

            if (cbRoResult.success) {
              const checkRes = cbRoResult.result;
              checkRes.passed = checkRes.status === "eligible";
              results.checks.coBuyerRepeatOffender = checkRes;
            } else {
              results.checks.coBuyerRepeatOffender = {
                passed: false,
                error: cbRoResult.error,
                status: "error",
              };
            }
          } catch (e) {
            if (isAborted()) return;
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
      if (isAborted()) return;
      if (hasTrade) {
        await setInFlight(IN_FLIGHT.title);
        if (isAborted()) return;
        try {
          await updateMdosProgress(0.2);
          const titleResult = await handleTitleCheck({
            vin: customer.tradeVin,
            suppressSideEffects: true,
            signal,
          });
          if (isAborted()) return;
          await updateMdosProgress(0.8);

          if (titleResult.success) {
            results.checks.title = titleResult.result;
          } else {
            results.checks.title = {
              passed: false,
              error: titleResult.error,
              status: "error",
              warning: true,
            };
          }
        } catch (e) {
          if (isAborted()) return;
          console.error("Title check error:", e);
          results.checks.title = {
            passed: false,
            error: e.message,
            status: "error",
            warning: true,
          };
        }
        completedMdos++;
        await updateMdosProgress(0);
      }
    })();

    // allSettled (not all): one failing branch must not wipe the others, so
    // partial results (e.g. OFAC passed but MDOS errored) still render.
    await waitForSettledOrAbort(
      [ofacPromise, coBuyerOfacPromise, mdosPromise],
      signal
    );

    if (isAborted()) {
      return { success: false, cancelled: true };
    }

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

    if (isAborted()) {
      return { success: false, cancelled: true };
    }

    const publication = await atomicStateUpdate((current) => {
      if (!hasActiveRunState(current, runId)) return {};
      return {
        [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.complete,
        [STORAGE_KEYS.searchProgress]: 100,
        [STORAGE_KEYS.currentResults]: results,
        [STORAGE_KEYS.inFlightCheck]: null,
        [STORAGE_KEYS.stateRunId]: runId,
      };
    });
    if (publication.error) throw publication.error;
    return publication.applied
      ? { success: true, runId }
      : { success: false, cancelled: true, runId };
  } catch (err) {
    if (isAborted()) {
      return { success: false, cancelled: true };
    }
    console.error("Run-all error:", err);
    await atomicStateUpdate((current) => {
      if (!hasActiveRunState(current, runId)) return {};
      return {
        [STORAGE_KEYS.searchStatus]: SEARCH_STATUS.error,
        [STORAGE_KEYS.lastError]: err.message,
        [STORAGE_KEYS.inFlightCheck]: null,
        [STORAGE_KEYS.stateRunId]: runId,
      };
    });
    return { success: false, error: err.message };
  }
}
