import { parseAAMVA, aamvaElementCodes } from "./lib/aamva.js";
import { encryptPayload } from "./lib/crypto-pair.js";

const RELAY_BASE = "https://compliance-central-api.fly.dev";

// Phase 1: sessionId + key are parsed to lock the URL contract but NOT used yet.
// Phase 2 will encrypt the payload with `keyB64` and POST to the relay for `sessionId`.
const params = new URLSearchParams(location.search);
const sessionId = params.get("s") || "";
const keyB64 = new URLSearchParams(location.hash.slice(1)).get("k") || "";
// Diagnostics (camera resolution, element codes) only show with ?debug=1.
const DEBUG = params.has("debug");

const el = (id) => document.getElementById(id);
const screens = {
  camera: el("cameraScreen"),
  review: el("reviewScreen"),
  cobuyer: el("cobuyerPrompt"),
  done: el("doneScreen"),
};

const deal = { buyer: null, coBuyer: null };
let lastPayload = null; // assembled on finish(); Phase 2 encrypts + relays it
let capturing = "buyer"; // "buyer" | "coBuyer"
let pending = null; // last parsed result awaiting confirmation
let stream = null;
let zxingReader = null;
let detectorLoop = false;

function show(name) {
  for (const [key, node] of Object.entries(screens)) {
    node.classList.toggle("hidden", key !== name);
  }
}

function showError(msg) {
  const b = el("errorBanner");
  b.textContent = msg;
  b.classList.remove("hidden");
}
function clearError() {
  el("errorBanner").classList.add("hidden");
}

function stopCamera() {
  detectorLoop = false;
  if (zxingReader) {
    try { zxingReader.reset(); } catch {}
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

// On-screen diagnostics (we can't see the phone's console). Off unless ?debug=1.
function diag(msg) {
  if (!DEBUG) return;
  const d = el("diag");
  if (d) d.textContent = msg;
}

// A dense license PDF417 needs a high-resolution, focused frame to decode.
const HIRES = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

// Best-effort continuous autofocus (advanced constraint; support varies).
async function applyContinuousFocus(mediaStream) {
  try {
    const track = mediaStream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes("continuous")) {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    }
    return track;
  } catch {
    return mediaStream.getVideoTracks()[0];
  }
}

// Resolve with the raw AAMVA barcode text from the camera.
async function scanRawBarcode() {
  const video = el("video");
  let attempts = 0;
  let lastErr = "";

  // Path 1: native BarcodeDetector (Android Chrome) on high-res frames.
  if ("BarcodeDetector" in window) {
    let formats = [];
    try { formats = await window.BarcodeDetector.getSupportedFormats(); } catch {}
    if (formats.includes("pdf417")) {
      stream = await navigator.mediaDevices.getUserMedia({ video: HIRES });
      video.srcObject = stream;
      await video.play();
      const track = await applyContinuousFocus(stream);
      const s = track && track.getSettings ? track.getSettings() : {};
      const detector = new window.BarcodeDetector({ formats: ["pdf417"] });
      detectorLoop = true;
      return new Promise((resolve) => {
        const tick = async () => {
          if (!detectorLoop) return;
          attempts++;
          try {
            const codes = await detector.detect(video);
            if (codes.length && codes[0].rawValue) { resolve(codes[0].rawValue); return; }
          } catch (e) { lastErr = e && e.name ? e.name : "detect-error"; }
          if (attempts % 15 === 0) {
            diag(`BarcodeDetector · cam ${s.width || "?"}×${s.height || "?"} · video ${video.videoWidth}×${video.videoHeight} · tries ${attempts}${lastErr ? " · " + lastErr : ""}`);
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
  }

  // Path 2: ZXing fallback (iOS Safari) on high-res frames.
  if (typeof ZXing === "undefined") throw new Error("Barcode scanner failed to load.");
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  zxingReader = new ZXing.BrowserMultiFormatReader(hints);
  return new Promise((resolve, reject) => {
    let focusApplied = false;
    zxingReader
      .decodeFromConstraints({ video: HIRES }, video, (result, err) => {
        attempts++;
        if (!focusApplied && video.srcObject) {
          focusApplied = true;
          applyContinuousFocus(video.srcObject);
        }
        if (result) { resolve(result.getText()); return; }
        if (err && err.name && err.name !== "NotFoundException") lastErr = err.name;
        if (attempts % 15 === 0) {
          diag(`ZXing · video ${video.videoWidth}×${video.videoHeight} · tries ${attempts}${lastErr ? " · " + lastErr : ""}`);
        }
      })
      .catch(reject);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderReview(person) {
  el("reviewHeading").textContent =
    capturing === "buyer" ? "Confirm the buyer" : "Confirm the co-buyer";
  const rows = [
    ["Name", [person.firstName, person.middleName, person.lastName, person.suffix].filter(Boolean).join(" ")],
    ["Date of birth", person.dob],
    ["DLN / ID", person.dlnPid],
    ["Issuing state", person.jurisdiction || "—"],
  ];
  el("fields").innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join("");
  const note = el("jurisdictionNote");
  if (!person.isMichigan) {
    note.textContent =
      "Out-of-state ID — OFAC will run. The Michigan Repeat Offender check needs a Michigan DL or state ID, so it will be skipped for this person.";
    note.classList.remove("hidden");
  } else {
    note.classList.add("hidden");
  }
}

async function beginCapture(which) {
  capturing = which;
  clearError();
  el("captureHeading").textContent =
    which === "buyer" ? "Scan the buyer's license" : "Scan the co-buyer's license";
  show("camera");
  el("status").textContent = "Point the camera at the barcode…";
  try {
    const raw = await scanRawBarcode();
    stopCamera();
    const parsed = parseAAMVA(raw);
    if (!parsed || !parsed.dlnPid) {
      showError("Couldn't read that barcode. Try again, holding steady and well-lit.");
      return beginCapture(which);
    }
    pending = parsed;
    renderReview(parsed);
    // Privacy-safe diagnostic (codes only, no values), shown with ?debug=1.
    const rd = el("reviewDiag");
    if (rd && DEBUG) {
      const lf = (raw.match(/\n/g) || []).length;
      rd.textContent = `codes: ${aamvaElementCodes(raw).join(" ")} · len ${raw.length} · lf ${lf}`;
    }
    show("review");
  } catch (e) {
    stopCamera();
    showError("Camera error: " + (e && e.message ? e.message : "unable to access camera."));
  }
}

function onConfirm() {
  deal[capturing] = pending;
  pending = null;
  if (capturing === "buyer") {
    show("cobuyer");
  } else {
    finish();
  }
}

async function finish() {
  // Guard: same license scanned twice.
  if (deal.coBuyer && deal.buyer && deal.coBuyer.dlnPid === deal.buyer.dlnPid) {
    showError("Buyer and co-buyer have the same license number — did you scan the same card twice?");
  }
  lastPayload = {
    buyer: deal.buyer,
    coBuyer: deal.coBuyer || null,
    scannedAt: new Date().toISOString(),
  };
  // Clean, human-readable confirmation of who was captured (no raw JSON).
  const fullName = (p) =>
    [p.firstName, p.middleName, p.lastName, p.suffix].filter(Boolean).join(" ");
  let rows = `<div class="cap-row"><span>Buyer</span><strong>${escapeHtml(fullName(deal.buyer))}</strong></div>`;
  if (deal.coBuyer) {
    rows += `<div class="cap-row"><span>Co-buyer</span><strong>${escapeHtml(fullName(deal.coBuyer))}</strong></div>`;
  }
  const cs = el("captureSummary");
  if (cs) cs.innerHTML = rows;
  show("done");

  // If we arrived via a paired QR (session + key in the URL), encrypt the
  // payload with the QR-supplied key and relay it; otherwise the page just
  // works standalone (the summary above is the result).
  if (sessionId && keyB64) {
    try {
      const blob = await encryptPayload(keyB64, lastPayload);
      const res = await fetch(
        `${RELAY_BASE}/pair/${encodeURIComponent(sessionId)}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(blob),
        }
      );
      if (!res.ok) throw new Error("relay " + res.status);
    } catch (e) {
      showError(
        "Couldn't send to your computer: " +
          (e && e.message ? e.message : "network error") +
          ". The data stayed on this phone."
      );
    }
  }
}

function resetAll() {
  deal.buyer = null;
  deal.coBuyer = null;
  pending = null;
  capturing = "buyer";
  clearError();
  beginCapture("buyer");
}

el("confirmBtn").addEventListener("click", onConfirm);
el("rescanBtn").addEventListener("click", () => beginCapture(capturing));
el("yesCoBuyerBtn").addEventListener("click", () => beginCapture("coBuyer"));
el("noCoBuyerBtn").addEventListener("click", finish);
el("startOverBtn").addEventListener("click", resetAll);
el("startBtn").addEventListener("click", () => beginCapture(capturing));

// Auto-start the camera on load (button is the manual fallback if blocked).
beginCapture("buyer");
