import { parseAAMVA } from "./lib/aamva.js";

// Phase 1: sessionId + key are parsed to lock the URL contract but NOT used yet.
// Phase 2 will encrypt the payload with `keyB64` and POST to the relay for `sessionId`.
const params = new URLSearchParams(location.search);
const sessionId = params.get("s") || "";
const keyB64 = new URLSearchParams(location.hash.slice(1)).get("k") || "";

const el = (id) => document.getElementById(id);
const screens = {
  camera: el("cameraScreen"),
  review: el("reviewScreen"),
  cobuyer: el("cobuyerPrompt"),
  done: el("doneScreen"),
};

const deal = { buyer: null, coBuyer: null };
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

// Resolve with the raw AAMVA barcode text from the camera.
async function scanRawBarcode() {
  const video = el("video");
  if ("BarcodeDetector" in window) {
    let formats = [];
    try { formats = await window.BarcodeDetector.getSupportedFormats(); } catch {}
    if (formats.includes("pdf417")) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ["pdf417"] });
      detectorLoop = true;
      return new Promise((resolve) => {
        const tick = async () => {
          if (!detectorLoop) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length && codes[0].rawValue) { resolve(codes[0].rawValue); return; }
          } catch {}
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
  }
  // Fallback: ZXing handles getUserMedia + decode (iOS Safari).
  if (typeof ZXing === "undefined") throw new Error("Barcode scanner failed to load.");
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  zxingReader = new ZXing.BrowserMultiFormatReader(hints);
  return new Promise((resolve, reject) => {
    zxingReader
      .decodeFromConstraints({ video: { facingMode: "environment" } }, video, (result) => {
        if (result) resolve(result.getText());
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

function finish() {
  // Guard: same license scanned twice.
  if (deal.coBuyer && deal.buyer && deal.coBuyer.dlnPid === deal.buyer.dlnPid) {
    showError("Buyer and co-buyer have the same license number — did you scan the same card twice?");
  }
  const payload = {
    buyer: deal.buyer,
    coBuyer: deal.coBuyer || null,
    scannedAt: new Date().toISOString(),
  };
  // Phase 1: display the assembled payload (Phase 2 encrypts + relays it).
  el("payloadPreview").textContent = JSON.stringify(payload, null, 2);
  show("done");
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
