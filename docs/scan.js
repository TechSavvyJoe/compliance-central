import { aamvaElementCodes, looksLikeAamva } from "./lib/aamva.js?v=20260717-2";
import { encryptPayload } from "./lib/crypto-pair.js";
import { createDetectionGate } from "./lib/scan-state.js?v=20260717-2";
import { mapGuideToVideoPixels } from "./lib/scan-roi.js?v=20260717-2";

const RELAY_BASE = "https://compliance-central-api.fly.dev";
const SCANNER_BUILD = "scanner-2026-07-17.2";

// Pairing data is split between query and fragment so the relay never receives
// the AES key in the URL request.
const params = new URLSearchParams(location.search);
const sessionId = params.get("s") || "";
const keyB64 = new URLSearchParams(location.hash.slice(1)).get("k") || "";
// Diagnostics (camera resolution, element codes) only show with ?debug=1.
const DEBUG = params.has("debug");

const DETECT_COOLDOWN_MS = 1800;
const FRAME_INTERVAL_MS = 80;
const MAX_DECODE_WIDTH = 1800;

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
let captureGen = 0; // bumped to cancel an in-flight scan without killing UX mid-frame
let activeRun = null;
let resumeAfterVisibility = false;
let torchEnabled = false;

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

function stopCamera(run = activeRun) {
  if (!run) return;
  run.stopped = true;
  if (run.rafId) cancelAnimationFrame(run.rafId);
  if (run.cancel) run.cancel();
  if (run.reader) {
    try { run.reader.reset(); } catch {}
  }
  if (run.stream) {
    run.stream.getTracks().forEach((track) => track.stop());
  }
  const video = el("video");
  if (video && video.srcObject === run.stream) video.srcObject = null;
  if (activeRun === run) activeRun = null;
  torchEnabled = false;
  updateTorchButton(null);
}

// On-screen diagnostics (we can't see the phone's console). Off unless ?debug=1.
function diag(msg) {
  if (!DEBUG) return;
  const d = el("diag");
  if (d) d.textContent = `${SCANNER_BUILD} · ${msg}`;
}

// A dense license PDF417 needs a high-resolution, focused frame to decode.
const HIRES = {
  facingMode: { ideal: "environment" },
  width: { ideal: 2560 },
  height: { ideal: 1440 },
  aspectRatio: { ideal: 16 / 9 },
};

// License scan: PDF417 only. Never QR — that would re-read the pairing QR.
const LICENSE_FORMATS = ["pdf417"];

// Best-effort continuous autofocus (advanced constraint; support varies).
async function optimizeCamera(mediaStream) {
  const track = mediaStream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  if (!track) return null;
  if (caps.focusMode && caps.focusMode.includes("continuous")) {
    try {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    } catch {}
  }
  if (caps.zoom && Number.isFinite(caps.zoom.max) && caps.zoom.max > 1) {
    const minimum = Number.isFinite(caps.zoom.min) ? caps.zoom.min : 1;
    const target = Math.max(minimum, Math.min(caps.zoom.max, 1.35));
    try {
      await track.applyConstraints({ advanced: [{ zoom: target }] });
    } catch {}
  }
  updateTorchButton(caps.torch ? track : null);
  return track;
}

function updateTorchButton(track) {
  const button = el("torchBtn");
  if (!button) return;
  button.classList.toggle("hidden", !track);
  button.disabled = !track;
  button.textContent = torchEnabled ? "Turn light off" : "Turn light on";
}

function rejectHint(reason) {
  if (reason === "incomplete") {
    return "Barcode partially read — hold steady, fill the frame, and try again.";
  }
  if (reason === "not-aamva") {
    return "Point at the PDF417 barcode on the back of the license (not a QR code).";
  }
  return "Couldn't read that barcode. Hold steady and well-lit.";
}

function cameraErrorMessage(error) {
  const name = error && error.name;
  const message = error && error.message;
  if (message === "camera-unsupported") {
    return "This browser does not support camera scanning. Open this link in Safari or Chrome on a camera-equipped phone.";
  }
  if (message === "scanner-library-unavailable") {
    return "The barcode scanner did not load. Check your connection, reload the page, and try again.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow camera access for this site in your browser settings, then tap Try camera again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No usable camera was found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is busy in another app. Close the other app, then tap Try camera again.";
  }
  if (name === "OverconstrainedError") {
    return "This camera could not use the requested scan settings. Tap Try camera again.";
  }
  return "The camera could not start. Check permission and reload or tap Try camera again.";
}

function pairingConfigurationIssue() {
  if (sessionId && !keyB64) {
    return "This pairing link is missing its encryption key. Scan a new QR code from Compliance Central.";
  }
  if (!sessionId && keyB64) {
    return "This pairing link is missing its session. Scan a new QR code from Compliance Central.";
  }
  return "";
}

function guideCrop(video, padding = 0.06) {
  const viewport = video.parentElement;
  const guide = viewport && viewport.querySelector(".frame-guide");
  if (!viewport || !guide || !video.videoWidth || !video.videoHeight) return null;
  const viewportRect = viewport.getBoundingClientRect();
  const guideRect = guide.getBoundingClientRect();
  return mapGuideToVideoPixels({
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    viewportWidth: viewportRect.width,
    viewportHeight: viewportRect.height,
    guideLeft: guideRect.left - viewportRect.left,
    guideTop: guideRect.top - viewportRect.top,
    guideWidth: guideRect.width,
    guideHeight: guideRect.height,
    padding,
  });
}

function drawGuideFrame(video, canvas, crop, scale = 1) {
  const targetWidth = Math.max(
    1,
    Math.round(Math.min(MAX_DECODE_WIDTH, crop.width * scale))
  );
  const targetHeight = Math.max(1, Math.round(targetWidth * crop.height / crop.width));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.drawImage(
    video,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    targetWidth,
    targetHeight
  );
}

function decodePdf417Canvas(reader, canvas, hints, mode) {
  let source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
  if (mode === 2) source = source.invert();
  const binarizer =
    mode === 1
      ? new ZXing.GlobalHistogramBinarizer(source)
      : new ZXing.HybridBinarizer(source);
  return reader.decode(new ZXing.BinaryBitmap(binarizer), hints);
}

/**
 * Resolve with { person, raw } once a complete AAMVA license is decoded.
 * Keeps the same camera stream across rejected frames (no flash/restart loop).
 */
async function scanLicenseBarcode(gen) {
  const video = el("video");
  let attempts = 0;
  let lastErr = "";
  let lastHintAt = 0;
  let lastHintReason = "";
  const gate = createDetectionGate(DETECT_COOLDOWN_MS);
  const run = {
    gen,
    stream: null,
    reader: null,
    rafId: 0,
    stopped: false,
    cancel: null,
  };
  activeRun = run;

  const tryAccept = (raw) => {
    if (run.stopped || gen !== captureGen) return { ok: false, reason: "cancelled" };
    const verdict = gate.evaluate(raw);
    if (verdict.ok) return verdict;
    if (verdict.reason === "duplicate") return verdict;
    const now = Date.now();
    if (verdict.reason !== lastHintReason || now - lastHintAt >= DETECT_COOLDOWN_MS) {
      const hint = rejectHint(verdict.reason);
      el("status").textContent = hint;
      showError(hint);
      lastHintAt = now;
      lastHintReason = verdict.reason;
    }
    if (DEBUG) {
      diag(
        `rejected (${verdict.reason}) · len ${String(raw || "").length}` +
          (looksLikeAamva(raw) ? ` · codes ${aamvaElementCodes(raw).join(" ")}` : "")
      );
    }
    return verdict;
  };

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("camera-unsupported");
  }

  // Only select BarcodeDetector after the browser confirms PDF417 support and
  // construction succeeds. Safari generally falls through to stable ZXing.
  let nativeDetector = null;
  if ("BarcodeDetector" in window) {
    let formats = [];
    try { formats = await window.BarcodeDetector.getSupportedFormats(); } catch {}
    if (formats.includes("pdf417")) {
      try {
        nativeDetector = new window.BarcodeDetector({ formats: LICENSE_FORMATS });
      } catch {}
    }
  }

  if (!nativeDetector && typeof ZXing === "undefined") {
    throw new Error("scanner-library-unavailable");
  }

  run.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: HIRES });
  if (run.stopped || gen !== captureGen) {
    stopCamera(run);
    throw new Error("cancelled");
  }
  video.srcObject = run.stream;
  await video.play();
  const track = await optimizeCamera(run.stream);
  const settings = track && track.getSettings ? track.getSettings() : {};
  const hints = new Map();
  let zxingReader = null;
  if (typeof ZXing !== "undefined") {
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    hints.set(ZXing.DecodeHintType.PURE_BARCODE, false);
    zxingReader = new ZXing.PDF417Reader();
    run.reader = zxingReader;
  }

  const canvas = document.createElement("canvas");
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastFrameAt = 0;
    run.cancel = () => {
      if (!settled) reject(new Error("cancelled"));
    };

    const finishIfAccepted = (raw) => {
      const outcome = tryAccept(raw);
      if (!outcome.ok) return false;
      settled = true;
      resolve(outcome);
      return true;
    };

    const tick = async (now) => {
      if (settled || run.stopped || gen !== captureGen) return;
      if (now - lastFrameAt < FRAME_INTERVAL_MS) {
        run.rafId = requestAnimationFrame(tick);
        return;
      }
      lastFrameAt = now;
      attempts++;

      const crop = guideCrop(video, attempts % 4 === 0 ? 0.14 : 0.06);
      if (!crop) {
        run.rafId = requestAnimationFrame(tick);
        return;
      }
      drawGuideFrame(video, canvas, crop, attempts % 5 === 0 ? 0.75 : 1);

      // Prefer the platform detector when it truly supports PDF417. Decode the
      // guide canvas, not the full preview, so the 1D strip above it is ignored.
      if (nativeDetector) {
        try {
          const codes = await nativeDetector.detect(canvas);
          for (const code of codes) {
            if (
              code &&
              code.rawValue &&
              (!code.format || String(code.format).toLowerCase() === "pdf417") &&
              finishIfAccepted(code.rawValue)
            ) {
              return;
            }
          }
        } catch (error) {
          lastErr = error && error.name ? error.name : "native-detect-error";
        }
      }

      // Safari normally uses this path. Alternate hybrid/global/inverted
      // binarization and periodically downscale; dense Michigan symbols vary
      // substantially with glare, focus, and camera distance.
      if (zxingReader) {
        try {
          const result = decodePdf417Canvas(zxingReader, canvas, hints, attempts % 3);
          if (result && finishIfAccepted(result.getText())) return;
        } catch (error) {
          if (error && error.name && error.name !== "NotFoundException") {
            lastErr = error.name;
          }
        } finally {
          try { zxingReader.reset(); } catch {}
        }
      }

      if (attempts % 15 === 0) {
        diag(
          `${nativeDetector ? "native+" : ""}ZXing ROI ${canvas.width}×${canvas.height}` +
            ` · cam ${settings.width || video.videoWidth || "?"}×${settings.height || video.videoHeight || "?"}` +
            ` · tries ${attempts}` +
            (lastErr ? " · " + lastErr : "")
        );
      }
      if (!settled && !run.stopped && gen === captureGen) {
        run.rafId = requestAnimationFrame(tick);
      }
    };
    run.rafId = requestAnimationFrame(tick);
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
  const gen = ++captureGen;
  stopCamera();
  clearError();
  const pairingIssue = pairingConfigurationIssue();
  if (pairingIssue) showError(pairingIssue);
  el("captureHeading").textContent =
    which === "buyer" ? "Scan the buyer's license" : "Scan the co-buyer's license";
  show("camera");
  el("status").textContent = "Point the camera at the barcode on the back…";
  el("startBtn").classList.add("hidden");
  try {
    const { person, raw } = await scanLicenseBarcode(gen);
    if (gen !== captureGen) return;
    stopCamera();
    pending = person;
    renderReview(person);
    const rd = el("reviewDiag");
    if (rd && DEBUG) {
      const lf = (raw.match(/\n/g) || []).length;
      rd.textContent = `codes: ${aamvaElementCodes(raw).join(" ")} · len ${raw.length} · lf ${lf}`;
    }
    clearError();
    if (pairingIssue) showError(pairingIssue);
    show("review");
  } catch (e) {
    if (gen !== captureGen) return;
    stopCamera();
    const msg = e && e.message ? e.message : "unable to access camera.";
    if (msg === "cancelled") return;
    showError(cameraErrorMessage(e));
    el("startBtn").textContent = "Try camera again";
    el("startBtn").classList.remove("hidden");
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
    return;
  }
  const payload = {
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
  const delivery = el("deliveryStatus");
  if (delivery) {
    delivery.textContent =
      sessionId && keyB64 ? "Encrypting and sending to your computer…" : "Saved only for this screen.";
  }
  show("done");

  // If we arrived via a paired QR (session + key in the URL), encrypt the
  // payload with the QR-supplied key and relay it; otherwise the page just
  // works standalone (the summary above is the result).
  if (sessionId && keyB64) {
    try {
      let blob;
      try {
        blob = await encryptPayload(keyB64, payload);
      } catch {
        throw new Error("The pairing encryption key is invalid. Scan a new QR code from Compliance Central.");
      }
      const res = await fetch(
        `${RELAY_BASE}/pair/${encodeURIComponent(sessionId)}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(blob),
        }
      );
      if (!res.ok) {
        let detail = "The relay could not accept the scan.";
        if (res.status === 404 || res.status === 410) {
          detail = "The pairing session expired. Scan a new QR code from Compliance Central.";
        } else if (res.status === 409) {
          detail = "This pairing session was already used. Scan a new QR code from Compliance Central.";
        } else if (res.status >= 500) {
          detail = "The relay service is temporarily unavailable. Try again with a new pairing session.";
        }
        throw new Error(detail);
      }
      if (delivery) delivery.textContent = "Sent securely to your computer.";
    } catch (e) {
      if (delivery) delivery.textContent = "Not sent.";
      showError(
        "Couldn't send to your computer: " +
          (e && e.message ? e.message : "network error") +
          ". The data stayed on this phone — tap Start over after fixing the connection, or enter details on the computer."
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
el("startBtn").addEventListener("click", () => {
  el("startBtn").classList.add("hidden");
  beginCapture(capturing);
});
el("torchBtn").addEventListener("click", async () => {
  const run = activeRun;
  const track = run && run.stream && run.stream.getVideoTracks()[0];
  if (!track || run.stopped) return;
  const next = !torchEnabled;
  try {
    await track.applyConstraints({ advanced: [{ torch: next }] });
    torchEnabled = next;
    updateTorchButton(track);
  } catch {
    showError("This camera could not change the light setting. Scanning can continue.");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resumeAfterVisibility = Boolean(activeRun && !screens.camera.classList.contains("hidden"));
    if (resumeAfterVisibility) {
      captureGen++;
      stopCamera();
    }
  } else if (resumeAfterVisibility) {
    resumeAfterVisibility = false;
    beginCapture(capturing);
  }
});

window.addEventListener("pagehide", () => {
  captureGen++;
  stopCamera();
});

// Auto-start the camera on load (button is the manual fallback if blocked).
beginCapture("buyer");
