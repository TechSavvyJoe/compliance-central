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

const RELAY_BASE = "https://compliance-central-api.fly.dev";
const SCAN_PAGE = "https://techsavvyjoe.github.io/compliance-central/scan.html";
const POLL_MS = 1500;
const WINDOW_MS = 2 * 60 * 1000;

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
  const url = `${SCAN_PAGE}?s=${encodeURIComponent(sessionId)}#k=${key}`;
  return { sessionId, key, url };
}

// Polls until the phone submits, the window expires, or it's cancelled.
function poll(elements, onDone) {
  const tick = async () => {
    if (!active) return;
    if (Date.now() > active.deadline) {
      stop();
      onDone({ status: "expired" });
      return;
    }
    try {
      const res = await fetch(`${RELAY_BASE}/pair/${active.sessionId}`, {
        headers: { "x-api-key": apiKey() },
      });
      if (res.status === 200) {
        const { blob } = await res.json();
        const payload = await decryptPayload(active.key, blob);
        stop();
        applyCustomerData(elements, { ...payload.buyer, coBuyer: payload.coBuyer });
        onDone({ status: "filled", payload });
        return;
      }
      // 204 = nothing yet; keep polling.
    } catch {
      // transient; keep polling until the window expires
    }
    if (active) active.timer = setTimeout(tick, POLL_MS);
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
