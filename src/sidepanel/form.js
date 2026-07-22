/**
 * Form data collection, validation, and session caching.
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { getDateInputValue, setDateInputValue } from "./date-picker.js";
import { showToast } from "./toast.js";

const VALIDATED_FIELD_IDS = [
  "firstName",
  "middleName",
  "lastName",
  "dob",
  "dlnPid",
  "tradeVin",
  "cbFirstName",
  "cbMiddleName",
  "cbLastName",
  "cbDob",
  "cbDlnPid",
];
const feedbackListeners = new WeakSet();

function clearFieldFeedback(field) {
  if (!field) return;
  field.removeAttribute("aria-invalid");
  const errorId = `${field.id}Error`;
  const describedBy = (field.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((id) => id !== errorId);
  if (describedBy.length) {
    field.setAttribute("aria-describedby", describedBy.join(" "));
  } else {
    field.removeAttribute("aria-describedby");
  }
  document.getElementById(errorId)?.remove();
}

export function clearValidationFeedback() {
  if (typeof document === "undefined") return;
  for (const id of VALIDATED_FIELD_IDS) {
    clearFieldFeedback(document.getElementById(id));
  }
}

function revealField(field) {
  const inputPanel = field.closest("#inputPanel");
  if (inputPanel?.classList.contains("hidden")) {
    inputPanel.classList.remove("hidden");
    const summary = document.getElementById("inputSummaryBar");
    summary?.setAttribute("aria-expanded", "true");
    summary?.querySelector(".section-toggle")?.classList.add("rotated");
    const action = document.getElementById("inputSummaryAction");
    if (action) action.textContent = "Hide";
  }

  const tradeContent = field.closest("#tradeSectionContent");
  if (tradeContent?.classList.contains("collapsed")) {
    tradeContent.classList.remove("collapsed");
    const header = document.getElementById("tradeSectionHeader");
    header?.setAttribute("aria-expanded", "true");
    header?.querySelector(".section-toggle")?.classList.add("rotated");
  }
  field.closest(".cobuyer-section")?.classList.remove("hidden");
}

function renderValidationFeedback(issues) {
  if (typeof document === "undefined") return;
  clearValidationFeedback();

  let firstField = null;
  for (const issue of issues) {
    const field = document.getElementById(issue.fieldId);
    if (!field || document.getElementById(`${issue.fieldId}Error`)) continue;

    field.setAttribute("aria-invalid", "true");
    const error = document.createElement("small");
    error.id = `${issue.fieldId}Error`;
    error.className = "field-error";
    error.textContent = issue.error;
    field.closest(".form-group")?.appendChild(error);

    const describedBy = new Set(
      (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)
    );
    describedBy.add(error.id);
    field.setAttribute("aria-describedby", Array.from(describedBy).join(" "));

    if (!feedbackListeners.has(field)) {
      const clear = () => clearFieldFeedback(field);
      field.addEventListener("input", clear);
      field.addEventListener("change", clear);
      feedbackListeners.add(field);
    }
    // Reveal every section containing an error. Focusing only the first error
    // must not leave later Trade-In or co-buyer feedback hidden.
    revealField(field);
    firstField ||= field;
  }

  if (firstField) {
    firstField.focus({ preventScroll: true });
    firstField.scrollIntoView({ block: "center", behavior: "auto" });
  }
}

// Fills the form fields from a customer object (used by the phone-scan autofill;
// mirrors the cache-restore logic). DLN spaces are stripped so the value passes
// dlnPattern (Michigan DLs encode the number with spaces, e.g. "U 123 ...").
export function applyCustomerData(elements, data) {
  clearValidationFeedback();
  const dln = (v) => (v || "").replace(/\s+/g, "");
  elements.firstName.value = data.firstName || "";
  if (elements.middleName) elements.middleName.value = data.middleName || "";
  elements.lastName.value = data.lastName || "";
  if (elements.suffix) elements.suffix.value = data.suffix || "";
  setDateInputValue(elements.dob, data.dob || "");
  elements.dlnPid.value = dln(data.dlnPid);
  if (data.tradeVin !== undefined) elements.tradeVin.value = data.tradeVin || "";

  if (data.coBuyer && elements.hasCoBuyer) {
    elements.hasCoBuyer.checked = true;
    elements.hasCoBuyer.dispatchEvent(new Event("change")); // unhide the section
    const co = data.coBuyer;
    if (elements.cbFirstName) elements.cbFirstName.value = co.firstName || "";
    if (elements.cbMiddleName) elements.cbMiddleName.value = co.middleName || "";
    if (elements.cbLastName) elements.cbLastName.value = co.lastName || "";
    if (elements.cbSuffix) elements.cbSuffix.value = co.suffix || "";
    setDateInputValue(elements.cbDob, co.dob || "");
    if (elements.cbDlnPid) elements.cbDlnPid.value = dln(co.dlnPid);
  } else if (elements.hasCoBuyer) {
    // A scan must fully own the form state: if this fill has NO co-buyer, clear
    // any co-buyer left checked/filled from a prior scan — otherwise a stale,
    // different person would be screened.
    elements.hasCoBuyer.checked = false;
    elements.hasCoBuyer.dispatchEvent(new Event("change")); // hide the section
    if (elements.cbFirstName) elements.cbFirstName.value = "";
    if (elements.cbMiddleName) elements.cbMiddleName.value = "";
    if (elements.cbLastName) elements.cbLastName.value = "";
    if (elements.cbSuffix) elements.cbSuffix.value = "";
    setDateInputValue(elements.cbDob, "");
    if (elements.cbDlnPid) elements.cbDlnPid.value = "";
  }
}

export function getFormData(elements) {
  const hasCoBuyer = elements.hasCoBuyer?.checked || false;

  const data = {
    firstName: elements.firstName.value.trim(),
    middleName: elements.middleName?.value.trim() || "",
    lastName: elements.lastName.value.trim(),
    suffix: elements.suffix?.value || "",
    dob: getDateInputValue(elements.dob),
    dlnPid: elements.dlnPid.value.trim(),
    tradeVin: elements.tradeVin.value.trim().toUpperCase(),
    hasCoBuyer,
  };

  if (hasCoBuyer) {
    data.coBuyer = {
      firstName: elements.cbFirstName?.value.trim() || "",
      middleName: elements.cbMiddleName?.value.trim() || "",
      lastName: elements.cbLastName?.value.trim() || "",
      suffix: elements.cbSuffix?.value || "",
      dob: getDateInputValue(elements.cbDob),
      dlnPid: elements.cbDlnPid?.value.trim() || "",
    };
  }

  return data;
}

/**
 * Read scanner jurisdiction as a strict tri-state value. Only booleans produced
 * by the scanner are authoritative; absent or malformed cached values become
 * unknown so normal Michigan validation remains the safe default.
 */
export function extractScanJurisdiction(data) {
  const normalize = (value) =>
    typeof value === "boolean" ? value : null;
  return {
    buyer: normalize(data?.buyerIsMichigan),
    coBuyer: normalize(data?.coBuyerIsMichigan),
  };
}

export function validateField(
  fieldName,
  value,
  label,
  required = true,
  options = {}
) {
  const val = value?.trim() || "";

  if (required && !val) {
    return { valid: false, error: `${label} is required` };
  }
  if (!val) return { valid: true, error: null };

  switch (fieldName) {
    case "firstName":
    case "middleName":
    case "lastName":
      if (val.length > CONFIG.validation.nameMaxLength) {
        return {
          valid: false,
          error: `${label} must be ${CONFIG.validation.nameMaxLength} characters or less`,
        };
      }
      break;

    case "dob": {
      const isoPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
      const usPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      let year, month, day;

      if (isoPattern.test(val)) {
        const [, y, m, d] = val.match(isoPattern);
        year = parseInt(y);
        month = parseInt(m);
        day = parseInt(d);
      } else if (usPattern.test(val)) {
        const [, m, d, y] = val.match(usPattern);
        month = parseInt(m);
        day = parseInt(d);
        year = parseInt(y);
      } else {
        return { valid: false, error: `${label} must be a valid date` };
      }

      const birthDate = new Date(year, month - 1, day);
      if (
        birthDate.getFullYear() !== year ||
        birthDate.getMonth() !== month - 1 ||
        birthDate.getDate() !== day
      ) {
        return { valid: false, error: `${label} is not a valid date` };
      }

      if (birthDate.getTime() > Date.now()) {
        return { valid: false, error: `${label} cannot be in the future` };
      }

      const ageYears =
        (Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

      if (ageYears < CONFIG.validation.minAge) {
        return {
          valid: false,
          error: `Customer must be at least ${CONFIG.validation.minAge} years old`,
        };
      }
      if (ageYears > CONFIG.validation.maxAge) {
        return { valid: false, error: `Please check the Date of Birth` };
      }
      break;
    }

    case "dlnPid":
      if (options.isMichigan === false) {
        // This broader rule is only reachable for an explicitly scanned
        // non-Michigan card. Manual/unknown entry keeps the strict Michigan
        // pattern below so a caller cannot silently weaken normal validation.
        if (!/^[A-Za-z0-9]{4,32}$/.test(val)) {
          return {
            valid: false,
            error: `${label} must be 4-32 letters or numbers for an out-of-state ID`,
          };
        }
      } else if (!CONFIG.validation.dlnPattern.test(val)) {
        return {
          valid: false,
          error: `${label} must be a valid Michigan DLN (letter + 12 digits) or PID (9-12 digits)`,
        };
      }
      break;

    case "tradeVin":
      if (CONFIG.validation.vinInvalidChars.test(val)) {
        return {
          valid: false,
          error: "VIN cannot contain letters I, O, or Q",
        };
      }
      if (!CONFIG.validation.vinPattern.test(val)) {
        return {
          valid: false,
          error: `VIN must be exactly ${CONFIG.validation.vinLength} alphanumeric characters`,
        };
      }
      break;
  }

  return { valid: true, error: null };
}

export function collectCustomerValidationErrors(data) {
  const issues = [];

  const buyer = [
    { id: "firstName", name: "firstName", value: data.firstName, label: "First Name", required: true },
    { id: "middleName", name: "middleName", value: data.middleName, label: "Middle Name", required: false },
    { id: "lastName", name: "lastName", value: data.lastName, label: "Last Name", required: true },
    { id: "dob", name: "dob", value: data.dob, label: "Date of Birth", required: true },
    { id: "dlnPid", name: "dlnPid", value: data.dlnPid, label: "DLN/PID", required: true, isMichigan: data.buyerIsMichigan },
    { id: "tradeVin", name: "tradeVin", value: data.tradeVin, label: "Trade-In VIN", required: false },
  ];

  for (const f of buyer) {
    const r = validateField(f.name, f.value, f.label, f.required, {
      isMichigan: f.isMichigan,
    });
    if (!r.valid) issues.push({ fieldId: f.id, error: r.error });
  }

  if (data.hasCoBuyer && data.coBuyer) {
    const co = [
      { id: "cbFirstName", name: "firstName", value: data.coBuyer.firstName, label: "Co-Buyer First Name", required: true },
      { id: "cbMiddleName", name: "middleName", value: data.coBuyer.middleName, label: "Co-Buyer Middle Name", required: false },
      { id: "cbLastName", name: "lastName", value: data.coBuyer.lastName, label: "Co-Buyer Last Name", required: true },
      { id: "cbDob", name: "dob", value: data.coBuyer.dob, label: "Co-Buyer Date of Birth", required: true },
      { id: "cbDlnPid", name: "dlnPid", value: data.coBuyer.dlnPid, label: "Co-Buyer DLN/PID", required: true, isMichigan: data.coBuyerIsMichigan },
    ];

    for (const f of co) {
      const r = validateField(f.name, f.value, f.label, f.required, {
        isMichigan: f.isMichigan,
      });
      if (!r.valid) issues.push({ fieldId: f.id, error: r.error });
    }
  }

  return issues;
}

export function validateCustomerFields(data) {
  const issues = collectCustomerValidationErrors(data);

  if (issues.length > 0) {
    renderValidationFeedback(issues);
    showToast(
      `Review the highlighted fields:\n\n• ${issues.map((issue) => issue.error).join("\n• ")}`,
      "warning",
      8000
    );
    return false;
  }
  clearValidationFeedback();
  return true;
}

export async function cacheFormData(elements, scanContext = {}) {
  const data = getFormData(elements);
  const jurisdiction = extractScanJurisdiction(scanContext);
  data.buyerIsMichigan = jurisdiction.buyer;
  data.coBuyerIsMichigan = jurisdiction.coBuyer;
  await chrome.storage.session.set({
    [STORAGE_KEYS.cachedFormData]: data,
    [STORAGE_KEYS.cachedAt]: Date.now(),
  });
}

export async function loadCachedFormData(elements) {
  try {
    const result = await chrome.storage.session.get([
      STORAGE_KEYS.cachedFormData,
      STORAGE_KEYS.cachedAt,
    ]);
    const cached = result[STORAGE_KEYS.cachedFormData];
    const cachedAt = result[STORAGE_KEYS.cachedAt];
    if (!cached || !cachedAt) return;

    const cacheAge = Date.now() - cachedAt;
    if (cacheAge >= CONFIG.timeouts.formCacheExpiry) return;

    const data = cached;
    elements.firstName.value = data.firstName || "";
    if (elements.middleName) elements.middleName.value = data.middleName || "";
    elements.lastName.value = data.lastName || "";
    if (elements.suffix) elements.suffix.value = data.suffix || "";
    setDateInputValue(elements.dob, data.dob || "");
    elements.dlnPid.value = data.dlnPid || "";
    elements.tradeVin.value = data.tradeVin || "";

    elements.runTitleBtn.disabled = !data.tradeVin;

    // Restore co-buyer section if it was checked.
    if (data.hasCoBuyer && data.coBuyer && elements.hasCoBuyer) {
      elements.hasCoBuyer.checked = true;
      // Notify the toggle listener so the section unhides.
      elements.hasCoBuyer.dispatchEvent(new Event("change"));

      const co = data.coBuyer;
      if (elements.cbFirstName) elements.cbFirstName.value = co.firstName || "";
      if (elements.cbMiddleName) elements.cbMiddleName.value = co.middleName || "";
      if (elements.cbLastName) elements.cbLastName.value = co.lastName || "";
      if (elements.cbSuffix) elements.cbSuffix.value = co.suffix || "";
      setDateInputValue(elements.cbDob, co.dob || "");
      if (elements.cbDlnPid) elements.cbDlnPid.value = co.dlnPid || "";
    }
    return data;
  } catch (error) {
    console.error("Error loading cached form data:", error);
    return null;
  }
}
