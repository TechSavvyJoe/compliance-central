/**
 * Session-only SOS registration fee quote helpers.
 *
 * The state calculator remains the source of truth. This module accepts only
 * a narrow, customer-safe result from the extension's background-tab adapter;
 * it never stores calculator fields, customer identity, a VIN, a plate number,
 * credentials, or a state-page capture.
 */

import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { sanitizeHTML } from "./dom-utils.js";

export const SOS_QUOTE_MODE = Object.freeze({
  newPlate: "new_plate",
  plateTransfer: "plate_transfer",
});

export const SOS_CALCULATOR_URLS = Object.freeze({
  [SOS_QUOTE_MODE.newPlate]:
    "https://dsvsesvc.sos.state.mi.us/TAP/_/?Link=RegFeeCalculator",
  [SOS_QUOTE_MODE.plateTransfer]:
    "https://dsvsesvc.sos.state.mi.us/TAP/_/?Link=TransferFeeCalculator",
});

export const SOS_QUOTE_SOURCE = Object.freeze({
  calculated: "calculated",
  manual: "manual",
});

const VALID_MODES = new Set(Object.values(SOS_QUOTE_MODE));
const VALID_SOURCES = new Set(Object.values(SOS_QUOTE_SOURCE));
const MAX_FEE_CENTS = 9_999_999;
const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
const LABELED_VIN_PATTERN =
  /\bVIN\s*[:#-]?\s*[A-HJ-NPR-Z0-9*]{8,17}(?=$|[\s,;.)\]])/gi;

export function modeLabel(mode) {
  return mode === SOS_QUOTE_MODE.plateTransfer ? "Plate transfer" : "New plate";
}

export function sosCalculatorUrlForMode(mode) {
  return SOS_CALCULATOR_URLS[mode] || SOS_CALCULATOR_URLS[SOS_QUOTE_MODE.newPlate];
}

export function sourceLabel(source) {
  if (source === SOS_QUOTE_SOURCE.calculated) return "Calculated by SOS";
  if (source === SOS_QUOTE_SOURCE.manual) return "Salesperson-entered — unverified";
  return "Not available";
}

export function formatMoney(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);
}

/** Parse a dollars-and-cents value without accepting negative or malformed data. */
export function dollarsToCents(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^\$/, "")
    .replace(/,/g, "");
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_FEE_CENTS
    ? cents
    : null;
}

/** Do not retain a VIN even if an unexpected state label included one. */
export function sanitizeVehicleDescription(value) {
  return String(value || "")
    .replace(LABELED_VIN_PATTERN, "")
    .replace(VIN_PATTERN, "")
    .replace(/\bVIN\s*[:#-]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:|-]+|[\s:|-]+$/g, "")
    .slice(0, 120);
}

/** Allow only a static, official SOS plate-design image with no query data. */
export function sanitizePlatePreviewUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "dsvsesvc.sos.state.mi.us" ||
      !url.pathname.startsWith("/TAP/Image/") ||
      /QuestionPlate/i.test(url.pathname)
    ) {
      return null;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function normalizedPassport(value) {
  return value === true || value === false ? value : null;
}

/** Validate the only values a side-panel quote is allowed to retain. */
export function normalizeSosFeeQuote(value) {
  if (!value || typeof value !== "object") return null;
  if (!VALID_MODES.has(value.mode) || !VALID_SOURCES.has(value.source)) return null;
  const feeCents = Number(value.feeCents);
  if (!Number.isInteger(feeCents) || feeCents <= 0 || feeCents > MAX_FEE_CENTS) return null;
  const calculatedDate = new Date(value.calculatedAt);
  if (Number.isNaN(calculatedDate.getTime())) return null;

  return {
    mode: value.mode,
    source: value.source,
    feeCents,
    vehicleDescription: sanitizeVehicleDescription(value.vehicleDescription),
    calculatedAt: calculatedDate.toISOString(),
    platePreviewUrl:
      value.source === SOS_QUOTE_SOURCE.calculated
        ? sanitizePlatePreviewUrl(value.platePreviewUrl)
        : null,
    recreationPassport: normalizedPassport(value.recreationPassport),
  };
}

/** Convert a verified background-tab result into a session-only quote. */
export function createCalculatedQuote(result, mode, now = new Date()) {
  if (result?.calculationMode !== mode) return null;
  return normalizeSosFeeQuote({
    mode,
    source: SOS_QUOTE_SOURCE.calculated,
    feeCents: result?.feeCents,
    vehicleDescription: result?.vehicleDescription,
    calculatedAt: result?.calculatedAt || now.toISOString(),
    platePreviewUrl: result?.platePreviewUrl,
    recreationPassport: result?.recreationPassport,
  });
}

/** A deliberately unverified fallback when the official calculator is unavailable. */
export function createManualQuote({ mode, amount, vehicleDescription }, now = new Date()) {
  return normalizeSosFeeQuote({
    mode,
    source: SOS_QUOTE_SOURCE.manual,
    feeCents: dollarsToCents(amount),
    vehicleDescription,
    calculatedAt: now.toISOString(),
    platePreviewUrl: null,
    recreationPassport: null,
  });
}

export async function loadSosFeeQuote() {
  const result = await chrome.storage.session.get(STORAGE_KEYS.sosFeeQuote);
  return normalizeSosFeeQuote(result[STORAGE_KEYS.sosFeeQuote]);
}

export async function saveSosFeeQuote(quote) {
  const normalized = normalizeSosFeeQuote(quote);
  if (!normalized) throw new Error("The registration fee quote is incomplete.");
  await chrome.storage.session.set({ [STORAGE_KEYS.sosFeeQuote]: normalized });
  return normalized;
}

export async function clearSosFeeQuote() {
  await chrome.storage.session.remove(STORAGE_KEYS.sosFeeQuote);
}

export function quoteStatusText(quote) {
  if (!quote) {
    return "Choose official vehicle and plate options, then calculate the SOS fee without leaving this sidebar.";
  }
  const when = new Date(quote.calculatedAt).toLocaleString();
  return `${sourceLabel(quote.source)}: ${formatMoney(quote.feeCents)} for ${modeLabel(quote.mode)}${
    quote.vehicleDescription ? ` · ${quote.vehicleDescription}` : ""
  } · ${when}`;
}

function passportSummary(value) {
  if (value === true) return "Selected — included in the SOS calculation";
  if (value === false) return "Not selected";
  return "Not available for this calculator selection";
}

/** Printable customer handoff. It intentionally never impersonates SOS. */
export function createSosFeeQuotePrintHTML(quote) {
  const normalized = normalizeSosFeeQuote(quote);
  if (!normalized) return "";

  const calculatedAt = new Date(normalized.calculatedAt).toLocaleString();
  const sourceDetail =
    normalized.source === SOS_QUOTE_SOURCE.calculated
      ? "The registration/plate fee was calculated by the public Michigan SOS calculator in a protected background browser tab."
      : "The registration/plate fee was entered by a salesperson and was not verified by the Michigan SOS calculator.";

  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8" />
  <title>Customer Registration Cost Summary</title>
  <style>
    @page { size: letter; margin: 0.55in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172033; background: #fff; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; }
    header { padding: 24px 28px; background: #00274c; color: #fff; }
    h1 { margin: 0; font-size: 23px; letter-spacing: -0.2px; }
    .sub { margin: 5px 0 0; color: #dbeafe; font-size: 12px; }
    main { padding: 24px 28px; }
    .status { display: inline-block; padding: 6px 9px; border-radius: 999px; color: #1e3a5f; background: #e0f2fe; font-size: 12px; font-weight: 700; }
    .status.unverified { color: #78350f; background: #fef3c7; }
    table { width: 100%; border-collapse: collapse; margin: 18px 0 8px; }
    th, td { padding: 12px 0; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    th { width: 59%; color: #475569; font-size: 13px; font-weight: 600; }
    td { color: #0f172a; font-size: 14px; font-weight: 700; }
    .fee { color: #00274c; font-size: 22px; }
    .note { margin-top: 20px; padding: 14px; border-left: 4px solid #ffcb05; background: #fffbeb; color: #4b3b09; font-size: 12px; line-height: 1.5; }
    footer { padding: 0 28px 22px; color: #64748b; font-size: 10px; line-height: 1.4; }
  </style></head><body>
  <section class="sheet">
    <header><h1>Customer Registration Cost Summary</h1><p class="sub">Compliance Central sales-desk worksheet · Not a Michigan SOS document</p></header>
    <main>
      <span class="status${normalized.source === SOS_QUOTE_SOURCE.manual ? " unverified" : ""}">${sanitizeHTML(sourceLabel(normalized.source))}</span>
      <table>
        <tr><th>Registration choice</th><td>${sanitizeHTML(modeLabel(normalized.mode))}</td></tr>
        ${normalized.vehicleDescription ? `<tr><th>Vehicle</th><td>${sanitizeHTML(normalized.vehicleDescription)}</td></tr>` : ""}
        <tr><th>Registration / plate fee</th><td class="fee">${sanitizeHTML(formatMoney(normalized.feeCents))}</td></tr>
        <tr><th>Title transfer fee</th><td>$15.00 standard fee — confirm whether an expedited / instant-title fee applies</td></tr>
        <tr><th>Sales tax</th><td>6% of purchase price — confirm final transaction amount</td></tr>
        <tr><th>Optional Recreation Passport</th><td>${sanitizeHTML(passportSummary(normalized.recreationPassport))}</td></tr>
        <tr><th>Quote time</th><td>${sanitizeHTML(calculatedAt)}</td></tr>
      </table>
      <div class="note"><strong>Verify before final paperwork.</strong> ${sanitizeHTML(sourceDetail)} Michigan SOS and dealership staff determine the final transaction amount, eligibility, documents, and any additional fees.</div>
    </main>
    <footer>Session-only worksheet. It contains no customer name, VIN, plate number, SOS credentials, or account information.</footer>
  </section></body></html>`;
}
