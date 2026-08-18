/**
 * Session-only SOS registration fee quote helpers.
 *
 * The state calculator remains the source of truth. This module accepts only
 * a narrow, customer-safe result from the extension's background adapter;
 * it never stores calculator fields, customer identity, a VIN, a plate number,
 * credentials, or a state-page capture.
 */

import { STORAGE_KEYS } from "../../lib/storage-keys.js";
import { ensureDataUrl } from "../../lib/data-url.js";
import { sanitizeHTML } from "./dom-utils.js";

export const SOS_QUOTE_MODE = Object.freeze({
  newPlate: "new_plate",
  plateTransfer: "plate_transfer",
});

// The backend drives the official calculator pages
// (dsvsesvc.sos.state.mi.us/TAP/_/?Link=RegFeeCalculator and
// ?Link=TransferFeeCalculator) and picks the page from `mode`. The extension
// no longer navigates anywhere itself, so it holds no calculator URLs.

export const SOS_QUOTE_SOURCE = Object.freeze({
  calculated: "calculated",
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

export function sourceLabel(source) {
  if (source === SOS_QUOTE_SOURCE.calculated) return "Calculated by SOS";
  return "Not available";
}

export function formatMoney(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);
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

function normalizeFeeBreakdown(value, expectedTotal) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return [];
  const rows = value
    .map((row) => ({
      label: sanitizeVehicleDescription(row?.label).slice(0, 80),
      feeCents: Number(row?.feeCents),
    }))
    .filter(
      (row) =>
        row.label &&
        Number.isInteger(row.feeCents) &&
        row.feeCents >= 0 &&
        row.feeCents <= MAX_FEE_CENTS
    );
  return rows.length === value.length &&
    rows.reduce((sum, row) => sum + row.feeCents, 0) === expectedTotal
    ? rows
    : [];
}

function normalizeOfficialPageImage(value) {
  const image = ensureDataUrl(value);
  return image && image.length <= 8_000_000 ? image : null;
}

/** Validate the only values a side-panel quote is allowed to retain. */
export function normalizeSosFeeQuote(value) {
  if (!value || typeof value !== "object") return null;
  if (!VALID_MODES.has(value.mode) || !VALID_SOURCES.has(value.source)) return null;
  const feeCents = Number(value.feeCents);
  if (!Number.isInteger(feeCents) || feeCents <= 0 || feeCents > MAX_FEE_CENTS) return null;
  const calculatedDate = new Date(value.calculatedAt);
  if (Number.isNaN(calculatedDate.getTime())) return null;

  const feeBreakdown = normalizeFeeBreakdown(value.feeBreakdown, feeCents);
  return {
    mode: value.mode,
    source: value.source,
    feeCents,
    vehicleDescription: sanitizeVehicleDescription(value.vehicleDescription),
    // The MSRP the registration fee is calculated from. It lives only in the
    // local form, so it never reached the quote and the customer sheet
    // described the vehicle without the number the fee is based on.
    msrpCents:
      Number.isInteger(value.msrpCents) &&
      value.msrpCents > 0 &&
      value.msrpCents <= 99_999_900
        ? value.msrpCents
        : null,
    calculatedAt: calculatedDate.toISOString(),
    platePreviewUrl:
      value.source === SOS_QUOTE_SOURCE.calculated
        ? sanitizePlatePreviewUrl(value.platePreviewUrl)
        : null,
    recreationPassport: normalizedPassport(value.recreationPassport),
    registrationMonths:
      Number.isInteger(value.registrationMonths) &&
      value.registrationMonths > 0 &&
      value.registrationMonths <= 24
        ? value.registrationMonths
        : null,
    expiresOn:
      typeof value.expiresOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.expiresOn)
        ? value.expiresOn
        : null,
    feeBreakdown,
    officialPageImage: normalizeOfficialPageImage(value.officialPageImage),
  };
}

/** Convert a verified background result into a session-only quote. */
export function createCalculatedQuote(result, mode, now = new Date(), local = {}) {
  if (result?.calculationMode !== mode) return null;
  return normalizeSosFeeQuote({
    mode,
    msrpCents: local.msrpCents,
    source: SOS_QUOTE_SOURCE.calculated,
    feeCents: result?.feeCents,
    vehicleDescription: result?.vehicleDescription,
    calculatedAt: result?.calculatedAt || now.toISOString(),
    platePreviewUrl: result?.platePreviewUrl,
    recreationPassport: result?.recreationPassport,
    registrationMonths: result?.registrationMonths,
    expiresOn: result?.expiresOn,
    feeBreakdown: result?.feeBreakdown,
    officialPageImage: result?.officialPageImage,
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
    return "No fee calculated yet.";
  }
  const when = new Date(quote.calculatedAt).toLocaleString();
  return `${sourceLabel(quote.source)}: ${formatMoney(quote.feeCents)} for ${modeLabel(quote.mode)}${
    quote.vehicleDescription ? ` · ${quote.vehicleDescription}` : ""
  } · ${when}`;
}

/** "8 months · expires Mar 14, 2027" — empty when the state gave neither. */
export function registrationTermText(quote) {
  const parts = [];
  if (Number.isInteger(quote?.registrationMonths)) {
    parts.push(`${quote.registrationMonths} month${quote.registrationMonths === 1 ? "" : "s"}`);
  }
  if (typeof quote?.expiresOn === "string") {
    const on = new Date(`${quote.expiresOn}T00:00:00`);
    if (!Number.isNaN(on.getTime())) {
      parts.push(
        `expires ${on.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      );
    }
  }
  return parts.join(" · ");
}

function passportSummary(value) {
  if (value === true) return "Selected — included in the SOS calculation";
  if (value === false) return "Not selected";
  return "Not available for this calculator selection";
}

/** Printable customer handoff. It intentionally never impersonates SOS. */
/**
 * Only an image we produced ourselves may be drawn on a customer's sheet.
 * Accepts a packaged extension asset or an inlined data image, and nothing
 * remote — a printed worksheet should never depend on a third-party fetch.
 */
export function sanitizeDealerLogo(value) {
  const url = String(value ?? "").trim();
  if (/^data:image\/(?:png|jpe?g|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(url)) {
    return url;
  }
  return /^chrome-extension:\/\/[a-z0-9-]+\/assets\/[\w.-]+$/i.test(url) ? url : "";
}

export function createSosFeeQuotePrintHTML(quote, branding = {}) {
  const normalized = normalizeSosFeeQuote(quote);
  if (!normalized) return "";

  const calculatedAt = new Date(normalized.calculatedAt).toLocaleString();
  const term = registrationTermText(normalized);
  const plate = sanitizePlatePreviewUrl(normalized.platePreviewUrl);
  const dealer = String(branding.dealerName || "").trim().slice(0, 80);
  const logo = sanitizeDealerLogo(branding.logoUrl);

  const officialRows = normalized.feeBreakdown
    .map(
      (row) =>
        `<tr><th>${sanitizeHTML(row.label)}</th><td>${sanitizeHTML(formatMoney(row.feeCents))}</td></tr>`
    )
    .join("");

  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8" />
  <title>Customer Registration Cost Summary</title>
  <style>
    @page { size: letter; margin: 0.5in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172033; background: #fff; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; }
    header { display: flex; align-items: center; gap: 16px; padding: 16px 26px; background: #00274c; color: #fff; }
    header img { flex: none; max-height: 52px; max-width: 210px; object-fit: contain; background: #fff; padding: 6px 9px; border-radius: 7px; }
    .head-copy { min-width: 0; }
    h1 { margin: 0; font-size: 21px; letter-spacing: -0.2px; }
    .sub { margin: 4px 0 0; color: #dbeafe; font-size: 11px; }
    main { padding: 20px 26px 8px; }
    .status { display: inline-block; padding: 5px 9px; border-radius: 999px; color: #1e3a5f; background: #e0f2fe; font-size: 11px; font-weight: 700; }
    .status.unverified { color: #78350f; background: #fef3c7; }
    .headline { display: grid; grid-template-columns: 1.05fr 1fr; gap: 14px; margin: 14px 0 4px; padding: 14px 16px; border: 1px solid #cbd5e1; border-left: 4px solid #00274c; border-radius: 10px; }
    .headline span { display: block; color: #64748b; font-size: 9.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .headline strong { display: block; margin-top: 2px; color: #00274c; font-size: 26px; font-weight: 800; }
    .headline .term { margin-top: 2px; color: #0f172a; font-size: 14px; font-weight: 700; line-height: 1.3; }
    .plate { display: grid; grid-template-columns: 248px 1fr; align-items: center; gap: 14px; margin: 12px 0 2px; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
    .plate img { width: 248px; height: auto; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; }
    .plate strong { display: block; color: #0f172a; font-size: 14px; }
    .plate small { display: block; margin-top: 3px; color: #64748b; font-size: 10.5px; line-height: 1.4; }
    h2 { margin: 16px 0 0; color: #00274c; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; }
    th, td { padding: 9px 0; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    th { width: 58%; color: #475569; font-size: 12px; font-weight: 600; }
    td { color: #0f172a; font-size: 13px; font-weight: 700; }
    tr.total th, tr.total td { border-bottom: 2px solid #00274c; }
    tr.total td { color: #00274c; font-size: 16px; }
    .note { margin: 14px 0 4px; padding: 12px 13px; border-left: 4px solid #ffcb05; background: #fffbeb; color: #4b3b09; font-size: 11px; line-height: 1.5; }
    footer { padding: 0 26px 18px; color: #64748b; font-size: 9.5px; line-height: 1.4; }
  </style></head><body>
  <section class="sheet">
    <header>
      ${logo ? `<img src="${sanitizeHTML(logo)}" alt="${sanitizeHTML(dealer || "Dealership")}" />` : ""}
      <div class="head-copy">
        <h1>Customer Registration Cost Summary</h1>
        <p class="sub">${dealer ? `${sanitizeHTML(dealer)} · ` : ""}Sales-desk worksheet · Not a Michigan SOS document</p>
      </div>
    </header>
    <main>
      <span class="status">${sanitizeHTML(sourceLabel(normalized.source))}</span>

      <div class="headline">
        <div><span>Official SOS total</span><strong>${sanitizeHTML(formatMoney(normalized.feeCents))}</strong></div>
        <div><span>Registration term</span><div class="term">${sanitizeHTML(term || "Term not stated by SOS")}</div></div>
      </div>

      ${
        plate
          ? `<div class="plate">
        <img src="${sanitizeHTML(plate)}" alt="Selected Michigan plate design" />
        <div><strong>Your plate design</strong><small>Official Michigan artwork. Sample characters shown &mdash; your plate number is assigned by the Secretary of State.</small></div>
      </div>`
          : ""
      }

      <h2>What the SOS calculated</h2>
      <table>
        <tr><th>Registration choice</th><td>${sanitizeHTML(modeLabel(normalized.mode))}</td></tr>
        ${normalized.vehicleDescription ? `<tr><th>Vehicle</th><td>${sanitizeHTML(normalized.vehicleDescription)}</td></tr>` : ""}
        ${normalized.msrpCents ? `<tr><th>Vehicle base MSRP</th><td>${sanitizeHTML(formatMoney(normalized.msrpCents))}</td></tr>` : ""}
        ${officialRows}
        <tr class="total"><th>Registration / plate fee total</th><td>${sanitizeHTML(formatMoney(normalized.feeCents))}</td></tr>
      </table>

      <h2>Additional costs to expect</h2>
      <table>
        <tr><th>Title fee</th><td>$15.00</td></tr>
        <tr><th>Michigan lien recording fee</th><td>$1.00</td></tr>
        <tr class="total"><th>Total title fee</th><td>$16.00</td></tr>
        <tr><th>Sales tax</th><td>6% of purchase price &mdash; confirm final transaction amount</td></tr>
        <tr><th>Optional Recreation Passport</th><td>${sanitizeHTML(passportSummary(normalized.recreationPassport))}</td></tr>
        <tr><th>Quote time</th><td>${sanitizeHTML(calculatedAt)}</td></tr>
      </table>

      <div class="note"><strong>Verify before final paperwork.</strong> The registration/plate fee was calculated by the public Michigan SOS calculator through the Compliance Central service. Title, lien, and tax amounts are reference figures. Michigan SOS and dealership staff determine the final transaction amount, eligibility, documents, and any additional fees.</div>
    </main>
    <footer>Session-only worksheet. It contains no customer name, VIN, plate number, SOS credentials, or account information.</footer>
  </section></body></html>`;
}

/** One-page print layout containing the actual captured official SOS result. */
export function createSosOfficialEvidencePrintHTML(quote) {
  const normalized = normalizeSosFeeQuote(quote);
  if (!normalized?.officialPageImage) return "";
  const when = new Date(normalized.calculatedAt).toLocaleString();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
  <title>Michigan SOS Registration Fee Calculation</title>
  <style>
    @page { size: letter portrait; margin: .3in; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: #fff; color: #172033; font-family: Arial, Helvetica, sans-serif; }
    .page { height: 10.4in; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 8px; break-after: avoid; page-break-after: avoid; overflow: hidden; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding-bottom: 7px; border-bottom: 3px solid #00274c; }
    h1 { margin: 0; color: #00274c; font-size: 15px; }
    header p, footer { margin: 0; color: #475569; font-size: 8px; }
    .capture { min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid #cbd5e1; background: #f8fafc; }
    .capture img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
    footer { display: flex; justify-content: space-between; gap: 12px; }
  </style></head><body><main class="page">
    <header><div><h1>Michigan SOS Registration Fee Calculation</h1><p>Actual official state-site result page captured during the calculation</p></div><p>${sanitizeHTML(modeLabel(normalized.mode))} · ${sanitizeHTML(formatMoney(normalized.feeCents))}</p></header>
    <section class="capture"><img src="${normalized.officialPageImage}" alt="Actual Michigan SOS registration fee result page" /></section>
    <footer><span>Source: dsvsesvc.sos.state.mi.us</span><span>Captured ${sanitizeHTML(when)} · Verify before final paperwork</span></footer>
  </main></body></html>`;
}
