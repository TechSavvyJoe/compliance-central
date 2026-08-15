/**
 * Session-only title/lien lookup used by the SOS fee workspace.
 *
 * This shares the extension's existing Michigan title-check service but never
 * writes a result, screenshot, VIN, or audit record to extension storage.
 */

import { backendTitleCheck } from "../../lib/api-client.js";

const FULL_VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
let inFlight = false;

function safeTitleResult(result) {
  return {
    passed: result.passed === true,
    titleStatus: String(result.titleStatus || "UNKNOWN").slice(0, 80),
    titleBrand: String(result.titleBrand || "UNKNOWN").slice(0, 40),
    titleType: String(result.titleType || "UNKNOWN").slice(0, 80),
    lienStatus: String(result.lienStatus || "UNKNOWN").slice(0, 100),
    hasLien: result.hasLien === true,
    // A lien holder can be useful for a payoff conversation, but retain only
    // a bounded display value in live side-panel memory, never storage/logs.
    lienHolder: String(result.lienHolder || "").slice(0, 80),
    vehicleBrands: Array.isArray(result.vehicleBrands)
      ? result.vehicleBrands.map((brand) => String(brand).slice(0, 40)).slice(0, 8)
      : [],
  };
}

export async function handleSosLienCheck(data) {
  const vin = String(data?.vin || "").toUpperCase();
  if (!FULL_VIN.test(vin)) {
    return {
      success: false,
      error: "A full 17-character VIN is required for the Michigan Title/Lien check.",
    };
  }
  if (inFlight) {
    return {
      success: false,
      busy: true,
      error: "A Michigan Title/Lien check is already in progress.",
    };
  }

  inFlight = true;
  try {
    const response = await backendTitleCheck({ vin });
    if (!response?.success || !response.result) {
      return {
        success: false,
        error: response?.error || "Michigan Title/Lien did not return a verified result.",
      };
    }
    return { success: true, result: safeTitleResult(response.result) };
  } catch {
    // Do not log the backend error object: third-party error messages can
    // include request context such as the VIN.
    console.warn("[SOS fee] title/lien lookup failed");
    return {
      success: false,
      error: "Michigan Title/Lien could not be checked right now. Try again later.",
    };
  } finally {
    inFlight = false;
  }
}

export function isSosLienCheckInFlight() {
  return inFlight;
}

export const __test = { safeTitleResult };
