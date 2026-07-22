import {
  aamvaElementCodes,
  evaluateDetection,
  looksLikeAamva,
  rankDecodedPayloads,
} from "./lib/aamva.js?v=20260722-16";
import { encryptPayload } from "./lib/crypto-pair.js";
import { classifyBrowseContext } from "./lib/scan-context.js?v=20260717-10";
import {
  classifyPairingState,
  commitPendingScan,
  createCameraRequest,
  createDetectionGate,
  decodeIntervalElapsed,
  hasSameLicenseNumber,
  PHOTO_LIMITS,
  resolveBeforeTimeout,
  validatePhotoDimensions,
  validatePhotoFile,
} from "./lib/scan-state.js?v=20260722-16";
import {
  buildDecodeCrops,
  buildLiveDecodePlan,
  mapGuideToVideoPixels,
} from "./lib/scan-roi.js?v=20260722-14";
import {
  decodePdf417File,
  decodePdf417Wasm,
  ensureWasmReader,
} from "./lib/zxing-wasm-loader.js?v=20260722-15";
import {
  createCommercialScannerProvider,
} from "./lib/scanner-provider.js?v=20260717-10";

const RELAY_BASE = "https://compliance-central-api.fly.dev";
const SCANNER_BUILD = "scanner-2026-07-22.20";

// Pairing data is split between query and fragment so the relay never receives
// the AES key in the URL request.
const params = new URLSearchParams(location.search);
const sessionId = params.get("s") || "";
const keyB64 = new URLSearchParams(location.hash.slice(1)).get("k") || "";
// Diagnostics are privacy-safe (field codes/lengths only), but production users
// should not see implementation details. Enable deliberately with ?debug=1.
const DEBUG = params.get("debug") === "1";

const DETECT_COOLDOWN_MS = 1800;
/** Keep the main thread responsive while the previous decode is still running. */
const FRAME_INTERVAL_MS = 120;
const MAX_DECODE_WIDTH = 1600;
const MAX_DESKEW_WIDTH = 1280;
const PARTIAL_HINT_THRESHOLD = 3;
/** Legacy JS is a fallback; running it every frame can freeze older iPhones. */
const JS_FALLBACK_EVERY_N = 6;
const COMMERCIAL_READY_TIMEOUT_MS = 1500;
const COMMERCIAL_START_TIMEOUT_MS = 8000;
const COMMERCIAL_STOP_TIMEOUT_MS = 3000;
const COMMERCIAL_PHOTO_TIMEOUT_MS = 5000;
const CAMERA_START_TIMEOUT_MS = 12_000;
const LIVE_DECODE_TIMEOUT_MS = 2500;
const LIVE_DECODE_TIMEOUT_RESULT = Object.freeze({ timedOut: true });
const WASM_READY_TIMEOUT_MS = 8000;
const PHOTO_LOAD_TIMEOUT_MS = 8000;
const PHOTO_DECODE_BUDGET_MS = 15_000;

const el = (id) => document.getElementById(id);
const screens = {
  camera: el("cameraScreen"),
  review: el("reviewScreen"),
  cobuyer: el("cobuyerPrompt"),
  done: el("doneScreen"),
};
let visibleScreenName = "camera";
if (DEBUG) {
  el("diag").classList.remove("hidden");
  el("reviewDiag").classList.remove("hidden");
}
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
let lastPayload = null;
let deliveryGeneration = 0;
let activeDeliveryController = null;
let commercialProviderTeardown = Promise.resolve();

function show(name) {
  const changed = visibleScreenName !== name;
  for (const [key, node] of Object.entries(screens)) {
    node.classList.toggle("hidden", key !== name);
  }
  visibleScreenName = name;
  if (changed) {
    const heading = screens[name] && screens[name].querySelector("h2");
    if (heading) {
      heading.tabIndex = -1;
      requestAnimationFrame(() => {
        if (visibleScreenName === name) heading.focus({ preventScroll: true });
      });
    }
  }
}

function showError(msg) {
  const b = el("errorBanner");
  b.textContent = msg;
  b.classList.remove("hidden");
}
function clearError() {
  const banner = el("errorBanner");
  banner.textContent = "";
  banner.classList.add("hidden");
}

function queueCommercialProviderStop(provider) {
  const previous = commercialProviderTeardown;
  commercialProviderTeardown = previous
    .catch(() => {})
    .then(() => resolveBeforeTimeout(
      Promise.resolve().then(() => provider.stop()),
      COMMERCIAL_STOP_TIMEOUT_MS,
      null
    ))
    .catch(() => {});
  return commercialProviderTeardown;
}

function stopCamera(run = activeRun) {
  if (!run) return commercialProviderTeardown;
  run.stopped = true;
  if (run.rafId) cancelAnimationFrame(run.rafId);
  if (run.cancel) run.cancel();
  if (run.provider && !run.providerStopPromise) {
    run.providerStopPromise = queueCommercialProviderStop(run.provider);
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
  return run.providerStopPromise || commercialProviderTeardown;
}

// On-screen diagnostics (we can't see the phone's console). Off unless ?debug=1.
function diag(msg) {
  if (!DEBUG) return;
  const d = el("diag");
  if (d) d.textContent = `${SCANNER_BUILD} · ${msg}`;
}

// A dense license PDF417 needs a detailed frame, but forcing 4K/zoom makes some
// phones choose a poor lens and increases decode latency. These are preferences.
const HIRES = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30, max: 30 },
};

// License scan: PDF417 only. Never QR — that would re-read the pairing QR.
const LICENSE_FORMATS = ["pdf417"];

// Best-effort continuous autofocus (advanced constraint; support varies).
async function optimizeCamera(mediaStream) {
  let track = null;
  try { track = mediaStream.getVideoTracks()[0] || null; } catch {}
  if (!track) return null;
  let caps = {};
  try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch {}
  if (caps.focusMode && caps.focusMode.includes("continuous")) {
    try {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    } catch {}
  }
  updateTorchButton(caps.torch ? track : null);
  return track;
}

function readTrackSettings(track) {
  try { return track && track.getSettings ? track.getSettings() : {}; } catch {
    return {};
  }
}

function waitForVideoFrame(video, timeoutMs = 2500) {
  if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("loadeddata", finish);
      resolve(Boolean(video.videoWidth && video.videoHeight));
    };
    video.addEventListener("loadeddata", finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

function updateTorchButton(track) {
  const button = el("torchBtn");
  if (!button) return;
  button.classList.toggle("hidden", !track);
  button.disabled = !track;
  button.textContent = "Light";
  button.setAttribute(
    "aria-label",
    torchEnabled ? "Turn camera light off" : "Turn camera light on"
  );
  button.setAttribute("aria-pressed", String(torchEnabled));
  button.classList.toggle("is-active", torchEnabled);
}

function rejectHint(reason) {
  if (reason === "incomplete") {
    return "Hold steady…";
  }
  if (reason === "not-aamva") {
    return "Show the large, wide second barcode on the right — directly under the thin one.";
  }
  return "Try again in better light.";
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
  if (message === "camera-not-ready") {
    return "The camera opened but did not provide a usable picture. Close other camera apps, then tap Try camera again.";
  }
  if (message === "camera-start-timeout") {
    return "The camera permission request timed out. Tap Try camera again and choose Allow, or use a photo instead.";
  }
  if (message === "scanner-frame-failed") {
    return "The scanner lost the camera picture. Tap Try camera again, or use a photo instead.";
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

function photoErrorMessage(reason) {
  if (reason === "photo-too-large") {
    return `That photo is too large. Choose a photo under ${Math.round(PHOTO_LIMITS.maxBytes / 1024 / 1024)} MB or crop it to the barcode.`;
  }
  if (reason === "photo-too-many-pixels") {
    return "That photo is too high-resolution to process safely on this phone. Crop it to the barcode or choose a standard-resolution copy.";
  }
  if (reason === "photo-not-image" || reason === "photo-empty") {
    return "That file is not a usable photo. Choose an image of the back of the license or state ID.";
  }
  if (reason === "photo-decode-timeout") {
    return "Reading that photo took too long. Crop it to the wide barcode, choose a smaller photo, or try the camera.";
  }
  return "That photo could not be read. Choose another photo or try the camera again.";
}

async function getCommercialProvider() {
  const fallback = { provider: null, reason: "commercial-initialization-timeout" };
  try {
    return await resolveBeforeTimeout(
      commercialProviderReady,
      COMMERCIAL_READY_TIMEOUT_MS,
      fallback
    );
  } catch {
    return { provider: null, reason: "commercial-initialization-failed" };
  }
}

function pairingConfigurationIssue() {
  const pairingState = classifyPairingState(sessionId, keyB64);
  if (pairingState === "partial" && sessionId) {
    return "This pairing link is missing its encryption key. Scan a new QR code from Compliance Central.";
  }
  if (pairingState === "partial" && keyB64) {
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

function visibleVideoCrop(video) {
  const viewport = video.parentElement;
  if (!viewport || !video.videoWidth || !video.videoHeight) return null;
  const viewportRect = viewport.getBoundingClientRect();
  return mapGuideToVideoPixels({
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    viewportWidth: viewportRect.width,
    viewportHeight: viewportRect.height,
    guideLeft: 0,
    guideTop: 0,
    guideWidth: viewportRect.width,
    guideHeight: viewportRect.height,
    padding: 0,
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
  // Preserve narrow PDF417 modules when a large camera frame is downscaled.
  context.imageSmoothingEnabled = false;
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
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const targetWidth = Math.max(1, Math.ceil(source.width * cos + source.height * sin));
  const targetHeight = Math.max(1, Math.ceil(source.width * sin + source.height * cos));
  if (target.width !== targetWidth) target.width = targetWidth;
  if (target.height !== targetHeight) target.height = targetHeight;
  const context = target.getContext("2d", { alpha: false, willReadFrequently: true });
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, target.width, target.height);
  context.translate(target.width / 2, target.height / 2);
  context.rotate(radians);
  context.imageSmoothingEnabled = false;
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

async function detectNativeCandidates(nativeDetector, source) {
  if (!nativeDetector || !source) return [];
  try {
    const codes = await nativeDetector.detect(source);
    return rankDecodedPayloads(
      (codes || [])
        .filter((code) =>
          code &&
          code.rawValue &&
          (!code.format || String(code.format).toLowerCase() === "pdf417")
        )
        .map((code) => code.rawValue)
    );
  } catch {
    return [];
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

/**
 * Free decoder path: native acceleration when the browser explicitly supports
 * PDF417, then ZXing-C++ WASM. The older pure-JS reader is throttled as a final
 * fallback because repeated synchronous misses can freeze a phone UI.
 */
async function decodeCanvasCandidates(
  canvas,
  context,
  {
    nativeDetector,
    zxingReader,
    hints,
    jsMode = 0,
    useWasm = true,
    useJsFallback = false,
  }
) {
  const candidates = [];

  if (nativeDetector) {
    candidates.push(...await detectNativeCandidates(nativeDetector, canvas));
    if (candidates.length) return rankDecodedPayloads(candidates);
  }

  if (useWasm && wasmReady) {
    const imageData = canvasImageData(canvas, context);
    if (imageData) {
      try {
        const wasmCandidates = await decodePdf417Wasm(imageData);
        candidates.push(...wasmCandidates);
        if (wasmCandidates.length) return rankDecodedPayloads(candidates);
      } catch {}
    }
  }

  if (useJsFallback && zxingReader) {
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
  await commercialProviderTeardown;
  if (gen !== captureGen) throw new Error("cancelled");
  const gate = createDetectionGate(DETECT_COOLDOWN_MS);
  const run = {
    gen,
    provider,
    providerStopPromise: null,
    stopped: false,
    cancel: null,
  };
  activeRun = run;
  el("status").textContent = "Starting scanner…";

  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    const startupTimer = setTimeout(() => {
      if (settled || started) return;
      settled = true;
      reject(new Error("commercial-start-timeout"));
    }, COMMERCIAL_START_TIMEOUT_MS);
    run.cancel = () => {
      if (!settled) {
        settled = true;
        clearTimeout(startupTimer);
        reject(new Error("cancelled"));
      }
    };

    const onCandidates = (candidates) => {
      if (settled || run.stopped || gen !== captureGen) return;
      for (const raw of rankDecodedPayloads(candidates)) {
        const verdict = gate.evaluate(raw);
        if (verdict.ok) {
          settled = true;
          clearTimeout(startupTimer);
          resolve(verdict);
          return;
        }
        if (verdict.reason === "incomplete") {
          el("status").textContent = "Reading barcode…";
          if (DEBUG) {
            diag(`provider Dynamsoft · partial len ${raw.length}`);
          }
        }
      }
    };

    provider.start(onCandidates).then(() => {
      started = true;
      clearTimeout(startupTimer);
      if (settled || run.stopped || gen !== captureGen) {
        run.providerStopPromise = queueCommercialProviderStop(provider);
        return;
      }
      el("status").textContent = "";
      diag("provider Dynamsoft · camera ready");
    }).catch((error) => {
      if (!settled) {
        settled = true;
        clearTimeout(startupTimer);
        reject(error);
      }
    });
  });
}

async function scanLicenseBarcode(gen) {
  const commercial = await getCommercialProvider();
  if (gen !== captureGen) throw new Error("cancelled");
  if (commercial.provider) {
    try {
      return await scanCommercialLicenseBarcode(commercial.provider, gen);
    } catch (error) {
      if (error && error.message === "cancelled") throw error;
      await stopCamera();
      if (gen !== captureGen) throw new Error("cancelled");
      diag(`Dynamsoft unavailable (${commercial.reason || error.message || "start failed"}) · fallback zxing`);
      el("status").textContent = "Starting scanner…";
    }
  } else {
    diag(`provider zxing · ${commercial.reason || "commercial unavailable"}`);
  }
  return scanOpenSourceLicenseBarcode(gen);
}

async function scanOpenSourceLicenseBarcode(gen) {
  if (gen !== captureGen) throw new Error("cancelled");
  const video = el("video");
  let attempts = 0;
  let lastHintAt = 0;
  let lastHintReason = "";
  let nearMissFrames = 0;
  let lastNearMissAttempt = -1;
  let lastRawLen = 0;
  let lastReject = "";
  let lastCodes = "";
  let consecutiveFrameErrors = 0;
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
    lastRawLen = String(raw || "").length;
    const verdict = gate.evaluate(raw);
    if (verdict.ok) {
      lastReject = "accept";
      lastCodes = aamvaElementCodes(raw).join(" ");
      return verdict;
    }
    const reason =
      verdict.reason === "duplicate" ? verdict.originalReason : verdict.reason;
    lastReject = verdict.reason;
    lastCodes = looksLikeAamva(raw) ? aamvaElementCodes(raw).join(" ") : "";
    if (reason === "incomplete") {
      if (lastNearMissAttempt !== attempts) {
        nearMissFrames++;
        lastNearMissAttempt = attempts;
      }
      if (nearMissFrames < PARTIAL_HINT_THRESHOLD) {
        el("status").textContent = "Reading barcode…";
        diag(
          `partial len ${lastRawLen}` +
            (lastCodes ? ` · codes ${lastCodes}` : "") +
            ` · tries ${attempts}`
        );
        return verdict;
      }
    }
    if (verdict.reason === "duplicate" && reason !== "incomplete") return verdict;
    const now = Date.now();
    if (reason !== lastHintReason || now - lastHintAt >= DETECT_COOLDOWN_MS) {
      const hint = rejectHint(reason);
      el("status").textContent = hint;
      lastHintAt = now;
      lastHintReason = reason;
    }
    diag(
      `rejected (${verdict.reason}) · len ${lastRawLen}` +
        (lastCodes ? ` · codes ${lastCodes}` : "") +
        ` · tries ${attempts}`
    );
    return verdict;
  };

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("camera-unsupported");
  }

  // Start camera immediately. WASM warms in the background only.
  const wasmWarm = resolveBeforeTimeout(
    ensureWasmReader(),
    WASM_READY_TIMEOUT_MS,
    false
  ).catch(() => false).then((ok) => {
    wasmReady = ok;
    return ok;
  });

  let nativeDetector = await createNativePdf417Detector();
  if (run.stopped || gen !== captureGen) throw new Error("cancelled");

  el("status").textContent = "Starting camera…";
  const cameraRequest = createCameraRequest(
    (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    { audio: false, video: HIRES },
    {
      timeoutMs: CAMERA_START_TIMEOUT_MS,
      isCancelled: () => run.stopped || gen !== captureGen,
    }
  );
  run.cancel = cameraRequest.cancel;
  run.stream = await cameraRequest.promise;
  if (run.cancel === cameraRequest.cancel) run.cancel = null;
  if (run.stopped || gen !== captureGen) {
    stopCamera(run);
    throw new Error("cancelled");
  }
  video.srcObject = run.stream;
  await video.play();
  if (!await waitForVideoFrame(video)) {
    stopCamera(run);
    throw new Error("camera-not-ready");
  }
  const track = await optimizeCamera(run.stream);
  const settings = readTrackSettings(track);
  el("status").textContent = "";
  diag(`camera ready · wasm warming`);

  // Do not stall camera startup on compilation. The throttled JS/native path
  // can begin while the version-matched local WASM reader finishes warming.
  wasmWarm.then((ok) => {
    wasmReady = ok;
    if (ok) diag(`wasm ready · cam ${settings.width || "?"}×${settings.height || "?"}`);
  });
  if (!nativeDetector && typeof ZXing === "undefined") {
    wasmReady = await wasmWarm;
    if (!wasmReady) {
      stopCamera(run);
      throw new Error("scanner-library-unavailable");
    }
  }

  const { reader: zxingReader, hints } = createJsPdf417Reader();
  run.reader = zxingReader;
  if (!zxingReader && !nativeDetector && !wasmReady) {
    stopCamera(run);
    throw new Error("scanner-library-unavailable");
  }

  const canvas = document.createElement("canvas");
  const rotatedCanvas = document.createElement("canvas");
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastFrameFinishedAt = Number.NEGATIVE_INFINITY;
    let decoding = false;
    run.cancel = () => {
      if (!settled) {
        settled = true;
        reject(new Error("cancelled"));
      }
    };

    const finishIfAccepted = (raw) => {
      const outcome = tryAccept(raw);
      if (!outcome.ok) return false;
      settled = true;
      resolve(outcome);
      diag(`ACCEPT len ${String(raw || "").length} · ${aamvaElementCodes(raw).join(" ")}`);
      return true;
    };

    const tick = async (now) => {
      if (settled || run.stopped || gen !== captureGen) return;
      if (
        decoding ||
        !decodeIntervalElapsed(now, lastFrameFinishedAt, FRAME_INTERVAL_MS)
      ) {
        run.rafId = requestAnimationFrame(tick);
        return;
      }
      attempts++;
      decoding = true;

      try {
        // Native BarcodeDetector can inspect the video directly, avoiding a
        // canvas copy and finding PDF417 anywhere in the camera frame.
        if (nativeDetector) {
          const nativeCandidates = await resolveBeforeTimeout(
            detectNativeCandidates(nativeDetector, video),
            LIVE_DECODE_TIMEOUT_MS,
            LIVE_DECODE_TIMEOUT_RESULT
          );
          if (nativeCandidates === LIVE_DECODE_TIMEOUT_RESULT) {
            // Native detection is only an accelerator. If a browser's
            // implementation stalls, disable it for this run and keep the
            // bounded WASM/JS fallback alive instead of restarting the camera.
            nativeDetector = null;
            diag("native detector timed out · continuing with wasm");
          } else {
            for (const text of nativeCandidates) {
              if (finishIfAccepted(text)) return;
            }
          }
        }

        const guide = guideCrop(video, 0.04);
        const visible = visibleVideoCrop(video);
        const plan = buildLiveDecodePlan(
          guide,
          visible,
          attempts,
          video.videoWidth,
          video.videoHeight
        );
        if (!plan) {
          return;
        }
        const crop = plan.crop;
        const cropScale = plan.angle
          ? Math.min(1, MAX_DESKEW_WIDTH / crop.width)
          : 1;
        drawCropFrame(video, canvas, crop, cropScale);
        const decodeTarget = plan.angle ? rotatedCanvas : canvas;
        const context = plan.angle
          ? rotateCanvas(canvas, rotatedCanvas, plan.angle)
          : canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        const candidates = await resolveBeforeTimeout(
          decodeCanvasCandidates(decodeTarget, context, {
            // The native path already searched the full video above.
            nativeDetector: null,
            zxingReader,
            hints,
            jsMode: attempts % 3,
            useWasm: wasmReady,
            useJsFallback:
              attempts % JS_FALLBACK_EVERY_N === 0 ||
              (!wasmReady && attempts % 2 === 0),
          }),
          LIVE_DECODE_TIMEOUT_MS,
          LIVE_DECODE_TIMEOUT_RESULT
        );
        if (candidates === LIVE_DECODE_TIMEOUT_RESULT) {
          // A slow WASM call must not end the whole scan on an older iPhone.
          // Stop starting new WASM work for this run and continue with the
          // throttled pure-JS reader while the timed-out call settles.
          wasmReady = false;
          el("status").textContent = "Hold steady…";
          diag("wasm frame timed out · continuing with js fallback");
          return;
        }
        consecutiveFrameErrors = 0;
        for (const text of candidates) {
          if (finishIfAccepted(text)) return;
        }

        if (attempts % 8 === 0) {
          diag(
            `${nativeDetector ? "native+" : ""}${wasmReady ? "wasm" : "js fallback"}` +
              ` · ROI ${canvas.width}×${canvas.height}` +
              ` · crop ${crop.width}×${crop.height}` +
              ` · ${plan.label}${plan.angle ? ` ${plan.angle}°` : ""}` +
              ` · lastLen ${lastRawLen || 0}` +
              (lastReject ? ` · ${lastReject}` : "") +
              (lastCodes ? ` · ${lastCodes}` : "") +
              ` · cam ${settings.width || video.videoWidth || "?"}×${settings.height || video.videoHeight || "?"}` +
              ` · tries ${attempts}`
          );
        }
      } catch {
        if (!settled && !run.stopped && gen === captureGen) {
          consecutiveFrameErrors++;
          if (consecutiveFrameErrors >= 5) {
            settled = true;
            reject(new Error("scanner-frame-failed"));
          } else {
            el("status").textContent = "Hold steady…";
            diag(`camera frame retry ${consecutiveFrameErrors}/5`);
          }
        }
      } finally {
        decoding = false;
        lastFrameFinishedAt = performance.now();
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
  const stopPromise = stopCamera();
  clearError();
  const pairingIssue = pairingConfigurationIssue();
  const contextIssue = waitForGesture ? browseContextIssue() : "";
  el("captureHeading").textContent =
    which === "buyer"
      ? "Scan the back of the buyer's ID"
      : "Scan the back of the co-buyer's ID";
  show("camera");
  el("status").textContent = "Starting camera…";

  if (pairingIssue) {
    showError(pairingIssue);
    el("status").textContent = "This scanner link is incomplete. Open a new QR code on your computer.";
    el("startBtn").classList.add("hidden");
    el("photoBtn").disabled = true;
    await stopPromise;
    return;
  }
  el("photoBtn").disabled = false;
  if (contextIssue) showError(contextIssue);

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
  await stopPromise;
  if (gen !== captureGen) return;

  // Warm WASM in parallel — never block or abort camera on loader failure.
  ensureWasmReader().then((ok) => {
    wasmReady = ok;
  }).catch(() => {
    wasmReady = false;
  });

  try {
    const { person, raw } = await scanLicenseBarcode(gen);
    if (gen !== captureGen) return;
    await stopCamera();
    if (gen !== captureGen) return;
    pending = person;
    renderReview(person);
    const rd = el("reviewDiag");
    if (DEBUG && rd) {
      const lf = (raw.match(/\n/g) || []).length;
      rd.textContent = `${SCANNER_BUILD} · codes: ${aamvaElementCodes(raw).join(" ")} · len ${raw.length} · lf ${lf}`;
    }
    clearError();
    show("review");
  } catch (e) {
    if (gen !== captureGen) return;
    await stopCamera();
    if (gen !== captureGen) return;
    const msg = e && e.message ? e.message : "unable to access camera.";
    if (msg === "cancelled") return;
    showError(cameraErrorMessage(e));
    el("status").textContent = "";
    el("startBtn").textContent = "Try camera again";
    el("startBtn").classList.remove("hidden");
  }
}

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (!error) {
        resolve({ image, url });
        return;
      }
      URL.revokeObjectURL(url);
      reject(error);
    };
    const timer = setTimeout(
      () => finish(new Error("photo-load-timeout")),
      PHOTO_LOAD_TIMEOUT_MS
    );
    image.onload = () => finish(null);
    image.onerror = () => finish(new Error("photo-load-failed"));
    image.src = url;
  });
}

async function decodePhoto(file) {
  const gen = ++captureGen;
  const stopPromise = stopCamera();
  clearError();
  show("camera");
  el("startBtn").classList.add("hidden");
  el("photoBtn").disabled = true;
  el("status").textContent = "Reading photo…";

  let loaded = null;
  let zxingReader = null;
  let commercialNearMiss = "";
  const decodeStartedAt = performance.now();
  const remainingDecodeBudget = () =>
    Math.max(0, PHOTO_DECODE_BUDGET_MS - (performance.now() - decodeStartedAt));
  const checkDecodeBudget = () => {
    if (remainingDecodeBudget() <= 0) {
      throw new Error("photo-decode-timeout");
    }
  };
  const awaitWithinDecodeBudget = async (promise) => {
    checkDecodeBudget();
    const timedOut = Object.freeze({ timedOut: true });
    const result = await resolveBeforeTimeout(
      promise,
      remainingDecodeBudget(),
      timedOut
    );
    if (result === timedOut) throw new Error("photo-decode-timeout");
    return result;
  };
  try {
    await stopPromise;
    if (gen !== captureGen) return;
    const fileCheck = validatePhotoFile(file);
    if (!fileCheck.ok) throw new Error(fileCheck.reason);

    loaded = await loadPhoto(file);
    if (gen !== captureGen) return;
    const dimensionCheck = validatePhotoDimensions(
      loaded.image.naturalWidth,
      loaded.image.naturalHeight
    );
    if (!dimensionCheck.ok) throw new Error(dimensionCheck.reason);
    checkDecodeBudget();
    const directPhotoDecode =
      dimensionCheck.pixels <= PHOTO_LIMITS.maxDirectDecodePixels;

    const commercial = await getCommercialProvider();
    if (gen !== captureGen) return;
    if (commercial.provider && directPhotoDecode) {
      try {
        const candidates = rankDecodedPayloads(
          await resolveBeforeTimeout(
            commercial.provider.decodeImage(file),
            Math.min(COMMERCIAL_PHOTO_TIMEOUT_MS, remainingDecodeBudget()),
            []
          )
        );
        if (gen !== captureGen) return;
        checkDecodeBudget();
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

    if (gen !== captureGen) return;
    wasmReady = await awaitWithinDecodeBudget(ensureWasmReader());
    if (gen !== captureGen) return;
    checkDecodeBudget();
    if (wasmReady && directPhotoDecode) {
      const fileCandidates = rankDecodedPayloads(
        await awaitWithinDecodeBudget(decodePdf417File(file))
      );
      if (gen !== captureGen) return;
      checkDecodeBudget();
      for (const raw of fileCandidates) {
        const verdict = evaluateDetection(raw);
        if (verdict.ok) {
          pending = verdict.person;
          renderReview(verdict.person);
          clearError();
          diag(`wasm original photo · len ${raw.length}`);
          show("review");
          return;
        }
        if (raw.length > commercialNearMiss.length) commercialNearMiss = raw;
      }
      diag("wasm original photo miss · trying canvas variants");
    } else if (!directPhotoDecode) {
      diag("large photo · skipping full-resolution decoder copy");
    }

    const nativeDetector = await awaitWithinDecodeBudget(
      createNativePdf417Detector()
    );
    if (gen !== captureGen) return;
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
    // buildDecodeCrops always leads with the full image, so a loosely framed
    // barcode is still searched before the focused lower-band variants.
    const canvas = document.createElement("canvas");
    const rotatedCanvas = document.createElement("canvas");
    let bestNearMiss = commercialNearMiss;

    for (const crop of crops) {
      if (gen !== captureGen) return;
      checkDecodeBudget();
      drawCropFrame(source, canvas, crop);
      for (const angle of [0, -6, 6, -10, 10]) {
        checkDecodeBudget();
        const decodeTarget = angle ? rotatedCanvas : canvas;
        const context = angle
          ? rotateCanvas(canvas, rotatedCanvas, angle)
          : canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        const candidates = await awaitWithinDecodeBudget(
          decodeCanvasCandidates(decodeTarget, context, {
            nativeDetector,
            zxingReader,
            hints: js.hints,
            jsMode: 0,
            useWasm: true,
            useJsFallback: true,
          })
        );
        if (gen !== captureGen) return;
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
      : "The large, wide second barcode was not found. Try a sharp, well-lit photo of the back of the license or state ID.";
    el("status").textContent = "Photo scan unsuccessful.";
    showError(message);
    el("startBtn").textContent = "Try camera again";
    el("startBtn").classList.remove("hidden");
  } catch (error) {
    if (gen !== captureGen) return;
    const message = error && error.message === "scanner-library-unavailable"
      ? cameraErrorMessage(error)
      : photoErrorMessage(error && error.message);
    el("status").textContent = "Photo could not be read.";
    showError(message);
    el("startBtn").textContent = "Try camera again";
    el("startBtn").classList.remove("hidden");
  } finally {
    if (zxingReader) {
      try { zxingReader.reset(); } catch {}
    }
    if (loaded) URL.revokeObjectURL(loaded.url);
    el("photoBtn").disabled = false;
  }
}

function onConfirm() {
  const result = commitPendingScan(deal, capturing, pending);
  if (!result.ok) {
    if (result.reason === "duplicate-license") {
      showError("Buyer and co-buyer have the same license number. Rescan the co-buyer's license before continuing.");
    }
    return;
  }
  pending = null;
  if (capturing === "buyer") {
    show("cobuyer");
  } else {
    finish();
  }
}

function deliveryError(message, retryable) {
  const error = new Error(message);
  error.retryable = retryable;
  return error;
}

function relayFailure(status) {
  if (status === 400) {
    return deliveryError(
      "The pairing was already received or expired. Check the computer; if the fields did not fill, open a new scanner QR code.",
      false
    );
  }
  if (status === 404 || status === 410) {
    return deliveryError(
      "The pairing session expired or is no longer available. Open a new scanner QR code on your computer.",
      false
    );
  }
  if (status === 409) {
    return deliveryError(
      "This pairing session was already used. Check the computer before starting a new pairing.",
      false
    );
  }
  if (status === 429) {
    return deliveryError(
      "The relay is receiving too many requests. Wait a moment, then retry.",
      true
    );
  }
  if (status >= 500) {
    return deliveryError(
      "The relay service is temporarily unavailable. Retry in a moment.",
      true
    );
  }
  return deliveryError("The relay could not accept the scan.", false);
}

async function deliverPayload(payload, generation) {
  const delivery = el("deliveryStatus");
  const retry = el("retrySendBtn");
  clearError();
  if (retry) {
    retry.disabled = true;
    retry.classList.add("hidden");
  }
  if (delivery) delivery.textContent = "Encrypting and sending to your computer…";

  if (activeDeliveryController) activeDeliveryController.abort();
  const controller = new AbortController();
  activeDeliveryController = controller;
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    let blob;
    try {
      blob = await encryptPayload(keyB64, payload);
    } catch {
      throw deliveryError(
        "The pairing encryption key is invalid. Open a new scanner QR code on your computer.",
        false
      );
    }

    const res = await fetch(
      `${RELAY_BASE}/pair/${encodeURIComponent(sessionId)}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(blob),
        signal: controller.signal,
      }
    );
    if (!res.ok) throw relayFailure(res.status);
    if (generation !== deliveryGeneration) return;
    if (delivery) delivery.textContent = "Sent securely — return to your computer.";
  } catch (error) {
    if (generation !== deliveryGeneration) return;
    const message = controller.signal.aborted
      ? "Sending timed out. Check the connection and retry — you do not need to scan the license again."
      : error && error.message
        ? error.message
        : "The network request failed. Check the connection and retry.";
    if (delivery) delivery.textContent = "Not sent yet.";
    showError(message);
    const canRetry = controller.signal.aborted || error?.retryable !== false;
    if (retry && canRetry) {
      retry.disabled = false;
      retry.classList.remove("hidden");
    }
  } finally {
    clearTimeout(timeout);
    if (activeDeliveryController === controller) activeDeliveryController = null;
  }
}

async function finish() {
  // Guard: same license scanned twice.
  if (deal.coBuyer && deal.buyer && hasSameLicenseNumber(deal.buyer, deal.coBuyer)) {
    showError("Buyer and co-buyer have the same license number — did you scan the same card twice?");
    return;
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
  const delivery = el("deliveryStatus");
  if (delivery) {
    delivery.textContent =
      sessionId && keyB64
        ? "Preparing secure delivery…"
        : "Scan complete. This page was opened without a computer pairing.";
  }
  el("startOverBtn").classList.toggle("hidden", Boolean(sessionId && keyB64));
  el("retrySendBtn").classList.add("hidden");
  show("done");

  if (sessionId && keyB64) {
    const generation = ++deliveryGeneration;
    await deliverPayload(lastPayload, generation);
  }
}

function resetAll() {
  deliveryGeneration++;
  if (activeDeliveryController) activeDeliveryController.abort();
  activeDeliveryController = null;
  deal.buyer = null;
  deal.coBuyer = null;
  pending = null;
  lastPayload = null;
  capturing = "buyer";
  el("startOverBtn").classList.remove("hidden");
  el("retrySendBtn").classList.add("hidden");
  clearError();
  beginCapture("buyer");
}

el("confirmBtn").addEventListener("click", onConfirm);
el("rescanBtn").addEventListener("click", () => beginCapture(capturing));
el("yesCoBuyerBtn").addEventListener("click", () => beginCapture("coBuyer"));
el("noCoBuyerBtn").addEventListener("click", finish);
el("startOverBtn").addEventListener("click", resetAll);
el("retrySendBtn").addEventListener("click", () => {
  if (!lastPayload || !sessionId || !keyB64) return;
  const generation = ++deliveryGeneration;
  deliverPayload(lastPayload, generation);
});
el("startBtn").addEventListener("click", () => {
  el("startBtn").classList.add("hidden");
  // Explicit user gesture — always attempt getUserMedia from here.
  beginCapture(capturing, { waitForGesture: false });
});
el("photoBtn").addEventListener("click", () => {
  choosingPhoto = true;
  captureGen++;
  stopCamera();
  el("status").textContent = "Choose a photo of the back of the license or state ID…";
  el("photoInput").click();
});
el("photoInput").addEventListener("change", (event) => {
  choosingPhoto = false;
  const input = event.currentTarget;
  const file = input.files && input.files[0];
  input.value = "";
  if (file) decodePhoto(file);
});
el("photoInput").addEventListener("cancel", () => {
  choosingPhoto = false;
  if (screens.camera.classList.contains("hidden") || activeRun) return;
  el("status").textContent = "No photo selected. Tap Try camera again or choose a photo.";
  el("startBtn").textContent = "Try camera again";
  el("startBtn").classList.remove("hidden");
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
  deliveryGeneration++;
  if (activeDeliveryController) activeDeliveryController.abort();
  activeDeliveryController = null;
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
