import {
  aamvaElementCodes,
  evaluateDetection,
  looksLikeAamva,
  rankDecodedPayloads,
} from "./lib/aamva.js?v=20260717-7";
import { encryptPayload } from "./lib/crypto-pair.js";
import { classifyBrowseContext } from "./lib/scan-context.js?v=20260717-7";
import {
  decodeImageDataFree,
  warmupDecodeWorker,
} from "./lib/scan-decode-client.js?v=20260717-7";
import { createDetectionGate } from "./lib/scan-state.js?v=20260717-7";
import {
  buildDecodeCrops,
  buildPhotoDecodeCrops,
  mapGuideToVideoPixels,
} from "./lib/scan-roi.js?v=20260717-7";
import { ensureWasmReader } from "./lib/zxing-wasm-loader.js?v=20260717-7";
import { createCommercialScannerProvider } from "./lib/scanner-provider.js?v=20260717-7";

const RELAY_BASE = "https://compliance-central-api.fly.dev";
const SCANNER_BUILD = "scanner-2026-07-17.7-free";

const params = new URLSearchParams(location.search);
const sessionId = params.get("s") || "";
const keyB64 = new URLSearchParams(location.hash.slice(1)).get("k") || "";
const DEBUG = params.has("debug");

const DETECT_COOLDOWN_MS = 1800;
const FRAME_INTERVAL_MS = 120;
const MAX_PHOTO_DECODE_WIDTH = 3200;
const MAX_LIVE_DECODE_WIDTH = 1800;
const PARTIAL_HINT_THRESHOLD = 4;
const LIVE_PIPELINES = ["raw", "stretch", "stretch-unsharp"];
const PHOTO_PIPELINES = undefined; // use default aggressive set
const DESKEW_ANGLES = [0, -4, 4, -8, 8, -12, 12];

const el = (id) => document.getElementById(id);
const screens = {
  camera: el("cameraScreen"),
  review: el("reviewScreen"),
  cobuyer: el("cobuyerPrompt"),
  done: el("doneScreen"),
};

// Dynamsoft stays dormant unless scanner-config has a real key.
let commercialProviderPromise = null;
function getCommercialProvider() {
  if (!commercialProviderPromise) {
    commercialProviderPromise = createCommercialScannerProvider({
      mount: el("video").parentElement,
    });
  }
  return commercialProviderPromise;
}

const deal = { buyer: null, coBuyer: null };
let capturing = "buyer";
let pending = null;
let captureGen = 0;
let activeRun = null;
let resumeAfterVisibility = false;
let torchEnabled = false;
let wasmReady = false;
let choosingPhoto = false;
let liveMode = false;

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

function setPhotoUiVisible(visible) {
  const photoFirst = el("photoFirst");
  const livePanel = el("livePanel");
  if (photoFirst) photoFirst.classList.toggle("hidden", !visible);
  if (livePanel) livePanel.classList.toggle("hidden", visible);
  liveMode = !visible;
}

function setStatus(msg) {
  const photoStatus = el("photoStatus");
  const status = el("status");
  if (!liveMode && photoStatus) photoStatus.textContent = msg;
  if (status) status.textContent = msg;
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

function diag(msg) {
  if (!DEBUG) return;
  const d = el("diag");
  if (d) d.textContent = `${SCANNER_BUILD} · ${msg}`;
}

const HIRES = {
  facingMode: { ideal: "environment" },
  width: { ideal: 3840 },
  height: { ideal: 2160 },
  aspectRatio: { ideal: 16 / 9 },
};

const LICENSE_FORMATS = ["pdf417"];

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
    return "Barcode detected — still decoding. Hold steady on the wide barcode.";
  }
  if (reason === "not-aamva") {
    return "Point at the wide barcode on the back (not a QR code or the thin 1D line).";
  }
  return "Couldn't read that barcode. Try a clear photo instead.";
}

function cameraErrorMessage(error) {
  const name = error && error.name;
  const message = error && error.message;
  if (message === "camera-unsupported") {
    return "This browser does not support camera scanning. Use Capture photo, or open Safari/Chrome on a phone.";
  }
  if (message === "scanner-library-unavailable") {
    return "The barcode scanner did not load. Check your connection, reload, and try a photo.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow camera access, or use Capture photo instead.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No usable camera was found. Use Capture photo or Use a photo.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is busy in another app. Close it, or use Capture photo.";
  }
  if (name === "OverconstrainedError") {
    return "This camera could not use the requested settings. Try Capture photo.";
  }
  return "The camera could not start. Try Capture photo instead.";
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
    return "Open this link in Safari or Chrome (not inside another app), then capture a photo of the barcode.";
  }
  if (ctx.tinyPopup) {
    return "Open this link in a full Safari or Chrome tab, then capture a photo of the barcode.";
  }
  return "";
}

function promoteToTopLevelIfNeeded() {
  const ctx = classifyBrowseContext(window);
  if (!ctx.embedded) return false;
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = location.href;
      return true;
    }
  } catch {
    // Cross-origin parent
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

function drawCropFrame(source, canvas, crop, maxWidth) {
  const targetWidth = Math.max(
    1,
    Math.round(Math.min(maxWidth, crop.width))
  );
  const targetHeight = Math.max(1, Math.round((targetWidth * crop.height) / crop.width));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
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
  if (!degrees) {
    return source.getContext("2d", { alpha: false, willReadFrequently: true });
  }
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
  { nativeDetector, zxingReader, hints, jsMode = 0, pipelines, scales }
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

  const imageData = canvasImageData(canvas, context);
  if (imageData) {
    try {
      candidates.push(
        ...(await decodeImageDataFree(imageData, { pipelines, scales }))
      );
    } catch {}
  }

  if (zxingReader) {
    try {
      const result = decodePdf417CanvasJs(zxingReader, canvas, hints, jsMode);
      if (result && result.getText()) candidates.push(result.getText());
    } catch {
      // miss expected
    } finally {
      try { zxingReader.reset(); } catch {}
    }
  }

  return rankDecodedPayloads(candidates);
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function scanCommercialLicenseBarcode(provider, gen) {
  const gate = createDetectionGate(DETECT_COOLDOWN_MS);
  const run = {
    gen,
    provider,
    stopped: false,
    cancel: null,
  };
  activeRun = run;
  setStatus("Starting optional commercial scanner…");

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
          setStatus("Barcode detected — decoding the full license…");
          if (DEBUG) diag(`provider Dynamsoft · partial len ${raw.length}`);
        }
      }
    };

    provider.start(onCandidates).then(() => {
      if (settled || run.stopped || gen !== captureGen) return;
      setStatus("Point at the wide barcode on the back…");
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
  const commercial = await getCommercialProvider();
  if (commercial.provider) {
    try {
      return await scanCommercialLicenseBarcode(commercial.provider, gen);
    } catch (error) {
      if (error && error.message === "cancelled") throw error;
      stopCamera();
      diag(`commercial unavailable (${commercial.reason || error.message || "start failed"}) · free scanner`);
      setStatus("Starting live scan…");
    }
  } else if (DEBUG) {
    diag(`provider free · ${commercial.reason || "zxing"}`);
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
        setStatus("Barcode detected — decoding…");
        return verdict;
      }
    }
    if (verdict.reason === "duplicate" && reason !== "incomplete") return verdict;
    const now = Date.now();
    if (reason !== lastHintReason || now - lastHintAt >= DETECT_COOLDOWN_MS) {
      const hint = rejectHint(reason);
      setStatus(hint);
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

  const wasmWarm = ensureWasmReader().then((ok) => {
    wasmReady = ok;
    return ok;
  });
  warmupDecodeWorker().catch(() => {});

  const nativeDetector = await createNativePdf417Detector();
  if (run.stopped || gen !== captureGen) throw new Error("cancelled");

  setStatus("Requesting camera…");
  run.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: HIRES });
  if (run.stopped || gen !== captureGen) {
    stopCamera(run);
    throw new Error("cancelled");
  }
  video.srcObject = run.stream;
  await video.play();
  const track = await optimizeCamera(run.stream);
  const settings = track && track.getSettings ? track.getSettings() : {};
  setStatus("Center the wide barcode in the yellow frame…");

  wasmReady = await wasmWarm;
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

        const crops = buildDecodeCrops(guide, attempts, video.videoWidth);
        const deskewAngles = [0, -6, 6, -10, 10];

        for (const crop of crops) {
          if (settled || run.stopped || gen !== captureGen) break;
          drawCropFrame(video, canvas, crop, MAX_LIVE_DECODE_WIDTH);
          const angle = deskewAngles[attempts % deskewAngles.length];
          const decodeTarget = angle ? rotatedCanvas : canvas;
          const context = angle
            ? rotateCanvas(canvas, rotatedCanvas, angle)
            : canvas.getContext("2d", { alpha: false, willReadFrequently: true });
          const candidates = await decodeCanvasCandidates(decodeTarget, context, {
            nativeDetector,
            zxingReader,
            hints,
            jsMode: attempts % 2,
            pipelines: LIVE_PIPELINES,
            scales: [1],
          });
          for (const text of candidates) {
            if (finishIfAccepted(text)) return;
          }
        }

        if (attempts % 12 === 0) {
          diag(
            `free · ${nativeDetector ? "native+" : ""}${wasmReady ? "wasm+" : ""}js` +
              ` · ROI ${canvas.width}×${canvas.height}` +
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

function showPhotoReady(which) {
  capturing = which;
  stopCamera();
  clearError();
  const pairingIssue = pairingConfigurationIssue();
  const contextIssue = browseContextIssue();
  if (pairingIssue) showError(pairingIssue);
  else if (contextIssue) showError(contextIssue);
  el("captureHeading").textContent =
    which === "buyer" ? "Scan the buyer's license" : "Scan the co-buyer's license";
  show("camera");
  setPhotoUiVisible(true);
  setStatus("Take a clear photo of the wide barcode on the back.");
  el("startBtn").classList.add("hidden");
  diag("photo-first ready");
}

async function beginLiveCapture(which, { waitForGesture = false } = {}) {
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
  setPhotoUiVisible(false);
  setStatus("Starting camera…");

  if (waitForGesture) {
    el("startBtn").textContent = "Start camera";
    el("startBtn").classList.remove("hidden");
    setStatus(contextIssue
      ? "Open in Safari or Chrome, then tap Start camera — or use Capture photo."
      : "Tap Start camera to allow access.");
    return;
  }

  el("startBtn").classList.add("hidden");
  ensureWasmReader().then((ok) => { wasmReady = ok; }).catch(() => { wasmReady = false; });
  warmupDecodeWorker().catch(() => {});

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
    setStatus("Camera did not start — try Capture photo.");
    setPhotoUiVisible(true);
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
  setPhotoUiVisible(true);
  setStatus("Reading photo…");
  diag(`photo decode · ${file && file.size ? `${Math.round(file.size / 1024)}kb` : "file"}`);

  let loaded = null;
  let zxingReader = null;
  let bestNearMiss = "";
  try {
    loaded = await loadPhoto(file);

    // Optional commercial path only when a key is configured — never required.
    const commercial = await getCommercialProvider();
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
          if (raw.length > bestNearMiss.length) bestNearMiss = raw;
        }
        diag("commercial photo miss · free pipeline");
      } catch (error) {
        diag(`commercial photo error (${error.message || "decode failed"}) · free pipeline`);
      }
    }

    wasmReady = await ensureWasmReader();
    warmupDecodeWorker().catch(() => {});
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
    const crops = buildPhotoDecodeCrops(full, source.naturalWidth);
    const canvas = document.createElement("canvas");
    const rotatedCanvas = document.createElement("canvas");
    let tried = 0;

    for (const crop of crops) {
      if (gen !== captureGen) return;
      // Prefer full-resolution crop pixels; only cap extreme phone photos.
      drawCropFrame(source, canvas, crop, MAX_PHOTO_DECODE_WIDTH);
      for (const angle of DESKEW_ANGLES) {
        if (gen !== captureGen) return;
        const decodeTarget = angle ? rotatedCanvas : canvas;
        const context = angle
          ? rotateCanvas(canvas, rotatedCanvas, angle)
          : canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        tried++;
        if (tried % 3 === 0) {
          setStatus(`Reading photo… (${tried} passes)`);
          await yieldToUi();
        }
        const candidates = await decodeCanvasCandidates(decodeTarget, context, {
          nativeDetector,
          zxingReader,
          hints: js.hints,
          jsMode: 0,
          pipelines: PHOTO_PIPELINES,
          scales: [1, 0.85, 1.15],
        });
        for (const raw of candidates) {
          const verdict = evaluateDetection(raw);
          if (verdict.ok) {
            pending = verdict.person;
            renderReview(verdict.person);
            clearError();
            diag(`free photo · len ${raw.length} · ${crop.width}×${crop.height} · ${angle}°`);
            show("review");
            return;
          }
          if (raw.length > bestNearMiss.length) bestNearMiss = raw;
        }
      }
    }

    const message = bestNearMiss
      ? "The barcode was found, but the photo did not contain the full license data. Try another sharp, well-lit photo of the wide barcode."
      : "No license barcode found. Take a sharp, well-lit photo of the wide barcode on the back.";
    setStatus(message);
    showError(message);
  } catch (error) {
    const message =
      error && error.message === "scanner-library-unavailable"
        ? cameraErrorMessage(error)
        : "That photo could not be read. Take another clear photo of the wide barcode.";
    setStatus(message);
    showError(message);
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
  if (deal.coBuyer && deal.buyer && deal.coBuyer.dlnPid === deal.buyer.dlnPid) {
    showError("Buyer and co-buyer have the same license number — did you scan the same card twice?");
    return;
  }
  const payload = {
    buyer: deal.buyer,
    coBuyer: deal.coBuyer || null,
    scannedAt: new Date().toISOString(),
  };
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
  showPhotoReady("buyer");
}

function pickPhoto(input) {
  choosingPhoto = true;
  input.click();
}

function onPhotoPicked(event) {
  choosingPhoto = false;
  const input = event.currentTarget;
  const file = input.files && input.files[0];
  input.value = "";
  if (file) decodePhoto(file);
}

el("confirmBtn").addEventListener("click", onConfirm);
el("rescanBtn").addEventListener("click", () => showPhotoReady(capturing));
el("yesCoBuyerBtn").addEventListener("click", () => showPhotoReady("coBuyer"));
el("noCoBuyerBtn").addEventListener("click", finish);
el("startOverBtn").addEventListener("click", resetAll);
el("capturePhotoBtn").addEventListener("click", () => pickPhoto(el("captureInput")));
el("galleryPhotoBtn").addEventListener("click", () => pickPhoto(el("photoInput")));
el("captureInput").addEventListener("change", onPhotoPicked);
el("photoInput").addEventListener("change", onPhotoPicked);
el("liveScanBtn").addEventListener("click", () => {
  const ctx = classifyBrowseContext(window);
  beginLiveCapture(capturing, { waitForGesture: ctx.constrained });
});
el("stopLiveBtn").addEventListener("click", () => {
  captureGen++;
  stopCamera();
  showPhotoReady(capturing);
});
el("startBtn").addEventListener("click", () => {
  el("startBtn").classList.add("hidden");
  beginLiveCapture(capturing, { waitForGesture: false });
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
    showError("This camera could not change the light setting. Try Capture photo instead.");
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
    resumeAfterVisibility = Boolean(activeRun && liveMode && !screens.camera.classList.contains("hidden"));
    if (resumeAfterVisibility) {
      captureGen++;
      stopCamera();
    }
  } else if (resumeAfterVisibility) {
    resumeAfterVisibility = false;
    beginLiveCapture(capturing);
  }
});

window.addEventListener("pagehide", () => {
  captureGen++;
  stopCamera();
});

if (promoteToTopLevelIfNeeded()) {
  // Navigating the parent frame
} else {
  ensureWasmReader()
    .then((ok) => { wasmReady = ok; })
    .catch(() => { wasmReady = false; });
  warmupDecodeWorker().catch(() => {});
  showPhotoReady("buyer");
}
