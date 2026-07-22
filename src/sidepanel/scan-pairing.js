/**
 * Phone→extension license-scan pairing controller.
 *
 * Opens a relay session, hands the QR URL (with the AES key in its fragment) to
 * the caller to render, polls the relay until the phone submits the encrypted
 * blob, decrypts it locally, and autofills the form. The key is generated here
 * and only ever leaves via the QR fragment — the backend sees opaque ciphertext.
 */

import { CONFIG } from "../../lib/config.js";
import { generateKeyB64, decryptPayload } from "../../lib/crypto-pair.js";
import { applyCustomerData } from "./form.js";

const RELAY_BASE = CONFIG.backend.apiBaseUrl;
const SCAN_PAGE = CONFIG.scanPairing.scanPageUrl;
const POLL_MS = CONFIG.scanPairing.pollMs;
const WINDOW_MS = CONFIG.scanPairing.windowMs;

let active = null; // { sessionId, key, timer, deadline }

function apiKey() {
  return CONFIG.backend?.defaultApiKey || "";
}

function stop() {
  if (active?.timer) clearTimeout(active.timer);
  active = null;
}

// Opens a pairing session; returns { sessionId, key, url } or throws.
async function openSession() {
  const res = await fetch(`${RELAY_BASE}/pair/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey() },
  });
  if (!res.ok) throw new Error("Could not start pairing (" + res.status + ")");
  const { sessionId } = await res.json();
  const key = generateKeyB64();
  const sep = SCAN_PAGE.includes("?") ? "&" : "?";
  const url = `${SCAN_PAGE}${sep}s=${encodeURIComponent(sessionId)}&cb=20260722-18#k=${key}`;
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
    try {
      res = await fetch(`${RELAY_BASE}/pair/${session.sessionId}`, {
        headers: { "x-api-key": apiKey() },
      });
    } catch {
      if (active === session) session.timer = setTimeout(tick, POLL_MS); // transient
      return;
    }
    if (active !== session) return; // cancelled during the fetch
    if (res.status === 200) {
      let payload;
      try {
        const { blob } = await res.json();
        payload = await decryptPayload(session.key, blob);
      } catch {
        if (active === session) {
          stop();
          onDone({ status: "error" }); // tampered/garbage blob — don't hang
        }
        return;
      }
      if (active !== session) return; // cancelled during decrypt
      stop();
      applyCustomerData(elements, { ...payload.buyer, coBuyer: payload.coBuyer });
      onDone({ status: "filled", payload });
      return;
    }
    // 204 = nothing yet; keep polling if still active.
    if (active === session) session.timer = setTimeout(tick, POLL_MS);
  };
  tick();
}

/**
 * Start a pairing. `renderQr(url)` displays the QR; `onDone({status,payload})`
 * fires on "filled" / "expired". Returns a cancel function.
 */
export async function startPairing(elements, renderQr, onDone) {
  stop();
  const { sessionId, key, url } = await openSession();
  active = { sessionId, key, timer: null, deadline: Date.now() + WINDOW_MS };
  renderQr(url);
  poll(elements, onDone);
  return stop;
}

export { stop as cancelPairing };
