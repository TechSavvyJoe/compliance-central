/**
 * Form data collection, validation, and session caching.
 */

import { CONFIG } from "../../lib/config.js";
import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { getDateInputValue, setDateInputValue } from "./date-picker.js";
import { showToast } from "./toast.js";

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

export function validateField(fieldName, value, label, required = true) {
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
      if (!CONFIG.validation.dlnPattern.test(val)) {
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

export function validateCustomerFields(data) {
  const errors = [];

  const buyer = [
    { name: "firstName", value: data.firstName, label: "First Name", required: true },
    { name: "lastName", value: data.lastName, label: "Last Name", required: true },
    { name: "dob", value: data.dob, label: "Date of Birth", required: true },
    { name: "dlnPid", value: data.dlnPid, label: "DLN/PID", required: true },
    { name: "tradeVin", value: data.tradeVin, label: "Trade-In VIN", required: false },
  ];

  for (const f of buyer) {
    const r = validateField(f.name, f.value, f.label, f.required);
    if (!r.valid) errors.push(r.error);
  }

  if (data.hasCoBuyer && data.coBuyer) {
    const co = [
      { name: "firstName", value: data.coBuyer.firstName, label: "Co-Buyer First Name", required: true },
      { name: "lastName", value: data.coBuyer.lastName, label: "Co-Buyer Last Name", required: true },
      { name: "dob", value: data.coBuyer.dob, label: "Co-Buyer Date of Birth", required: true },
      { name: "dlnPid", value: data.coBuyer.dlnPid, label: "Co-Buyer DLN/PID", required: true },
    ];

    for (const f of co) {
      const r = validateField(f.name, f.value, f.label, f.required);
      if (!r.valid) errors.push(r.error);
    }
  }

  if (errors.length > 0) {
    showToast(
      `Please fix the following:\n\n• ${errors.join("\n• ")}`,
      "warning",
      8000
    );
    return false;
  }
  return true;
}

export async function cacheFormData(elements) {
  const data = getFormData(elements);
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
  } catch (error) {
    console.error("Error loading cached form data:", error);
  }
}
