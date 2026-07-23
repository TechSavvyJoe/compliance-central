/**
 * Phone→extension license-scan pairing controller.
 *
 * Opens a relay session, hands the QR URL (with the AES key in its fragment) to
 * the caller to render, polls the relay until the phone submits the encrypted
 * blob, decrypts it locally, and autofills the form. The key is generated here
 * and only ever leaves via the QR fragment — the backend sees opaque ciphertext.
 */

import { CONFIG } from "../../lib/config.js";
import { getApiKey } from "../../lib/api-client.js";
import { generateKeyB64, decryptPayload } from "../../lib/crypto-pair.js";
import { applyCustomerData } from "./form.js";

const RELAY_BASE = CONFIG.backend.apiBaseUrl;
const SCAN_PAGE = CONFIG.scanPairing.scanPageUrl;
const POLL_MS = CONFIG.scanPairing.pollMs;
const WINDOW_MS = CONFIG.scanPairing.windowMs;

const MAX_NAME = CONFIG.validation.nameMaxLength;
const MAX_DLN = 32;
const MAX_DOB = 10;
const MAX_VIN = CONFIG.validation.vinLength;
const PAIR_REQUEST_TIMEOUT_MS = Math.min(15_000, WINDOW_MS);
const SESSION_ID_RE = /^[a-f0-9]{32}$/;
const MICHIGAN_IIN = "636032";
const JURISDICTION_RE = /^[A-Z]{2}$/;

let pending = null; // session-creation attempt
let active = null; // { sessionId, key, timer, deadline, requestController }

function stop() {
  pending?.controller.abort();
  pending = null;
  if (active?.timer) clearTimeout(active.timer);
  active?.requestController?.abort();
  active = null;
}

function stopSession(session) {
  if (active !== session) return;
  if (session.timer) clearTimeout(session.timer);
  session.requestController?.abort();
  active = null;
}

/** Cap and coerce a scanned string field; reject non-strings. */
function clipStr(value, max) {
  if (value == null) return "";
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

function hasValidDob(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1900 &&
    year <= new Date().getUTCFullYear() &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Treat the AAMVA issuer fields as the provenance for jurisdiction. Older
// scanner payloads that only supplied `isMichigan` remain usable, but the flag
// is considered unknown and the extension takes the safe default of running
// the Michigan check rather than allowing an unverified false value to skip it.
function deriveIsMichigan(source) {
  const iin = clipStr(source?.iin, 6);
  if (/^\d{6}$/.test(iin)) return iin === MICHIGAN_IIN;

  const jurisdiction = clipStr(source?.jurisdiction, 2).toUpperCase();
  if (JURISDICTION_RE.test(jurisdiction)) return jurisdiction === "MI";
  return undefined;
}

function sanitizePerson(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  const person = {
    firstName: clipStr(source.firstName, MAX_NAME),
    middleName: clipStr(source.middleName, MAX_NAME),
    lastName: clipStr(source.lastName, MAX_NAME),
    suffix: clipStr(source.suffix, 16),
    dob: clipStr(source.dob, MAX_DOB),
    dlnPid: clipStr(source.dlnPid, MAX_DLN),
  };
  if (!person.firstName || !person.lastName || !person.dlnPid) return null;
  if (!hasValidDob(person.dob)) return null;

  const isMichigan = deriveIsMichigan(source);
  if (isMichigan !== undefined) person.isMichigan = isMichigan;
  return person;
}

/**
 * Validate decrypted scan JSON before autofill.
 * @returns {{ buyer: object, coBuyer?: object }|null}
 */
export function sanitizeScanPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const buyerSrc = payload.buyer && typeof payload.buyer === "object"
    ? payload.buyer
    : payload;
  const buyer = sanitizePerson(buyerSrc);
  if (!buyer) return null;
  if (buyerSrc.tradeVin !== undefined) {
    buyer.tradeVin = clipStr(buyerSrc.tradeVin, MAX_VIN).toUpperCase();
  }

  let coBuyer;
  if (payload.coBuyer !== undefined && payload.coBuyer !== null) {
    coBuyer = sanitizePerson(payload.coBuyer);
    // Do not silently drop an incomplete co-buyer and report a buyer-only
    // success; make the user rescan so the intended people are unambiguous.
    if (!coBuyer) return null;
    const buyerDln = buyer.dlnPid.replace(/\s+/g, "").toUpperCase();
    const coBuyerDln = coBuyer.dlnPid.replace(/\s+/g, "").toUpperCase();
    if (buyerDln === coBuyerDln) return null;
  }

  return { buyer, coBuyer };
}

/** Render the phone-pairing QR or fail before polling an unusable session. */
export function renderPairingQr(qrFactory, target, url) {
  if (typeof qrFactory !== "function") {
    throw new Error(
      "QR code generator is unavailable. Reload Compliance Central and try again."
    );
  }
  if (!target) {
    throw new Error(
      "Pairing QR display is unavailable. Reload Compliance Central and try again."
    );
  }

  const qr = qrFactory(0, "M");
  if (
    !qr ||
    typeof qr.addData !== "function" ||
    typeof qr.make !== "function" ||
    typeof qr.createImgTag !== "function"
  ) {
    throw new Error(
      "QR code generator could not start. Reload Compliance Central and try again."
    );
  }
  qr.addData(url);
  qr.make();
  const markup = qr.createImgTag(6, 8);
  if (typeof markup !== "string" || !markup.trim()) {
    throw new Error(
      "QR code generator returned an empty code. Reload Compliance Central and try again."
    );
  }
  target.innerHTML = markup;
}

// Opens a pairing session; returns { sessionId, key, url } or throws.
async function openSession(attempt) {
  const keyHeader = (await getApiKey()) || "";
  if (pending !== attempt || attempt.controller.signal.aborted) return null;

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    attempt.controller.abort();
  }, PAIR_REQUEST_TIMEOUT_MS);
  let res;
  let body = null;
  try {
    res = await fetch(`${RELAY_BASE}/pair/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": keyHeader },
      signal: attempt.controller.signal,
    });
    if (pending !== attempt) return null;
    if (attempt.controller.signal.aborted) {
      if (timedOut) throw new Error("pairing-request-timeout");
      return null;
    }
    if (!res.ok) throw new Error("Could not start pairing (" + res.status + ")");
    try {
      // Keep the same timeout and AbortController alive until the complete JSON
      // body arrives; fetch() resolving only guarantees that headers arrived.
      body = await res.json();
    } catch (error) {
      if (timedOut || attempt.controller.signal.aborted) throw error;
      body = null;
    }
  } catch (error) {
    if (timedOut) {
      throw new Error("Pairing service timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (timedOut) {
    throw new Error("Pairing service timed out. Please try again.");
  }
  if (pending !== attempt || attempt.controller.signal.aborted) return null;
  const sessionId = body?.sessionId;
  if (!SESSION_ID_RE.test(sessionId || "")) {
    throw new Error("Pairing service returned an invalid session.");
  }
  const key = generateKeyB64();
  const sep = SCAN_PAGE.includes("?") ? "&" : "?";
  // Both pairing capabilities live in the fragment, which browsers do not
  // send in HTTP requests or server logs.
  const fragment = new URLSearchParams({ s: sessionId, k: key });
  const url = `${SCAN_PAGE}${sep}cb=20260722-23#${fragment.toString()}`;
  return { sessionId, key, url };
}

// Polls until the phone submits, the window expires, or it's cancelled.
// Captures the session this loop belongs to and re-checks `active === session`
// after every await, so a cancel / a newly-started pairing during an in-flight
// fetch or decrypt can't autofill into a closed/superseded modal (TOCTOU).
function poll(elements, onDone) {
  const session = active;
  const tick = async () => {
    if (active !== session) return; // cancelled or superseded
    if (Date.now() > session.deadline) {
      stop();
      onDone({ status: "expired" });
      return;
    }
    let res;
    let responseBody;
    let readingBody = false;
    let requestTimedOut = false;
    try {
      const keyHeader = (await getApiKey()) || "";
      if (active !== session) return;
      const controller = new AbortController();
      session.requestController = controller;
      const timeout = setTimeout(() => {
        requestTimedOut = true;
        controller.abort();
      }, PAIR_REQUEST_TIMEOUT_MS);
      try {
        res = await fetch(
          `${RELAY_BASE}/pair/${encodeURIComponent(session.sessionId)}`,
          {
            headers: { "x-api-key": keyHeader },
            signal: controller.signal,
          }
        );
        if (active !== session) return;
        if (res.status === 200) {
          // Keep cancellation and the request deadline active while consuming
          // the body. A response can deliver headers and then stall indefinitely.
          readingBody = true;
          responseBody = await res.json();
          readingBody = false;
        }
      } finally {
        clearTimeout(timeout);
        if (session.requestController === controller) {
          session.requestController = null;
        }
      }
    } catch {
      if (active !== session) return;
      if (readingBody && !requestTimedOut) {
        stopSession(session);
        onDone({ status: "error" }); // malformed response body
      } else {
        session.timer = setTimeout(tick, POLL_MS); // transient network/timeout
      }
      return;
    }
    if (active !== session) return; // cancelled during the fetch
    if (res.status === 200) {
      let payload;
      try {
        const { blob } = responseBody;
        payload = await decryptPayload(session.key, blob);
      } catch {
        if (active === session) {
          stop();
          onDone({ status: "error" }); // tampered/garbage blob — don't hang
        }
        return;
      }
      if (active !== session) return; // cancelled during decrypt
      const sanitized = sanitizeScanPayload(payload);
      if (!sanitized) {
        stop();
        onDone({ status: "error" });
        return;
      }
      stop();
      applyCustomerData(elements, {
        ...sanitized.buyer,
        coBuyer: sanitized.coBuyer,
      });
      onDone({ status: "filled", payload: sanitized });
      return;
    }
    // 204 = nothing yet; server errors/timeouts are transient. Authentication
    // and other 4xx responses cannot recover within this pairing, so surface an
    // error immediately instead of leaving the user waiting for two minutes.
    if (res.status === 204 || res.status === 429 || res.status >= 500) {
      if (active === session) session.timer = setTimeout(tick, POLL_MS);
      return;
    }
    if (active === session) {
      stopSession(session);
      onDone({ status: "error" });
    }
  };
  tick();
}

/**
 * Start a pairing. `renderQr(url)` displays the QR; `onDone({status,payload})`
 * fires on "filled" / "expired". Returns a cancel function.
 */
export async function startPairing(elements, renderQr, onDone) {
  stop();
  const attempt = { controller: new AbortController() };
  pending = attempt;
  let opened;
  try {
    opened = await openSession(attempt);
  } catch (error) {
    // A caller-driven cancellation clears/replaces `pending`; a request timeout
    // leaves this attempt current and should be shown to the user.
    if (pending !== attempt) return () => {};
    pending = null;
    throw error;
  }
  if (!opened || pending !== attempt || attempt.controller.signal.aborted) {
    return () => {};
  }

  pending = null;
  const session = {
    ...opened,
    timer: null,
    requestController: null,
    deadline: Date.now() + WINDOW_MS,
  };
  active = session;
  try {
    renderQr(opened.url);
    poll(elements, onDone);
    // The returned function only owns this session. A delayed close handler
    // from an older modal must never cancel a newer pairing.
    return () => stopSession(session);
  } catch (error) {
    stopSession(session);
    throw error;
  }
}

export { stop as cancelPairing };
