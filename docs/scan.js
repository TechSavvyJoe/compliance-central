import {
  aamvaElementCodes,
  evaluateDetection,
  looksLikeAamva,
  rankDecodedPayloads,
} from "./lib/aamva.js?v=20260717-8";
import { encryptPayload } from "./lib/crypto-pair.js";
import { classifyBrowseContext } from "./lib/scan-context.js?v=20260717-8";
import { createDetectionGate } from "./lib/scan-state.js?v=20260717-8";
import { buildDecodeCrops, mapGuideToVideoPixels } from "./lib/scan-roi.js?v=20260717-8";
import {
  decodePdf417Wasm,
  ensureWasmReader,
} from "./lib/zxing-wasm-loader.js?v=20260717-8";
import {
  createCommercialScannerProvider,
} from "./lib/scanner-provider.js?v=20260717-8";

const RELAY_BASE = "https://compliance-central-api.fly.dev";
const SCANNER_BUILD = "scanner-2026-07-17.8-live";

// Pairing data is split between query and fragment so the relay never receives
// the AES key in the URL request.
const params = new URLSearchParams(location.search);
const sessionId = params.get("s") || "";
const keyB64 = new URLSearchParams(location.hash.slice(1)).get("k") || "";
// Diagnostics (camera resolution, element codes) only show with ?debug=1.
const DEBUG = params.has("debug");

const DETECT_COOLDOWN_MS = 1800;
/** ~4–5 Hz live decode — heavy per-frame preprocess kills FPS on phones. */
const FRAME_INTERVAL_MS = 220;
const MAX_DECODE_WIDTH = 1800;
const PARTIAL_HINT_THRESHOLD = 4;
const LIVE_DESKEW = [0, -6, 6, -10, 10];

const el = (id) => document.getElementById(id);
const screens = {
  camera: el("cameraScreen"),
  review: el("reviewScreen"),
  cobuyer: el("cobuyerPrompt"),
  done: el("doneScreen"),
};
const commercialProviderReady = createCommercialScannerProvider({
  mount: el("video").parentElement,
});

const deal = { buyer: null, coBuyer: null };
let capturing = "buyer"; // "buyer" | "coBuyer"
let pending = null; // last parsed result awaiting confirmation
let captureGen = 0; // bumped to cancel an in-flight scan without killing UX mid-frame
let activeRun = null;
let resumeAfterVisibility = false;
let torchEnabled = false;
let wasmReady = false;
let choosingPhoto = false;

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
  if (run.provider) {
    Promise.resolve(run.provider.stop()).catch(() => {});
  }
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
  width: { ideal: 3840 },
  height: { ideal: 2160 },
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
    const target = Math.max(minimum, Math.min(caps.zoom.max, 1.45));
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
    return "Barcode detected — still decoding the full license. Hold steady and keep the wide barcode centered.";
  }
  if (reason === "not-aamva") {
    return "Point at the wide PDF417 barcode on the back of the license (not a QR code or the thin 1D line).";
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

function browseContextIssue() {
  const ctx = classifyBrowseContext(window);
  if (ctx.embedded) {
    return "Camera cannot run inside another app's browser. Open this link in Safari or Chrome, then tap Start camera.";
  }
  if (ctx.tinyPopup) {
    return "Camera needs a full browser page. Close this small window, open the link in Safari or Chrome, then tap Start camera.";
  }
  return "";
}

/** Prefer a top-level tab so getUserMedia is allowed (iframes/popups often block it). */
function promoteToTopLevelIfNeeded() {
  const ctx = classifyBrowseContext(window);
  if (!ctx.embedded) return false;
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = location.href;
      return true;
    }
  } catch {
    // Cross-origin parent — caller shows browseContextIssue().
  }
  return false;
}

function guideCrop(video, padding = 0.04) {
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

function drawCropFrame(video, canvas, crop, scale = 1) {
  const targetWidth = Math.max(
    1,
    Math.round(Math.min(MAX_DECODE_WIDTH, crop.width * scale))
  );
  const targetHeight = Math.max(1, Math.round((targetWidth * crop.height) / crop.width));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
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
  return context;
}

function rotateCanvas(source, target, degrees) {
  if (!degrees) return source.getContext("2d", { alpha: false, willReadFrequently: true });
  if (target.width !== source.width) target.width = source.width;
  if (target.height !== source.height) target.height = source.height;
  const context = target.getContext("2d", { alpha: false, willReadFrequently: true });
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, target.width, target.height);
  context.translate(target.width / 2, target.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  context.restore();
  return context;
}

function canvasImageData(canvas, context) {
  try {
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

function decodePdf417CanvasJs(reader, canvas, hints, mode) {
  let source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
  if (mode === 2) source = source.invert();
  const binarizer =
    mode === 1
      ? new ZXing.GlobalHistogramBinarizer(source)
      : new ZXing.HybridBinarizer(source);
  return reader.decode(new ZXing.BinaryBitmap(binarizer), hints);
}

async function createNativePdf417Detector() {
  if (!("BarcodeDetector" in window)) return null;
  let formats = [];
  try { formats = await window.BarcodeDetector.getSupportedFormats(); } catch {}
  if (!formats.includes("pdf417")) return null;
  try {
    return new window.BarcodeDetector({ formats: LICENSE_FORMATS });
  } catch {
    return null;
  }
}

function createJsPdf417Reader() {
  if (typeof ZXing === "undefined") return { reader: null, hints: null };
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  hints.set(ZXing.DecodeHintType.PURE_BARCODE, false);
  return { reader: new ZXing.PDF417Reader(), hints };
}

async function decodeCanvasCandidates(
  canvas,
  context,
  { nativeDetector, zxingReader, hints, jsMode = 0 }
) {
  const candidates = [];

  if (nativeDetector) {
    try {
      const codes = await nativeDetector.detect(canvas);
      for (const code of codes || []) {
        if (
          code &&
          code.rawValue &&
          (!code.format || String(code.format).toLowerCase() === "pdf417")
        ) {
          candidates.push(code.rawValue);
        }
      }
    } catch {}
  }

  if (wasmReady) {
    const imageData = canvasImageData(canvas, context);
    if (imageData) {
      try {
        candidates.push(...await decodePdf417Wasm(imageData));
      } catch {}
    }
  }

  if (zxingReader) {
    try {
      const result = decodePdf417CanvasJs(zxingReader, canvas, hints, jsMode);
      if (result && result.getText()) candidates.push(result.getText());
    } catch {
      // A miss is expected on most live frames.
    } finally {
      try { zxingReader.reset(); } catch {}
    }
  }

  return rankDecodedPayloads(candidates);
}

/**
 * Resolve with { person, raw } once a complete AAMVA license is decoded.
 * Keeps the same camera stream across rejected frames (no flash/restart loop).
 */
async function scanCommercialLicenseBarcode(provider, gen) {
  const gate = createDetectionGate(DETECT_COOLDOWN_MS);
  const run = {
    gen,
    provider,
    stopped: false,
    cancel: null,
  };
  activeRun = run;
  el("status").textContent = "Starting production-grade scanner…";

  return new Promise((resolve, reject) => {
    let settled = false;
    run.cancel = () => {
      if (!settled) reject(new Error("cancelled"));
    };

    const onCandidates = (candidates) => {
      if (settled || run.stopped || gen !== captureGen) return;
      for (const raw of rankDecodedPayloads(candidates)) {
        const verdict = gate.evaluate(raw);
        if (verdict.ok) {
          settled = true;
          resolve(verdict);
          return;
        }
        if (verdict.reason === "incomplete") {
          el("status").textContent = "Barcode detected — decoding the full license…";
          if (DEBUG) {
            diag(`provider Dynamsoft · partial len ${raw.length}`);
          }
        }
      }
    };

    provider.start(onCandidates).then(() => {
      if (settled || run.stopped || gen !== captureGen) return;
      el("status").textContent = "Point at the wide PDF417 on the back…";
      diag("provider Dynamsoft · camera ready");
    }).catch((error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function scanLicenseBarcode(gen) {
  const commercial = await commercialProviderReady;
  if (commercial.provider) {
    try {
      return await scanCommercialLicenseBarcode(commercial.provider, gen);
    } catch (error) {
      if (error && error.message === "cancelled") throw error;
      stopCamera();
      diag(`Dynamsoft unavailable (${commercial.reason || error.message || "start failed"}) · fallback zxing`);
      el("status").textContent = "Starting camera fallback…";
    }
  } else {
    diag(`provider zxing · ${commercial.reason || "commercial unavailable"}`);
  }
  return scanOpenSourceLicenseBarcode(gen);
}

async function scanOpenSourceLicenseBarcode(gen) {
  const video = el("video");
  let attempts = 0;
  let lastHintAt = 0;
  let lastHintReason = "";
  let nearMissFrames = 0;
  let lastNearMissAttempt = -1;
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
    const reason =
      verdict.reason === "duplicate" ? verdict.originalReason : verdict.reason;
    if (reason === "incomplete") {
      if (lastNearMissAttempt !== attempts) {
        nearMissFrames++;
        lastNearMissAttempt = attempts;
      }
      if (nearMissFrames < PARTIAL_HINT_THRESHOLD) {
        el("status").textContent = "Barcode detected — decoding…";
        return verdict;
      }
    }
    if (verdict.reason === "duplicate" && reason !== "incomplete") return verdict;
    const now = Date.now();
    if (reason !== lastHintReason || now - lastHintAt >= DETECT_COOLDOWN_MS) {
      const hint = rejectHint(reason);
      el("status").textContent = hint;
      showError(hint);
      lastHintAt = now;
      lastHintReason = reason;
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

  // Start the camera immediately. Do NOT await WASM first — that delayed
  // getUserMedia and, when the loader threw, aborted camera startup entirely.
  const wasmWarm = ensureWasmReader().then((ok) => {
    wasmReady = ok;
    return ok;
  });

  // Safari generally falls through to ZXing-C++ / JS.
  const nativeDetector = await createNativePdf417Detector();
  if (run.stopped || gen !== captureGen) throw new Error("cancelled");

  el("status").textContent = "Requesting camera…";
  run.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: HIRES });
  if (run.stopped || gen !== captureGen) {
    stopCamera(run);
    throw new Error("cancelled");
  }
  video.srcObject = run.stream;
  await video.play();
  const track = await optimizeCamera(run.stream);
  const settings = track && track.getSettings ? track.getSettings() : {};
  el("status").textContent = "Point at the wide PDF417 on the back…";

  // Do not stall the live loop on a slow WASM compile — JS ZXing can decode
  // first; flip wasmReady when the module finishes.
  const wasmTimed = await Promise.race([
    wasmWarm,
    new Promise((resolve) => setTimeout(() => resolve(false), 600)),
  ]);
  wasmReady = Boolean(wasmTimed);
  wasmWarm.then((ok) => {
    wasmReady = ok;
  });
  if (!nativeDetector && !wasmReady && typeof ZXing === "undefined") {
    // Give WASM one more beat before failing closed.
    wasmReady = await wasmWarm;
  }
  if (!nativeDetector && !wasmReady && typeof ZXing === "undefined") {
    stopCamera(run);
    throw new Error("scanner-library-unavailable");
  }

  const { reader: zxingReader, hints } = createJsPdf417Reader();
  run.reader = zxingReader;

  const canvas = document.createElement("canvas");
  const rotatedCanvas = document.createElement("canvas");
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastFrameAt = 0;
    let decoding = false;
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
      if (decoding || now - lastFrameAt < FRAME_INTERVAL_MS) {
        run.rafId = requestAnimationFrame(tick);
        return;
      }
      lastFrameAt = now;
      attempts++;
      decoding = true;

      try {
        const guide = guideCrop(video, attempts % 5 === 0 ? 0.1 : 0.04);
        if (!guide) {
          decoding = false;
          run.rafId = requestAnimationFrame(tick);
          return;
        }

        // One ROI + one deskew per tick (cycle variants across frames).
        const crops = buildDecodeCrops(guide, attempts, video.videoWidth);
        const crop = crops[attempts % Math.max(1, crops.length)];
        if (!crop) {
          decoding = false;
          run.rafId = requestAnimationFrame(tick);
          return;
        }
        const scale = attempts % 5 === 0 ? 1.12 : 1;
        const angle = LIVE_DESKEW[attempts % LIVE_DESKEW.length];
        drawCropFrame(video, canvas, crop, scale);
        const decodeTarget = angle ? rotatedCanvas : canvas;
        const context = angle
          ? rotateCanvas(canvas, rotatedCanvas, angle)
          : canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        const candidates = await decodeCanvasCandidates(decodeTarget, context, {
          nativeDetector,
          zxingReader,
          hints,
          jsMode: attempts % 2,
        });
        for (const text of candidates) {
          if (finishIfAccepted(text)) return;
        }

        if (attempts % 10 === 0) {
          diag(
            `${nativeDetector ? "native+" : ""}${wasmReady ? "wasm+" : ""}js` +
              ` · ROI ${canvas.width}×${canvas.height}` +
              ` · skew ${angle}°` +
              ` · cam ${settings.width || video.videoWidth || "?"}×${settings.height || video.videoHeight || "?"}` +
              ` · tries ${attempts}`
          );
        }
      } finally {
        decoding = false;
        if (!settled && !run.stopped && gen === captureGen) {
          run.rafId = requestAnimationFrame(tick);
        }
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

async function beginCapture(which, { waitForGesture = false } = {}) {
  capturing = which;
  const gen = ++captureGen;
  stopCamera();
  clearError();
  const pairingIssue = pairingConfigurationIssue();
  const contextIssue = waitForGesture ? browseContextIssue() : "";
  if (pairingIssue) showError(pairingIssue);
  else if (contextIssue) showError(contextIssue);
  el("captureHeading").textContent =
    which === "buyer" ? "Scan the buyer's license" : "Scan the co-buyer's license";
  show("camera");
  el("status").textContent = "Starting camera…";

  // Iframes / tiny popups: show UI + instructions; wait for an explicit tap.
  if (waitForGesture) {
    el("startBtn").textContent = "Start camera";
    el("startBtn").classList.remove("hidden");
    el("status").textContent = contextIssue
      ? "Open in Safari or Chrome, then tap Start camera."
      : "Tap Start camera to allow access.";
    return;
  }

  el("startBtn").classList.add("hidden");

  // Warm WASM in parallel — never block or abort camera on loader failure.
  ensureWasmReader().then((ok) => {
    wasmReady = ok;
  }).catch(() => {
    wasmReady = false;
  });

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
    el("status").textContent = "Camera did not start.";
    el("startBtn").textContent = "Try camera again";
    el("startBtn").classList.remove("hidden");
  }
}

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("photo-load-failed"));
    };
    image.src = url;
  });
}

async function decodePhoto(file) {
  const gen = ++captureGen;
  stopCamera();
  clearError();
  show("camera");
  el("status").textContent = "Reading photo…";

  let loaded = null;
  let zxingReader = null;
  let commercialNearMiss = "";
  try {
    loaded = await loadPhoto(file);
    const commercial = await commercialProviderReady;
    if (commercial.provider) {
      try {
        const candidates = rankDecodedPayloads(
          await commercial.provider.decodeImage(file)
        );
        for (const raw of candidates) {
          const verdict = evaluateDetection(raw);
          if (verdict.ok) {
            pending = verdict.person;
            renderReview(verdict.person);
            clearError();
            diag(`provider Dynamsoft · photo len ${raw.length}`);
            show("review");
            return;
          }
          if (raw.length > commercialNearMiss.length) commercialNearMiss = raw;
        }
        diag("provider Dynamsoft · photo miss · fallback zxing");
      } catch (error) {
        diag(`Dynamsoft photo error (${error.message || "decode failed"}) · fallback zxing`);
      }
    }

    wasmReady = await ensureWasmReader();
    const nativeDetector = await createNativePdf417Detector();
    const js = createJsPdf417Reader();
    zxingReader = js.reader;
    if (!nativeDetector && !wasmReady && !zxingReader) {
      throw new Error("scanner-library-unavailable");
    }

    const source = loaded.image;
    const full = {
      x: 0,
      y: 0,
      width: source.naturalWidth,
      height: source.naturalHeight,
    };
    const crops = buildDecodeCrops(full, 1, source.naturalWidth);
    // A loosely framed photo may place the symbol outside the lower windows.
    // Keep one PDF417-only full-photo search as the still-image fallback.
    crops.push(full);
    const canvas = document.createElement("canvas");
    const rotatedCanvas = document.createElement("canvas");
    let bestNearMiss = commercialNearMiss;

    for (const crop of crops) {
      if (gen !== captureGen) return;
      drawCropFrame(source, canvas, crop);
      for (const angle of [0, -6, 6, -10, 10]) {
        const decodeTarget = angle ? rotatedCanvas : canvas;
        const context = angle
          ? rotateCanvas(canvas, rotatedCanvas, angle)
          : canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        const candidates = await decodeCanvasCandidates(decodeTarget, context, {
          nativeDetector,
          zxingReader,
          hints: js.hints,
          jsMode: 0,
        });
        for (const raw of candidates) {
          const verdict = evaluateDetection(raw);
          if (verdict.ok) {
            pending = verdict.person;
            renderReview(verdict.person);
            clearError();
            show("review");
            return;
          }
          if (raw.length > bestNearMiss.length) bestNearMiss = raw;
        }
      }
    }

    const message = bestNearMiss
      ? "The barcode was found, but the photo did not contain the full license data. Try another sharp, well-lit photo."
      : "No PDF417 license barcode was found. Try a sharp, well-lit photo of the back of the license.";
    el("status").textContent = message;
    showError(message);
    el("startBtn").textContent = "Try camera again";
    el("startBtn").classList.remove("hidden");
  } catch (error) {
    const message =
      error && error.message === "scanner-library-unavailable"
        ? cameraErrorMessage(error)
        : "That photo could not be read. Choose another photo or try the camera again.";
    el("status").textContent = message;
    showError(message);
    el("startBtn").textContent = "Try camera again";
    el("startBtn").classList.remove("hidden");
  } finally {
    if (zxingReader) {
      try { zxingReader.reset(); } catch {}
    }
    if (loaded) URL.revokeObjectURL(loaded.url);
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
  // Explicit user gesture — always attempt getUserMedia from here.
  beginCapture(capturing, { waitForGesture: false });
});
el("photoBtn").addEventListener("click", () => {
  choosingPhoto = true;
  el("photoInput").click();
});
el("photoInput").addEventListener("change", (event) => {
  choosingPhoto = false;
  const input = event.currentTarget;
  const file = input.files && input.files[0];
  input.value = "";
  if (file) decodePhoto(file);
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
    if (choosingPhoto) {
      resumeAfterVisibility = false;
      captureGen++;
      stopCamera();
      return;
    }
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

// Prefer a full top-level page so the phone camera permission prompt can appear.
if (promoteToTopLevelIfNeeded()) {
  // Navigating the parent frame — do not start camera in this embed.
} else {
  // Warm WASM without blocking camera; never let a loader throw abort init.
  ensureWasmReader()
    .then((ok) => {
      wasmReady = ok;
    })
    .catch(() => {
      wasmReady = false;
    });
  const ctx = classifyBrowseContext(window);
  beginCapture("buyer", { waitForGesture: ctx.constrained });
}
