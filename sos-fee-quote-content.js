/*
 * Michigan SOS calculator adapter.
 *
 * This script never reads cookies, storage, credentials, or form fields. On an
 * explicit side-panel request it returns only one uniquely labelled fee and an
 * optional VIN-stripped vehicle label. Unknown page layouts fail closed.
 */
(() => {
  const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
  const FEE_LABEL = /^(?:total\s+)?(?:registration|plate)\s+(?:fee|amount(?:\s+due)?)\s*[:-]?\s*\$?\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)\s*$/i;
  const INLINE_FEE_LABEL = /\b(?:registration|plate)\s+(?:fee|amount(?:\s+due)?)\b\s*[:-]?\s*\$?\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)\b/i;
  const VEHICLE_LABEL = /^(?:vehicle|year\s*\/\s*make\s*\/\s*model)\s*[:-]\s*(.+)$/i;

  function cents(value) {
    const normalized = String(value || "").replace(/,/g, "");
    if (!/^\d{1,5}(?:\.\d{2})?$/.test(normalized)) return null;
    const [whole, fraction = "00"] = normalized.split(".");
    const result = Number(whole) * 100 + Number(fraction);
    return Number.isInteger(result) && result > 0 && result <= 9_999_999 ? result : null;
  }

  function cleanVehicle(value) {
    return String(value || "")
      .replace(VIN_PATTERN, "")
      .replace(/\bVIN\s*[:#-]?\s*/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s:|-]+|[\s:|-]+$/g, "")
      .slice(0, 120);
  }

  function captureDisplayedQuote() {
    const lines = String(document.body?.innerText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const candidates = [];
    let vehicleDescription = "";

    for (const line of lines) {
      const direct = line.match(FEE_LABEL) || line.match(INLINE_FEE_LABEL);
      if (direct) {
        const amount = cents(direct[1]);
        if (amount != null) candidates.push(amount);
      }
      if (!vehicleDescription) {
        const vehicle = line.match(VEHICLE_LABEL);
        if (vehicle) vehicleDescription = cleanVehicle(vehicle[1]);
      }
    }

    const unique = [...new Set(candidates)];
    if (unique.length !== 1) {
      return {
        success: false,
        code: "UNVERIFIED_RESULT",
        error: "No single labelled registration or plate fee was found. Enter the confirmed fee manually instead.",
      };
    }

    return {
      success: true,
      quote: {
        feeCents: unique[0],
        vehicleDescription,
        capturedAt: new Date().toISOString(),
        calculatorUrl: location.href,
      },
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SOS_CAPTURE_FEE_QUOTE") {
      sendResponse(captureDisplayedQuote());
      return;
    }
    if (message?.type === "SOS_PRINT_CURRENT_PAGE") {
      try {
        window.print();
        sendResponse({ success: true });
      } catch {
        sendResponse({ success: false, error: "SOS could not open the browser print dialog." });
      }
    }
  });
})();
