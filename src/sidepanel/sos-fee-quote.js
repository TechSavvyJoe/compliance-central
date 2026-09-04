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
import { printBaseCSS } from "../../lib/print-html.js";
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
  return (
    String(value || "")
      .replace(LABELED_VIN_PATTERN, "")
      .replace(VIN_PATTERN, "")
      .replace(/\bVIN\s*[:#-]?\s*/gi, "")
      // Removing the VIN leaves whatever joined it to the rest of the
      // description behind. "2026 Ford F-150 · VIN 1FT..." printed on the
      // customer worksheet as "2026 Ford F-150 ·", and a parenthesised VIN
      // left an empty "()". Drop separators and brackets that now enclose
      // nothing, then trim the full separator set rather than only :|- .
      .replace(/[([{]\s*[)\]}]/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s:|,;·•—–-]+|[\s:|,;·•—–-]+$/g, "")
      .slice(0, 120)
  );
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

/**
 * The line under the headline total. It used to repeat the source, the amount
 * and the term that are already set in large type directly above it, then
 * finish with a raw toLocaleString() — seconds and all. It now carries only
 * what is not already on screen: which registration this was, which vehicle,
 * and when it was run. The time of day is enough for a quote calculated today;
 * an older one keeps its date so nobody quotes a stale fee to a customer.
 */
export function quoteStatusText(quote) {
  if (!quote) {
    return "No fee calculated yet.";
  }
  const at = new Date(quote.calculatedAt);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = at.toDateString() === new Date().toDateString();
  const when = sameDay
    ? time
    : `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
  return `${modeLabel(quote.mode)}${
    quote.vehicleDescription ? ` · ${quote.vehicleDescription}` : ""
  } · calculated ${when}`;
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
/**
 * Michigan's motor-vehicle trade-in sales-tax credit is not a fixed number.
 * Under PA 159/160 of 2018 the cap rises by $1,000 every year and is scheduled
 * to be removed entirely from 2029, so "$12,000 for 2026" — which was correct
 * when it was written — becomes wrong on the first of January and stays wrong.
 * This is a reference figure on a worksheet a dealer may hand a customer, so it
 * follows the schedule instead of freezing one year into the page.
 *
 * Past the scheduled removal it stops asserting a number at all: tax law can
 * change, and a worksheet should not invent a cap it cannot know.
 */
export function tradeInCreditPhrase(now = new Date()) {
  const year = now.getFullYear();
  if (year >= 2029) {
    return "the Michigan trade-in credit (the cap was scheduled to end in 2029 — confirm the current limit)";
  }
  const cap = 12000 + (year - 2026) * 1000;
  return `the Michigan trade-in credit (up to $${cap.toLocaleString("en-US")} for ${year})`;
}

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
  // A print window renders in about:blank or an iframe, where a remote image
  // may never load before the dialog opens — which is how the plate came out
  // broken on a customer's sheet. An inlined copy is preferred when supplied.
  const plate =
    sanitizeDealerLogo(branding.plateImageUrl) ||
    sanitizePlatePreviewUrl(normalized.platePreviewUrl);
  const dealer = String(branding.dealerName || "").trim().slice(0, 80);
  const logo = sanitizeDealerLogo(branding.logoUrl);

  const officialRows = normalized.feeBreakdown
    .map(
      (row) =>
        `<tr><th>${sanitizeHTML(row.label)}</th><td></td><td class="amount">${sanitizeHTML(formatMoney(row.feeCents))}</td></tr>`
    )
    .join("");

  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8" />
  <title>Customer Registration Cost Summary</title>
  <style>${printBaseCSS()}


    /* The worksheet wears the same masthead as every compliance record: a
       navy rule with the one gold hairline, not a solid navy band. A band
       across the top of a customer sheet is a quarter-inch of toner the
       dealership pays for on every print. */
    header { display: flex; align-items: flex-end; gap: var(--s5); }
    .worksheet-logo { flex: none; max-height: 0.55in; max-width: 2.2in; object-fit: contain; }
    .head-copy { min-width: 0; flex: 1; }
    h1 { margin: 0; color: var(--navy); font-family: var(--font-display); font-size: var(--t-masthead); font-weight: 700; line-height: var(--lh-display); letter-spacing: -0.015em; }
    .sub { margin: var(--s1) 0 0; color: var(--slate); font-size: var(--t-body); }
    main { display: block; }
    /* One sheet is the whole point of a customer handoff: the headings open
       tighter than they do inside a multi-page jacket, and a fee row is a
       single line of figures rather than a paragraph, so it needs less air. */
    h2 { margin: var(--s3) 0 var(--s1); }
    th, td { padding: var(--s1) 0; line-height: 1.3; }
    tr.total th, tr.total td { padding-top: var(--s2); }
    .status {
      display: inline-block; padding: var(--s1) var(--s2); margin: 0 0 var(--s2);
      border: var(--rule) solid var(--line); border-left: var(--rule-heavy) solid var(--ok);
      border-radius: var(--radius); color: var(--ok);
      font-size: var(--t-caption); font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
    }
    .status.unverified { border-left-color: var(--gold); color: var(--navy); }
    .headline {
      display: grid; grid-template-columns: 1.05fr 1fr; gap: var(--s5);
      margin: var(--s3) 0; padding: var(--s2) var(--s4);
      border: var(--rule) solid var(--line); border-left: var(--rule-heavy) solid var(--navy);
      border-radius: var(--radius);
      break-inside: avoid; page-break-inside: avoid;
    }
    .headline span { display: block; color: var(--slate); font-size: var(--t-caption); font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
    .headline strong { display: block; margin-top: var(--s1); color: var(--navy); font-family: var(--font-display); font-size: var(--t-hero); font-weight: 700; line-height: var(--lh-display); letter-spacing: -0.015em; font-variant-numeric: tabular-nums; }
    .headline .term { margin-top: var(--s1); color: var(--ink); font-size: var(--t-lead); font-weight: 700; line-height: 1.3; }
    .plate {
      display: grid; grid-template-columns: 1.8in 1fr; align-items: center; gap: var(--s4);
      margin: var(--s3) 0; padding: var(--s2) var(--s4);
      border: var(--rule) solid var(--line); border-radius: var(--radius);
      break-inside: avoid; page-break-inside: avoid;
    }
    .plate img { width: 1.8in; height: auto; border: var(--rule) solid var(--line); border-radius: var(--radius); background: var(--paper); }
    .plate strong { display: block; color: var(--ink); font-size: var(--t-lead); }
    .plate small { display: block; margin-top: var(--s1); color: var(--slate); font-size: var(--t-body); line-height: 1.4; }
    /* The label carries the width; the amount column is only as wide as the
       longest figure, so every decimal point falls on one line down the page
       and the figures stay next to what they are for. */
    th { width: 46%; }
    .note { margin: var(--s2) 0; }
    footer { margin-top: var(--s3); padding-top: var(--s3); border-top: var(--rule) solid var(--line); color: var(--slate); font-size: var(--t-caption); line-height: 1.4; }
  </style></head><body>
  <section class="sheet">
    <header>
      ${logo ? `<img src="${sanitizeHTML(logo)}" alt="${sanitizeHTML(dealer || "Dealership")}" class="worksheet-logo" />` : ""}
      <div class="head-copy">
        <h1>Customer Registration Cost Summary</h1>
        <p class="sub">${dealer ? `${sanitizeHTML(dealer)} · ` : ""}Sales-desk worksheet · Not a Michigan SOS document</p>
      </div>
    </header>
    <div class="masthead-rule"></div>
    <div class="masthead-accent"></div>
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
        <tr><th>Registration choice</th><td>${sanitizeHTML(modeLabel(normalized.mode))}</td><td class="amount"></td></tr>
        ${normalized.vehicleDescription ? `<tr><th>Vehicle</th><td>${sanitizeHTML(normalized.vehicleDescription)}</td><td class="amount"></td></tr>` : ""}
        ${normalized.msrpCents ? `<tr><th>Vehicle base MSRP</th><td></td><td class="amount">${sanitizeHTML(formatMoney(normalized.msrpCents))}</td></tr>` : ""}
        ${officialRows}
        <tr class="total"><th>Registration / plate fee total</th><td></td><td class="amount">${sanitizeHTML(formatMoney(normalized.feeCents))}</td></tr>
      </table>

      <h2>Additional costs to expect</h2>
      <table>
        <tr><th>Title fee</th><td></td><td class="amount">$15.00</td></tr>
        <tr><th>Michigan lien recording fee</th><td></td><td class="amount">$1.00</td></tr>
        <tr class="total"><th>Total title fee</th><td></td><td class="amount">$16.00</td></tr>
        <tr><th>Instant title (if requested)</th><td colspan="2">$5.00 &mdash; expedited same-day title</td></tr>
        <tr><th>Sales tax</th><td colspan="2">6% of the taxable price &mdash; purchase price less ${sanitizeHTML(tradeInCreditPhrase())}; confirm final transaction amount</td></tr>
        <tr><th>Optional Recreation Passport</th><td colspan="2">${sanitizeHTML(passportSummary(normalized.recreationPassport))}</td></tr>
        <tr><th>Quote time</th><td colspan="2">${sanitizeHTML(calculatedAt)}</td></tr>
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
  <style>${printBaseCSS()}

    html, body { height: 100%; }
    .page { height: 9.7in; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: var(--s3); break-after: avoid; page-break-after: avoid; overflow: hidden; }
    header { position: relative; display: flex; align-items: end; justify-content: space-between; gap: var(--s5); padding-bottom: var(--s2); border-bottom: var(--rule-heavy) solid var(--navy); }
    /* The one gold accent, drawn under the masthead rule without adding a row
       to the grid that keeps the capture on a single page. */
    header::after { content: ""; position: absolute; right: 0; bottom: -3.75pt; left: 0; height: var(--rule-accent); background: var(--gold); }
    h1 { margin: 0; color: var(--navy); font-family: var(--font-display); font-size: var(--t-masthead); font-weight: 700; line-height: var(--lh-display); letter-spacing: -0.015em; }
    header p, footer { margin: 0; color: var(--slate); font-size: var(--t-caption); }
    .capture { min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; border: var(--rule) solid var(--line); background: var(--paper); }
    .capture img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
    footer { display: flex; justify-content: space-between; gap: var(--s4); }
  </style></head><body><main class="page">
    <header><div><h1>Michigan SOS Registration Fee Calculation</h1><p>Actual official state-site result page captured during the calculation</p></div><p>${sanitizeHTML(modeLabel(normalized.mode))} · ${sanitizeHTML(formatMoney(normalized.feeCents))}</p></header>
    <section class="capture"><img src="${normalized.officialPageImage}" alt="Actual Michigan SOS registration fee result page" /></section>
    <footer><span>Source: dsvsesvc.sos.state.mi.us</span><span>Captured ${sanitizeHTML(when)} · Verify before final paperwork</span></footer>
  </main></body></html>`;
}
