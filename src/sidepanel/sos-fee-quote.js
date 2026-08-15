/**
 * Session-only SOS registration fee quote helpers.
 *
 * A quote is intentionally detached from the customer/compliance record: it
 * never stores a name, VIN, SOS account detail, or page capture.
 */

import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { sanitizeHTML } from "./dom-utils.js";

export const SOS_CALCULATOR_URL = "https://dsvsesvc.sos.state.mi.us/";

export const SOS_QUOTE_MODE = Object.freeze({
  newPlate: "new_plate",
  plateTransfer: "plate_transfer",
});

export const SOS_QUOTE_SOURCE = Object.freeze({
  captured: "captured",
  manual: "manual",
});

const VALID_MODES = new Set(Object.values(SOS_QUOTE_MODE));
const VALID_SOURCES = new Set(Object.values(SOS_QUOTE_SOURCE));
const MAX_FEE_CENTS = 9_999_999;
const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;

export function modeLabel(mode) {
  return mode === SOS_QUOTE_MODE.plateTransfer ? "Plate transfer" : "New plate";
}

export function sourceLabel(source) {
  if (source === SOS_QUOTE_SOURCE.captured) return "Captured from SOS";
  if (source === SOS_QUOTE_SOURCE.manual) return "Salesperson-entered";
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

/** Do not retain a VIN even if a page's vehicle label included it. */
export function sanitizeVehicleDescription(value) {
  return String(value || "")
    .replace(VIN_PATTERN, "")
    .replace(/\bVIN\s*[:#-]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:|-]+|[\s:|-]+$/g, "")
    .slice(0, 120);
}

function sanitizedCalculatorUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !(host === "sos.state.mi.us" || host.endsWith(".sos.state.mi.us"))) {
      return null;
    }
    // Drop the query and fragment so we never retain session or search data.
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/** Validate the only values a side-panel quote is permitted to retain. */
export function normalizeSosFeeQuote(value) {
  if (!value || typeof value !== "object") return null;
  if (!VALID_MODES.has(value.mode) || !VALID_SOURCES.has(value.source)) return null;
  const feeCents = Number(value.feeCents);
  if (!Number.isInteger(feeCents) || feeCents <= 0 || feeCents > MAX_FEE_CENTS) return null;
  const capturedDate = new Date(value.capturedAt);
  if (Number.isNaN(capturedDate.getTime())) return null;
  const capturedAt = capturedDate.toISOString();
  const vehicleDescription = sanitizeVehicleDescription(value.vehicleDescription);
  return {
    mode: value.mode,
    source: value.source,
    feeCents,
    vehicleDescription,
    capturedAt,
    calculatorUrl: sanitizedCalculatorUrl(value.calculatorUrl),
  };
}

export function createCapturedQuote(capture, mode, now = new Date()) {
  return normalizeSosFeeQuote({
    mode,
    source: SOS_QUOTE_SOURCE.captured,
    feeCents: capture?.feeCents,
    vehicleDescription: capture?.vehicleDescription,
    capturedAt: capture?.capturedAt || now.toISOString(),
    calculatorUrl: capture?.calculatorUrl,
  });
}

export function createManualQuote({ mode, amount, vehicleDescription }, now = new Date()) {
  return normalizeSosFeeQuote({
    mode,
    source: SOS_QUOTE_SOURCE.manual,
    feeCents: dollarsToCents(amount),
    vehicleDescription,
    capturedAt: now.toISOString(),
    calculatorUrl: null,
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
  if (!quote) return "Not available — open SOS, calculate the fee, then capture the confirmed result.";
  const when = new Date(quote.capturedAt).toLocaleString();
  return `${sourceLabel(quote.source)}: ${formatMoney(quote.feeCents)} for ${modeLabel(quote.mode)}${
    quote.vehicleDescription ? ` · ${quote.vehicleDescription}` : ""
  } · ${when}`;
}

/** Printable customer handoff. It intentionally never implies it is an SOS document. */
export function createSosFeeQuotePrintHTML(quote) {
  const normalized = normalizeSosFeeQuote(quote);
  if (!normalized) return "";
  const capturedAt = new Date(normalized.capturedAt).toLocaleString();
  const sourceDetail =
    normalized.source === SOS_QUOTE_SOURCE.captured
      ? "The registration/plate fee shown was captured from the active Michigan SOS calculator page."
      : "The registration/plate fee was entered by a salesperson and was not captured from an SOS calculator page.";

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
      <span class="status">${sanitizeHTML(sourceLabel(normalized.source))}</span>
      <table>
        <tr><th>Registration choice</th><td>${sanitizeHTML(modeLabel(normalized.mode))}</td></tr>
        ${normalized.vehicleDescription ? `<tr><th>Vehicle</th><td>${sanitizeHTML(normalized.vehicleDescription)}</td></tr>` : ""}
        <tr><th>Registration / plate fee</th><td class="fee">${sanitizeHTML(formatMoney(normalized.feeCents))}</td></tr>
        <tr><th>Title transfer fee</th><td>$15.00</td></tr>
        <tr><th>Sales tax</th><td>6% of purchase price — confirm final transaction amount</td></tr>
        <tr><th>Optional Recreation Passport</th><td>Not included — ask if the customer would like it</td></tr>
        <tr><th>Quote captured</th><td>${sanitizeHTML(capturedAt)}</td></tr>
      </table>
      <div class="note"><strong>Verify before final paperwork.</strong> ${sanitizeHTML(sourceDetail)} Michigan SOS and dealership staff determine the final transaction amount, eligibility, documents, and any additional fees.</div>
    </main>
    <footer>Session-only worksheet. It contains no customer name, VIN, SOS credentials, or account information.</footer>
  </section></body></html>`;
}
