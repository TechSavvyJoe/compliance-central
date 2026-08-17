/*
 * Michigan SOS public fee-calculator adapter.
 *
 * This script runs only in an extension-owned inactive SOS tab. It uses the
 * calculator's own form events and returns a bounded schema, official plate
 * preview URL, or verified total to the sidebar. It never reads cookies,
 * credentials, local/session storage, arbitrary page text, a VIN, or a
 * customer name. The worker closes the tab after the calculation.
 */
(() => {
  const MAX_FEE_CENTS = 9_999_999;
  const SETTLE_DELAY_MS = 450;
  const RESULT_TIMEOUT_MS = 10_000;
  const CALCULATION_MODE = Object.freeze({
    newPlate: "new_plate",
    plateTransfer: "plate_transfer",
  });

  function text(value) {
    return String(value?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(element) {
    if (!element || element.closest?.('[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function visibleHeadings() {
    return [...document.querySelectorAll("h1, h2, h3")]
      .filter(isVisible)
      .map(text)
      .filter(Boolean);
  }

  function calculatorMode() {
    const headings = visibleHeadings();
    const isRegistration = headings.filter((label) => /^Calculate Registration Fees$/i.test(label));
    const isTransfer = headings.filter((label) => /^Plate Transfer Fee Calculator$/i.test(label));
    if (isRegistration.length === 1 && isTransfer.length === 0) {
      return CALCULATION_MODE.newPlate;
    }
    if (isTransfer.length === 1 && isRegistration.length === 0) {
      return CALCULATION_MODE.plateTransfer;
    }
    return null;
  }

  function labelFor(element, fieldId = element?.id || element?.name || "") {
    const labelledBy = String(element?.getAttribute?.("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);
    for (const id of labelledBy) {
      const label = text(document.getElementById(id));
      if (label) return label;
    }

    const stateLabel = text(document.getElementById(`lb_${fieldId}`));
    if (stateLabel) return stateLabel;

    const linked = [...document.querySelectorAll("label")].find(
      (label) => label.htmlFor === element?.id
    );
    if (text(linked)) return text(linked);

    const legend = text(element?.closest?.("fieldset")?.querySelector?.("legend"));
    return legend || "Official SOS choice";
  }

  function sectionFor(element) {
    const headings = [...document.querySelectorAll("h2, h3")].filter(isVisible);
    let section = "Official SOS choices";
    for (const heading of headings) {
      if (heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
        section = text(heading) || section;
      }
    }
    return section;
  }

  function currentForm() {
    const forms = [...document.querySelectorAll("form")].filter(isVisible);
    return forms.at(-1) || document.querySelector("main") || document.documentElement;
  }

  function controls() {
    const root = currentForm();
    return [...root.querySelectorAll('select, input[type="text"], input[type="radio"]')].filter(
      (element) => {
        if (element.type === "radio") return isVisible(element.closest("fieldset"));
        return isVisible(element);
      }
    );
  }

  function optionList(select) {
    return [...select.options]
      .map((option) => ({ value: String(option.value || ""), label: text(option) }))
      .filter((option) => option.label || option.value);
  }

  function dynamicFields() {
    const seenRadioGroups = new Set();
    return controls()
      .map((element) => {
        if (element.tagName === "SELECT") {
          return {
            id: element.id || element.name,
            label: labelFor(element),
            section: sectionFor(element),
            kind: "select",
            value: String(element.value || ""),
            disabled: Boolean(element.disabled),
            required:
              element.required ||
              element.getAttribute("aria-required") === "true" ||
              element.classList.contains("BasicRequiredField"),
            options: optionList(element),
          };
        }

        if (element.type === "text") {
          const label = labelFor(element);
          return {
            id: element.id || element.name,
            label,
            section: sectionFor(element),
            kind: "text",
            // Never echo a plate number, VIN, or identity value back across
            // the extension message boundary. It may remain in the page DOM
            // only long enough for calculation or explicit handoff.
            value: /plate number|\bVIN\b|customer|name/i.test(label)
              ? ""
              : String(element.value || ""),
            disabled: Boolean(element.disabled || element.readOnly),
            required:
              element.required ||
              element.getAttribute("aria-required") === "true" ||
              element.classList.contains("BasicRequiredField"),
            inputMode: /MSRP|amount|price/i.test(labelFor(element)) ? "decimal" : "text",
          };
        }

        const fieldId = element.dataset.fieldId || element.name || element.id;
        if (!fieldId || seenRadioGroups.has(fieldId)) return null;
        seenRadioGroups.add(fieldId);
        const group = controls().filter(
          (item) =>
            item.type === "radio" &&
            (item.dataset.fieldId || item.name || item.id) === fieldId
        );
        if (!group.length) return null;
        const checked = group.find((item) => item.checked);
        return {
          id: fieldId,
          label: labelFor(group[0], fieldId),
          section: sectionFor(group[0]),
          kind: "radio",
          value: String(checked?.value || ""),
          disabled: group.every((item) => item.disabled),
          required: false,
          options: group.map((item) => ({
            value: String(item.value || ""),
            label: text(document.querySelector(`label[for="${item.id}"]`)) || String(item.value || ""),
          })),
        };
      })
      .filter((field) => field?.id && field.label !== "Official SOS choice");
  }

  function selectedTextByLabel(expected) {
    const field = dynamicFields().find((item) => item.label === expected);
    if (!field) return "";
    return field.options?.find((option) => option.value === field.value)?.label || "";
  }

  function textValueByLabel(expected) {
    const field = dynamicFields().find(
      (item) => item.label === expected && item.kind === "text"
    );
    return String(field?.value || "").trim();
  }

  function safeVehicleDescription(mode) {
    if (mode === CALCULATION_MODE.plateTransfer) return "Plate transfer";
    const year = textValueByLabel("Enter the vehicle model year");
    const vehicleType = selectedTextByLabel("Select your vehicle type");
    const bodyStyle = selectedTextByLabel("Select the body style");
    const use = selectedTextByLabel("Select how you will use your vehicle");
    return [
      /^\d{4}$/.test(year) ? year : "",
      vehicleType,
      bodyStyle,
      use,
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 120);
  }

  function radioValueForLabel(expression) {
    const field = dynamicFields().find(
      (item) => item.kind === "radio" && expression.test(item.label)
    );
    return field?.value || "";
  }

  function personalizedPlateSelected() {
    const value = radioValueForLabel(/personalize your plate/i);
    return value ? value === "Yes" : null;
  }

  function recreationPassportSelected() {
    const value = radioValueForLabel(/recreation passport/i);
    return value ? value === "Yes" : null;
  }

  function safePlatePreviewUrl(mode) {
    // Personalized or transfer previews could expose plate characters; do not
    // return them. The sidebar gets only a non-personalized official design.
    if (mode !== CALCULATION_MODE.newPlate || personalizedPlateSelected() !== false) {
      return null;
    }
    const urls = [...document.querySelectorAll("img")]
      .filter(isVisible)
      .map((image) => ({
        value: image.currentSrc || image.getAttribute("src") || "",
        alt: String(image.alt || ""),
      }))
      .map(({ value, alt }) => {
        try {
          const url = new URL(value, location.origin);
          const official =
            url.protocol === "https:" &&
            url.hostname === "dsvsesvc.sos.state.mi.us" &&
            url.pathname.startsWith("/TAP/Image/") &&
            !/QuestionPlate/i.test(url.pathname) &&
            /plate/i.test(alt);
          return official ? `${url.origin}${url.pathname}` : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const unique = [...new Set(urls)];
    return unique.length === 1 ? unique[0] : null;
  }

  function calculatorSnapshot() {
    const mode = calculatorMode();
    if (!mode) return null;
    return {
      calculationMode: mode,
      fields: dynamicFields(),
      platePreviewUrl: safePlatePreviewUrl(mode),
    };
  }

  function cents(value) {
    const normalized = String(value || "").replace(/[$,\s]/g, "");
    if (!/^\d{1,5}(?:\.\d{2})?$/.test(normalized)) return null;
    const [whole, fraction = "00"] = normalized.split(".");
    const result = Number(whole) * 100 + Number(fraction);
    return Number.isInteger(result) && result > 0 && result <= MAX_FEE_CENTS
      ? result
      : null;
  }

  function feeTable() {
    const candidates = [...document.querySelectorAll("table")].filter((table) => {
      const headingId = table.getAttribute("aria-labelledby");
      return (
        isVisible(table) &&
        text(headingId && document.getElementById(headingId)) === "Fees"
      );
    });
    if (candidates.length !== 1) return null;

    const rows = [...candidates[0].querySelectorAll("tbody tr")]
      .map((row) => [...row.querySelectorAll("td")].map(text))
      .filter((cells) => cells.some(Boolean));
    if (!rows.length) return null;

    // Any labelled money row counts. Keying on "fee|registration|plate" dropped
    // legitimate SOS line items that carry none of those words — "Recreation
    // Passport" is the common one — and a single unmatched row failed the whole
    // parse, so a valid calculation degraded to manual handoff. The exact-sum
    // check below remains the integrity guard: a row we misread cannot slip
    // through, because the breakdown must still reconcile to the official total.
    const breakdown = rows.map((cells) => {
      if (cells.length !== 2 || !cells[0]) {
        return null;
      }
      const feeCents = cents(cells[1]);
      return feeCents == null
        ? null
        : { label: cells[0].slice(0, 80), feeCents };
    });
    if (breakdown.some((row) => row == null) || breakdown.length > 12) return null;

    const totalCells = [...candidates[0].querySelectorAll("tfoot .TableTotalsRow td")];
    const total = cents(text(totalCells.at(-1)));
    return total != null && breakdown.reduce((sum, row) => sum + row.feeCents, 0) === total
      ? { feeCents: total, feeBreakdown: breakdown }
      : null;
  }

  function hasVisibleValidationMessage() {
    return [...document.querySelectorAll('[role="alert"], .FieldError, .FastValidationMessage, .ValidationMessage')]
      .filter(isVisible)
      .some((element) => /required|select|enter|valid|error/i.test(text(element)));
  }

  function nativeValueSetter(element) {
    if (element.tagName === "SELECT") {
      return Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    }
    return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  }

  async function settleCalculator() {
    // SOS exposes a busy overlay while a form event is being processed. A
    // modest quiet delay also handles the very fast responses where the
    // overlay is gone before this adapter observes it.
    const started = Date.now();
    let sawBusy = false;
    while (Date.now() - started < RESULT_TIMEOUT_MS) {
      const overlay = document.getElementById("FastBusyOverlay");
      const busy = overlay && getComputedStyle(overlay).visibility !== "hidden";
      sawBusy ||= Boolean(busy);
      if (!busy && (sawBusy || Date.now() - started >= SETTLE_DELAY_MS)) return;
      await pause(75);
    }
  }

  async function applyField(data) {
    const fieldId = String(data?.fieldId || "");
    const value = String(data?.value || "");
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(fieldId) || value.length > 128) {
      return { success: false, error: "The SOS calculator choice was invalid." };
    }

    const field = dynamicFields().find((item) => item.id === fieldId);
    if (!field || field.disabled) {
      return {
        success: false,
        error: "That official SOS choice is not available yet.",
        calculator: calculatorSnapshot(),
      };
    }

    if (field.kind === "radio") {
      const target = controls().find(
        (element) =>
          element.type === "radio" &&
          (element.dataset.fieldId || element.name || element.id) === fieldId &&
          element.value === value
      );
      if (!target || target.disabled) {
        return { success: false, error: "That official SOS option is unavailable." };
      }
      target.focus();
      target.click();
    } else {
      const target = controls().find(
        (element) => (element.id || element.name) === fieldId
      );
      if (
        !target ||
        target.disabled ||
        (field.kind === "select" &&
          !field.options?.some?.((option) => option.value === value))
      ) {
        return { success: false, error: "That official SOS option is unavailable." };
      }
      target.focus();
      const setter = nativeValueSetter(target);
      if (typeof setter !== "function") {
        return { success: false, error: "Michigan SOS could not apply that choice." };
      }
      setter.call(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      if (field.kind === "text") target.blur();
    }

    await settleCalculator();
    const calculator = calculatorSnapshot();
    if (!calculator) {
      return { success: false, error: "Michigan SOS did not return the calculator form." };
    }
    return { success: true, calculator };
  }

  function normalized(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function submissionField(data) {
    const expectedLabel = normalized(data?.label);
    const labelIncludes = normalized(data?.labelIncludes);
    return dynamicFields().find((candidate) => {
      const candidateLabel = normalized(candidate.label);
      return labelIncludes
        ? candidateLabel.includes(labelIncludes)
        : candidateLabel === expectedLabel;
    });
  }

  function optionForSubmission(field, data) {
    const expectedValue = String(data?.optionValue || "");
    const expectedLabel = normalized(data?.optionLabel);
    return field.options?.find((option) => {
      if (expectedValue && option.value === expectedValue) return true;
      return expectedLabel && normalized(option.label) === expectedLabel;
    });
  }

  async function applySubmissionField(data) {
    const field = submissionField(data);
    if (!field) {
      return data?.optional
        ? { success: true, skipped: true }
        : { success: false, error: `Michigan SOS no longer shows “${String(data?.label || "this field").slice(0, 80)}”.` };
    }
    if (field.disabled) {
      return { success: false, error: `Michigan SOS has not enabled “${field.label}”.` };
    }

    let value = String(data?.value || "");
    if (field.kind === "select") {
      const option = optionForSubmission(field, data);
      if (!option) {
        return { success: false, error: `The selected “${field.label}” option is not available on Michigan SOS.` };
      }
      value = option.value;
    } else if (field.kind === "radio") {
      const expected = normalized(value);
      const option = field.options?.find(
        (candidate) =>
          normalized(candidate.label) === expected || normalized(candidate.value) === expected
      );
      if (!option) {
        return { success: false, error: `Michigan SOS did not offer the expected “${field.label}” choice.` };
      }
      value = option.value;
    }

    const result = await applyField({ fieldId: field.id, value });
    return result?.success
      ? { success: true }
      : { success: false, error: result?.error || `Michigan SOS could not apply “${field.label}”.` };
  }

  async function applyAndCalculate(data) {
    const mode = calculatorMode();
    if (mode !== data?.mode || !Array.isArray(data?.fields) || !data.fields.length) {
      return { success: false, error: "Michigan SOS did not open the requested calculator." };
    }
    for (const field of data.fields) {
      const result = await applySubmissionField(field);
      if (!result.success) {
        return {
          success: false,
          keepOpen: true,
          error: result.error,
          calculator: calculatorSnapshot(),
        };
      }
    }
    return calculateFee();
  }

  function visibleCalculateButton(mode = calculatorMode()) {
    return [...document.querySelectorAll("button")]
      .filter(isVisible)
      .find((button) => {
        const label = text(button);
        const allowed =
          /^Calculate Fees$/i.test(label) ||
          (mode === CALCULATION_MODE.plateTransfer && /^Search$/i.test(label));
        return allowed && !button.disabled;
      });
  }

  async function captureOfficialResultPage() {
    if (typeof window.html2canvas !== "function") return null;
    const root = document.querySelector("main") || currentForm();
    if (!root) return null;
    try {
      const width = Math.max(root.scrollWidth, root.clientWidth, 720);
      const height = Math.max(root.scrollHeight, root.clientHeight, 480);
      const scale = Math.min(1.5, Math.sqrt(8_000_000 / (width * height)));
      const canvas = await window.html2canvas(root, {
        backgroundColor: "#ffffff",
        logging: false,
        scale: Math.max(1, scale),
        useCORS: true,
        windowWidth: width,
        windowHeight: height,
      });
      const image = canvas.toDataURL("image/jpeg", 0.9);
      return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) && image.length <= 8_000_000
        ? image
        : null;
    } catch {
      return null;
    }
  }

  async function verifiedQuoteResult(mode, fee) {
    return {
      success: true,
      quote: {
        calculationMode: mode,
        feeCents: fee.feeCents,
        feeBreakdown: fee.feeBreakdown,
        vehicleDescription: safeVehicleDescription(mode),
        platePreviewUrl: safePlatePreviewUrl(mode),
        recreationPassport: recreationPassportSelected(),
        officialPageImage: await captureOfficialResultPage(),
        calculatedAt: new Date().toISOString(),
      },
    };
  }

  async function calculateFee() {
    const mode = calculatorMode();
    const existingFee = feeTable();
    if (mode && existingFee != null) {
      return verifiedQuoteResult(mode, existingFee);
    }
    let button = visibleCalculateButton(mode);
    if (!mode || !button) {
      return {
        success: false,
        error: "Michigan SOS did not provide a ready public calculator.",
      };
    }

    const clickedButtons = new WeakSet();
    const deadline = Date.now() + RESULT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (button && !clickedButtons.has(button)) {
        clickedButtons.add(button);
        button.focus();
        button.click();
      }
      await settleCalculator();
      const fee = feeTable();
      if (fee != null) {
        return verifiedQuoteResult(mode, fee);
      }
      if (hasVisibleValidationMessage()) {
        return {
          success: false,
          keepOpen: true,
          error: "Michigan SOS needs more information before it can calculate this fee.",
          calculator: calculatorSnapshot(),
        };
      }
      // Plate transfer begins with Search. A valid lookup can either return
      // the fee immediately or reveal a second Calculate Fees action.
      button = visibleCalculateButton(mode);
      await pause(150);
    }

    return {
      success: false,
      error: "Michigan SOS did not return a verified fee result.",
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    let task = null;
    if (message?.type === "SOS_APPLY_AND_CALCULATE") {
      task = applyAndCalculate(message.data);
    } else if (message?.type === "SOS_CALCULATE_IN_TAB") {
      task = calculateFee();
    }
    if (!task) return;

    (async () => {
      try {
        sendResponse(await task);
      } catch {
        sendResponse({
          success: false,
          error: "Michigan SOS could not complete the calculator request.",
        });
      }
    })();
    return true;
  });
})();
