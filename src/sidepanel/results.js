/**
 * Renders results into the existing DOM cards plus the progress UI.
 */

import { sanitizeHTML } from "./dom-utils.js";
import { ICONS } from "./icons.js";
import { calculateFinalDecision } from "./checks.js";

const STATUS_MAP = {
  waiting: { icon: ICONS.hourglass, label: "Waiting", cls: "status-waiting" },
  running: { icon: ICONS.hourglass, label: "Running", cls: "status-running" },
  pass: { icon: ICONS.check, label: "Pass", cls: "status-pass" },
  fail: { icon: ICONS.x, label: "Failed", cls: "status-fail" },
  warning: { icon: ICONS.alertTriangle, label: "Review", cls: "status-warning" },
  skipped: { icon: ICONS.skip, label: "Skipped", cls: "status-skipped" },
};

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
  if (!results.finalDecision) {
    results.finalDecision = calculateFinalDecision(results.checks);
  }
  const decision = results.finalDecision;

  let badgeClass, badgeIcon, badgeText;
  if (decision.level === "APPROVED") {
    badgeClass = "decision-approved";
    badgeIcon = ICONS.shieldCheck;
    badgeText = "APPROVED";
  } else if (decision.level === "REVIEW") {
    badgeClass = "decision-review";
    badgeIcon = ICONS.alertTriangle;
    badgeText = "REVIEW REQUIRED";
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
  if (results.checks.ofac) {
    setResultStatus(
      elements.ofacResultStatus,
      results.checks.ofac.passed ? "pass" : "fail",
      results.checks.ofac.passed ? "Pass" : "Match"
    );
    elements.ofacResultDetail.textContent = results.checks.ofac.passed
      ? "No matches in SDN list"
      : `${results.checks.ofac.matches?.length || 0} potential match(es) found`;
  }

  // Buyer Repeat Offender.
  if (results.checks.repeatOffender) {
    const ro = results.checks.repeatOffender;
    if (ro.status === "error") {
      setResultStatus(elements.repeatResultStatus, "warning", "Error");
      elements.repeatResultDetail.textContent =
        ro.error || "Unknown error occurred";
    } else {
      setResultStatus(
        elements.repeatResultStatus,
        ro.passed ? "pass" : "fail",
        ro.passed ? "Pass" : "Found"
      );
      elements.repeatResultDetail.textContent = ro.passed
        ? "No offenses found"
        : ro.status;
    }
    elements.printRepeatBtn?.classList.remove("hidden");
  }

  // Title.
  if (results.checks.title) {
    const title = results.checks.title;

    if (title.error) {
      setResultStatus(elements.titleResultStatus, "warning", "Check Failed");
      elements.titleResultDetail.textContent =
        title.error || "Unable to complete Title check";
      elements.printTitleBtn?.classList.add("hidden");
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
    }
  } else {
    setResultStatus(elements.titleResultStatus, "skipped", "No Trade");
    elements.titleResultDetail.textContent = "No trade-in provided";
    elements.printTitleBtn?.classList.add("hidden");
  }

  // Co-Buyer.
  const hasCoBuyer =
    results.checks.coBuyerOfac || results.checks.coBuyerRepeatOffender;

  if (hasCoBuyer && elements.coBuyerResultsSection) {
    elements.coBuyerResultsSection.classList.remove("hidden");

    if (results.checks.coBuyerOfac) {
      const cbOfac = results.checks.coBuyerOfac;
      setResultStatus(
        elements.cbOfacResultStatus,
        cbOfac.passed ? "pass" : "fail",
        cbOfac.passed ? "Pass" : "Match"
      );
      elements.cbOfacResultDetail.textContent = cbOfac.passed
        ? "No matches in SDN list"
        : `${cbOfac.matches?.length || 0} potential match(es) found`;
    }

    if (results.checks.coBuyerRepeatOffender) {
      const cbRO = results.checks.coBuyerRepeatOffender;
      setResultStatus(
        elements.cbRepeatResultStatus,
        cbRO.passed ? "pass" : "fail",
        cbRO.passed ? "Pass" : "Found"
      );
      elements.cbRepeatResultDetail.textContent = cbRO.passed
        ? "No offenses found"
        : cbRO.status;
      elements.printCbRepeatBtn?.classList.remove("hidden");
    }
  } else if (elements.coBuyerResultsSection) {
    elements.coBuyerResultsSection.classList.add("hidden");
  }
}

export function displayIndividualResult(elements, type, result) {
  elements.resultsSection.classList.remove("hidden");

  if (type === "ofac") {
    setResultStatus(
      elements.ofacResultStatus,
      result.passed ? "pass" : "fail",
      result.passed ? "Pass" : "Match"
    );
    elements.ofacResultDetail.textContent = result.passed
      ? "No matches in SDN list"
      : `${result.matches?.length || 0} potential match(es) found`;
    elements.printOfacBtn?.classList.remove("hidden");
  } else if (type === "repeatOffender") {
    setResultStatus(
      elements.repeatResultStatus,
      result.passed ? "pass" : "fail",
      result.passed ? "Pass" : "Found"
    );
    elements.repeatResultDetail.textContent = result.passed
      ? "No offenses found"
      : result.status;
    if (result.screenshotData) {
      elements.printRepeatBtn?.classList.remove("hidden");
    }
  } else if (type === "title") {
    setResultStatus(
      elements.titleResultStatus,
      result.passed ? "pass" : "warning",
      result.passed ? "Clear" : "Review"
    );
    let detail = `Title: ${result.titleBrand}`;
    if (result.hasLien) detail += `\nLien: ${result.lienHolder || "Yes"}`;
    elements.titleResultDetail.textContent = detail;
    if (result.screenshotData) {
      elements.printTitleBtn?.classList.remove("hidden");
    }
  }
}

export function setButtonsDisabled(elements, disabled) {
  elements.runAllChecksBtn.disabled = disabled;
  elements.runOfacBtn.disabled = disabled;
  elements.runRepeatOffenderBtn.disabled = disabled;
  elements.runTitleBtn.disabled = disabled || !elements.tradeVin.value.trim();
}
