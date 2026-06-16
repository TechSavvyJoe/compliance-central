/**
 * Renders results into the existing DOM cards plus the progress UI.
 */

import { sanitizeHTML } from "./dom-utils.js";
import { ICONS } from "./icons.js";
import { calculateFinalDecision } from "./checks.js";
import { MISSING_API_KEY } from "../../lib/api-client.js";

const MISSING_KEY_DETAIL =
  "This check is temporarily unavailable — please try again in a moment.";

/** Map raw check errors to user-facing copy (e.g. the missing-key case). */
function friendlyCheckError(message, fallback) {
  if (message === MISSING_API_KEY) return MISSING_KEY_DETAIL;
  return message || fallback;
}

/**
 * Show or hide the OFAC-data freshness banner. Pass a message to show it,
 * or null/empty to hide it.
 */
export function setSdnWarning(elements, message) {
  const el = elements.sdnWarning;
  if (!el) return;
  if (!message) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<span class="icon">${ICONS.alertTriangle}</span><span>${sanitizeHTML(message)}</span>`;
  el.classList.remove("hidden");
}

const STATUS_MAP = {
  waiting: { icon: ICONS.hourglass, label: "Waiting", cls: "status-waiting" },
  running: { icon: ICONS.hourglass, label: "Running", cls: "status-running" },
  pass: { icon: ICONS.check, label: "Pass", cls: "status-pass" },
  fail: { icon: ICONS.x, label: "Failed", cls: "status-fail" },
  warning: { icon: ICONS.alertTriangle, label: "Review", cls: "status-warning" },
  skipped: { icon: ICONS.skip, label: "Skipped", cls: "status-skipped" },
};

const REPEAT_ELIGIBLE_DETAIL = "Eligible per MDOS repeat-offender response";

function renderStatus(cfg, customLabel) {
  const label = customLabel != null ? sanitizeHTML(customLabel) : sanitizeHTML(cfg.label);
  return `<span class="status-icon">${cfg.icon}</span>${label}`;
}

export function setCheckStatus(el, status) {
  if (!el) return;
  const cfg = STATUS_MAP[status] || { icon: "", label: status, cls: "" };
  el.innerHTML = renderStatus(cfg);
  el.className = "status-indicator " + cfg.cls;
}

function setResultStatus(el, statusKey, customLabel) {
  if (!el) return;
  const cfg = STATUS_MAP[statusKey] || STATUS_MAP.waiting;
  el.innerHTML = renderStatus(cfg, customLabel);
  el.className = "result-status " + cfg.cls;
}

function checkStatusKey(check, failKey = "fail") {
  if (!check) return "waiting";
  if (check.error || check.status === "error") return "warning";
  if (check.status === "not_applicable") return "skipped";
  return check.passed ? "pass" : failKey;
}

function setActionVisibility(button, visible) {
  button?.classList.toggle("hidden", !visible);
}

function prepareFullResultsView(elements) {
  elements.ofacResultCard?.classList.remove("hidden");
  elements.repeatResultCard?.classList.remove("hidden");
  elements.titleResultCard?.classList.remove("hidden");
  elements.cbOfacResultCard?.classList.remove("hidden");
  elements.cbRepeatResultCard?.classList.remove("hidden");

  for (const button of [
    elements.printOfacBtn,
    elements.downloadOfacBtn,
    elements.printRepeatBtn,
    elements.downloadRepeatBtn,
    elements.printTitleBtn,
    elements.downloadTitleBtn,
    elements.printCbOfacBtn,
    elements.downloadCbOfacBtn,
    elements.printCbRepeatBtn,
    elements.downloadCbRepeatBtn,
  ]) {
    setActionVisibility(button, false);
  }
}

function renderOfacResult(statusEl, detailEl, printBtn, downloadBtn, ofac) {
  if (!ofac) {
    setResultStatus(statusEl, "skipped", "Not Run");
    if (detailEl) detailEl.textContent = "OFAC screening has not run";
    setActionVisibility(printBtn, false);
    setActionVisibility(downloadBtn, false);
    return;
  }

  if (ofac.error || ofac.status === "error") {
    setResultStatus(statusEl, "warning", "Error");
    if (detailEl) {
      detailEl.textContent = ofac.error || "OFAC screening could not be completed";
    }
    setActionVisibility(printBtn, false);
    setActionVisibility(downloadBtn, false);
    return;
  }

  // A stale screen (the SDN list could not be refreshed before screening) is a
  // weaker "Pass" — flag it on the row so a clean result isn't taken at face
  // value when the data might be out of date.
  setResultStatus(
    statusEl,
    ofac.passed ? (ofac.stale ? "warning" : "pass") : "fail",
    ofac.passed ? (ofac.stale ? "Pass (stale data)" : "Pass") : "Match"
  );
  if (detailEl) {
    let txt = ofac.passed
      ? "No matches in SDN list"
      : `${ofac.matches?.length || 0} potential match(es) found`;
    if (ofac.stale) {
      const age = ofac.dataAgeHours != null ? ` (~${ofac.dataAgeHours}h old)` : "";
      txt += ` — screened against a cached SDN list${age}; could not refresh. Re-run when online.`;
    }
    detailEl.textContent = txt;
  }
  setActionVisibility(printBtn, true);
  setActionVisibility(downloadBtn, true);
}

function repeatOffenderDetail(result) {
  if (result?.passed) return REPEAT_ELIGIBLE_DETAIL;
  return result?.message || result?.status || "Review MDOS repeat-offender response";
}

function showPartialNotice(elements, label) {
  if (!elements.finalDecision) return;
  elements.finalDecision.innerHTML = `
    <div class="decision-badge decision-review">
      <span class="decision-icon">${ICONS.alertTriangle}</span>
      PARTIAL CHECK
    </div>
    <p class="decision-text">${sanitizeHTML(label)} completed. Print or download this result for your records.</p>
  `;
}

function hideAllResultCards(elements) {
  for (const card of [
    elements.ofacResultCard,
    elements.repeatResultCard,
    elements.titleResultCard,
    elements.cbOfacResultCard,
    elements.cbRepeatResultCard,
  ]) {
    card?.classList.add("hidden");
  }
  elements.coBuyerResultsSection?.classList.add("hidden");
  for (const button of [
    elements.printOfacBtn,
    elements.downloadOfacBtn,
    elements.printRepeatBtn,
    elements.downloadRepeatBtn,
    elements.printTitleBtn,
    elements.downloadTitleBtn,
    elements.printCbOfacBtn,
    elements.downloadCbOfacBtn,
    elements.printCbRepeatBtn,
    elements.downloadCbRepeatBtn,
  ]) {
    setActionVisibility(button, false);
  }
}

/**
 * Toggle skeleton-loading appearance on the three result cards.
 * Used during a Run All Checks in-flight so the UI feels predictive.
 */
export function setCardsLoadingState(elements, isLoading) {
  for (const card of [
    elements.ofacResultCard,
    elements.repeatResultCard,
    elements.titleResultCard,
    elements.cbOfacResultCard,
    elements.cbRepeatResultCard,
  ]) {
    if (!card) continue;
    card.classList.toggle("is-loading", isLoading);
  }
}

let currentProgress = 0;
let targetProgress = 0;
let progressAnimationId = null;

export function resetProgress(elements) {
  currentProgress = 0;
  targetProgress = 0;
  if (progressAnimationId) {
    cancelAnimationFrame(progressAnimationId);
    progressAnimationId = null;
  }
  if (elements.progressFill) elements.progressFill.style.width = "0%";
  if (elements.progressPercent) elements.progressPercent.textContent = "0%";

  setCheckStatus(elements.ofacStatus, "waiting");
  setCheckStatus(elements.repeatStatus, "waiting");
  setCheckStatus(elements.titleStatus, "waiting");
}

export function updateProgress(elements, percent, label) {
  targetProgress = percent;
  if (label && elements.progressLabel) {
    elements.progressLabel.textContent = label;
  }
  if (!progressAnimationId) {
    animateProgress(elements);
  }
}

function animateProgress(elements) {
  if (currentProgress < targetProgress) {
    const delta = targetProgress - currentProgress;
    const step = Math.max(0.1, delta * 0.05);
    currentProgress = Math.min(targetProgress, currentProgress + step);
  } else if (currentProgress > targetProgress) {
    currentProgress = targetProgress;
  }

  const displayPercent = Math.round(currentProgress * 10) / 10;
  if (elements.progressFill) {
    elements.progressFill.style.width = displayPercent + "%";
  }
  if (elements.progressPercent) {
    elements.progressPercent.textContent = Math.round(displayPercent) + "%";
  }

  if (elements.progressLabel && !elements.progressLabel.dataset.locked) {
    if (displayPercent < 20) {
      elements.progressLabel.textContent = "Running OFAC check...";
    } else if (displayPercent < 50) {
      elements.progressLabel.textContent = "Checking Repeat Offender...";
    } else if (displayPercent < 90) {
      elements.progressLabel.textContent = "Verifying Title & Lien...";
    } else if (displayPercent < 100) {
      elements.progressLabel.textContent = "Finalizing report...";
    } else {
      elements.progressLabel.textContent = "Complete";
    }
  }

  // At target: stop the rAF loop until updateProgress sets a new target.
  if (Math.abs(currentProgress - targetProgress) < 0.1) {
    currentProgress = targetProgress;
    progressAnimationId = null;
    if (targetProgress >= 100 && elements.progressSpinner) {
      setTimeout(() => {
        elements.progressSpinner.style.display = "none";
      }, 400);
    }
    return;
  }

  // Still animating toward target.
  if (elements.progressSpinner) {
    elements.progressSpinner.style.display = "inline-block";
  }
  progressAnimationId = requestAnimationFrame(() => animateProgress(elements));
}

export function displayResults(elements, results) {
  prepareFullResultsView(elements);
  if (!results.finalDecision) {
    results.finalDecision = calculateFinalDecision(results.checks);
  }
  const decision = results.finalDecision;

  let badgeClass, badgeIcon, badgeText;
  if (decision.level === "APPROVED") {
    badgeClass = "decision-approved";
    badgeIcon = ICONS.shieldCheck;
    badgeText = "APPROVED";
  } else if (decision.level === "REVIEW" || decision.level === "PARTIAL") {
    badgeClass = "decision-review";
    badgeIcon = ICONS.alertTriangle;
    badgeText = decision.level === "PARTIAL" ? "PARTIAL CHECK" : "REVIEW REQUIRED";
  } else {
    badgeClass = "decision-denied";
    badgeIcon = ICONS.x;
    badgeText = "DENIED";
  }

  elements.finalDecision.innerHTML = `
    <div class="decision-badge ${badgeClass}">
      <span class="decision-icon">${badgeIcon}</span>
      ${badgeText}
    </div>
    <p class="decision-text">${sanitizeHTML(decision.reason)}</p>
    ${
      decision.warnings?.length
        ? '<p class="decision-warnings">' +
          decision.warnings.map((w) => sanitizeHTML(w)).join("<br>") +
          "</p>"
        : ""
    }
  `;

  // Buyer OFAC.
  renderOfacResult(
    elements.ofacResultStatus,
    elements.ofacResultDetail,
    elements.printOfacBtn,
    elements.downloadOfacBtn,
    results.checks.ofac
  );

  // Buyer Repeat Offender.
  if (results.checks.repeatOffender) {
    const ro = results.checks.repeatOffender;
    if (ro.status === "not_applicable") {
      setResultStatus(elements.repeatResultStatus, "skipped", "N/A — out of state");
      elements.repeatResultDetail.textContent =
        ro.message ||
        "The Michigan Repeat Offender check applies only to Michigan license/ID holders.";
    } else if (ro.error || ro.status === "error") {
      const isKey = ro.error === MISSING_API_KEY;
      setResultStatus(elements.repeatResultStatus, "warning", isKey ? "Unavailable" : "Error");
      elements.repeatResultDetail.textContent = friendlyCheckError(
        ro.error,
        "Unknown error occurred"
      );
    } else {
      setResultStatus(
        elements.repeatResultStatus,
        checkStatusKey(ro),
        ro.passed ? "Pass" : "Found"
      );
      elements.repeatResultDetail.textContent = repeatOffenderDetail(ro);
    }
    const roPrintable =
      !ro.error && ro.status !== "error" && ro.status !== "not_applicable";
    setActionVisibility(elements.printRepeatBtn, roPrintable);
    setActionVisibility(elements.downloadRepeatBtn, roPrintable);
  } else {
    setResultStatus(elements.repeatResultStatus, "skipped", "Not Run");
    elements.repeatResultDetail.textContent = "Repeat Offender check has not run";
    setActionVisibility(elements.printRepeatBtn, false);
    setActionVisibility(elements.downloadRepeatBtn, false);
  }

  // Title.
  if (results.checks.title) {
    const title = results.checks.title;

    if (title.error) {
      const isKey = title.error === MISSING_API_KEY;
      setResultStatus(elements.titleResultStatus, "warning", isKey ? "Unavailable" : "Check Failed");
      elements.titleResultDetail.textContent = friendlyCheckError(
        title.error,
        "Unable to complete Title check"
      );
      elements.printTitleBtn?.classList.add("hidden");
      elements.downloadTitleBtn?.classList.add("hidden");
    } else {
      let statusKey, statusLabel;
      if (title.passed) {
        statusKey = "pass";
        statusLabel = "Clear";
      } else if (title.hasLien) {
        statusKey = "warning";
        statusLabel = "Lien";
      } else if (title.titleBrand && title.titleBrand !== "CLEAN") {
        statusKey = "warning";
        statusLabel = title.titleBrand;
      } else {
        statusKey = "pass";
        statusLabel = "Clear";
      }
      setResultStatus(elements.titleResultStatus, statusKey, statusLabel);

      const lines = [];
      if (title.year && title.make && title.model) {
        lines.push(`${title.year} ${title.make} ${title.model}`);
      }
      if (title.titleType && title.titleType !== "UNKNOWN") {
        lines.push(
          `Title: ${title.titleType}${title.titleIssued ? ` (${title.titleIssued})` : ""}`
        );
      }
      if (title.lienStatus && title.lienStatus !== "UNKNOWN") {
        lines.push(`Lien: ${title.lienStatus}`);
      }
      if (title.vehicleBrands && title.vehicleBrands.length > 0) {
        lines.push(`Brands: ${title.vehicleBrands.join(", ")}`);
      } else if (title.titleBrand === "CLEAN") {
        lines.push("No title brands");
      }

      elements.titleResultDetail.textContent =
        lines.length > 0 ? lines.join("\n") : "Title information retrieved";

      elements.printTitleBtn?.classList.remove("hidden");
      elements.downloadTitleBtn?.classList.remove("hidden");
    }
  } else {
    setResultStatus(elements.titleResultStatus, "skipped", "No Trade");
    elements.titleResultDetail.textContent = "No trade-in provided";
    elements.printTitleBtn?.classList.add("hidden");
    elements.downloadTitleBtn?.classList.add("hidden");
  }

  // Co-Buyer.
  const hasCoBuyer =
    results.checks.coBuyerOfac || results.checks.coBuyerRepeatOffender;

  if (hasCoBuyer && elements.coBuyerResultsSection) {
    elements.coBuyerResultsSection.classList.remove("hidden");

    renderOfacResult(
      elements.cbOfacResultStatus,
      elements.cbOfacResultDetail,
      elements.printCbOfacBtn,
      elements.downloadCbOfacBtn,
      results.checks.coBuyerOfac
    );

    if (results.checks.coBuyerRepeatOffender) {
      const cbRO = results.checks.coBuyerRepeatOffender;
      if (cbRO.status === "not_applicable") {
        setResultStatus(elements.cbRepeatResultStatus, "skipped", "N/A — out of state");
        elements.cbRepeatResultDetail.textContent =
          cbRO.message ||
          "The Michigan Repeat Offender check applies only to Michigan license/ID holders.";
      } else if (cbRO.error || cbRO.status === "error") {
        const isKey = cbRO.error === MISSING_API_KEY;
        setResultStatus(elements.cbRepeatResultStatus, "warning", isKey ? "Unavailable" : "Error");
        elements.cbRepeatResultDetail.textContent = friendlyCheckError(
          cbRO.error,
          "Unknown error occurred"
        );
      } else {
        setResultStatus(
          elements.cbRepeatResultStatus,
          checkStatusKey(cbRO),
          cbRO.passed ? "Pass" : "Found"
        );
        elements.cbRepeatResultDetail.textContent = repeatOffenderDetail(cbRO);
      }
      const cbPrintable =
        !cbRO.error && cbRO.status !== "error" && cbRO.status !== "not_applicable";
      setActionVisibility(elements.printCbRepeatBtn, cbPrintable);
      setActionVisibility(elements.downloadCbRepeatBtn, cbPrintable);
    } else {
      setResultStatus(elements.cbRepeatResultStatus, "skipped", "Not Run");
      elements.cbRepeatResultDetail.textContent =
        "Co-Buyer Repeat Offender check has not run";
      setActionVisibility(elements.printCbRepeatBtn, false);
      setActionVisibility(elements.downloadCbRepeatBtn, false);
    }
  } else if (elements.coBuyerResultsSection) {
    elements.coBuyerResultsSection.classList.add("hidden");
  }
}

export function displayIndividualResult(elements, type, result) {
  hideAllResultCards(elements);
  elements.resultsSection.classList.remove("hidden");
  showPartialNotice(elements, {
    ofac: "OFAC Only",
    repeatOffender: "Repeat Offender",
    title: "Title/Lien",
  }[type] || "Individual Check");

  if (type === "ofac") {
    elements.ofacResultCard?.classList.remove("hidden");
    renderOfacResult(
      elements.ofacResultStatus,
      elements.ofacResultDetail,
      elements.printOfacBtn,
      elements.downloadOfacBtn,
      result
    );
  } else if (type === "repeatOffender") {
    elements.repeatResultCard?.classList.remove("hidden");
    if (result.error || result.status === "error") {
      const isKey = result.error === MISSING_API_KEY;
      setResultStatus(elements.repeatResultStatus, "warning", isKey ? "Unavailable" : "Error");
      elements.repeatResultDetail.textContent = friendlyCheckError(
        result.error,
        "Repeat Offender check could not be completed"
      );
    } else {
      setResultStatus(
        elements.repeatResultStatus,
        checkStatusKey(result),
        result.passed ? "Pass" : "Found"
      );
      elements.repeatResultDetail.textContent = repeatOffenderDetail(result);
    }
    setActionVisibility(elements.printRepeatBtn, !result.error && result.status !== "error");
    setActionVisibility(elements.downloadRepeatBtn, !result.error && result.status !== "error");
  } else if (type === "title") {
    elements.titleResultCard?.classList.remove("hidden");
    if (result.error) {
      const isKey = result.error === MISSING_API_KEY;
      setResultStatus(elements.titleResultStatus, "warning", isKey ? "Unavailable" : "Check Failed");
      elements.titleResultDetail.textContent = friendlyCheckError(
        result.error,
        "Unable to complete Title check"
      );
    } else {
      setResultStatus(
        elements.titleResultStatus,
        result.passed ? "pass" : "warning",
        result.passed ? "Clear" : "Review"
      );
      let detail = `Title: ${result.titleBrand}`;
      if (result.hasLien) detail += `\nLien: ${result.lienHolder || "Yes"}`;
      elements.titleResultDetail.textContent = detail;
    }
    setActionVisibility(elements.printTitleBtn, !result.error);
    setActionVisibility(elements.downloadTitleBtn, !result.error);
  }
}

export function setButtonsDisabled(elements, disabled) {
  elements.runAllChecksBtn.disabled = disabled;
  elements.runOfacBtn.disabled = disabled;
  elements.runRepeatOffenderBtn.disabled = disabled;
  elements.runTitleBtn.disabled = disabled || !elements.tradeVin.value.trim();
}
