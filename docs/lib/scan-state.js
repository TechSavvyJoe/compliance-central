import { evaluateDetection } from "./aamva.js?v=20260717-10";

export const PHOTO_LIMITS = Object.freeze({
  maxBytes: 15 * 1024 * 1024,
  // Large enough for a full-resolution 48 MP phone photo, while avoiding
  // unbounded decoder/canvas allocations on mobile devices.
  maxPixels: 50_000_000,
  maxEdge: 12_000,
});

/** Identify whether a scanner URL is standalone, fully paired, or incomplete. */
export function classifyPairingState(sessionId, keyB64) {
  const hasSession = Boolean(String(sessionId || "").trim());
  const hasKey = Boolean(String(keyB64 || "").trim());
  if (!hasSession && !hasKey) return "standalone";
  if (hasSession && hasKey) return "paired";
  return "partial";
}

function normalizedLicenseNumber(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function hasSameLicenseNumber(first, second) {
  const a = normalizedLicenseNumber(first && first.dlnPid);
  const b = normalizedLicenseNumber(second && second.dlnPid);
  return Boolean(a && b && a === b);
}

/**
 * Commit a reviewed scan atomically. Invalid/repeated clicks and a duplicate
 * co-buyer leave both the deal and pending record untouched.
 */
export function commitPendingScan(deal, capturing, pending) {
  if (
    !deal ||
    (capturing !== "buyer" && capturing !== "coBuyer") ||
    !pending ||
    typeof pending !== "object"
  ) {
    return { ok: false, reason: "missing-scan" };
  }
  if (
    capturing === "coBuyer" &&
    deal.buyer &&
    hasSameLicenseNumber(deal.buyer, pending)
  ) {
    return { ok: false, reason: "duplicate-license" };
  }
  deal[capturing] = pending;
  return { ok: true };
}

/** True only after a complete idle interval has elapsed since the last decode. */
export function decodeIntervalElapsed(now, lastFinishedAt, intervalMs) {
  if (!Number.isFinite(now)) return false;
  if (!Number.isFinite(lastFinishedAt)) return true;
  const interval = Number.isFinite(intervalMs) ? Math.max(0, intervalMs) : 0;
  return now - lastFinishedAt >= interval;
}

/**
 * Reject unusable uploads before a barcode engine copies them into WASM.
 * Empty MIME types are allowed because some mobile share sheets omit them.
 */
export function validatePhotoFile(file, limits = PHOTO_LIMITS) {
  if (!file || typeof file !== "object") {
    return { ok: false, reason: "photo-missing" };
  }
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, reason: "photo-empty" };
  }
  const maxBytes = Number(limits && limits.maxBytes);
  if (Number.isFinite(maxBytes) && maxBytes > 0 && size > maxBytes) {
    return { ok: false, reason: "photo-too-large" };
  }
  const type = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  if (type && !type.startsWith("image/")) {
    return { ok: false, reason: "photo-not-image" };
  }
  return { ok: true };
}

/** Bound decoded dimensions before creating repeated canvas/WASM variants. */
export function validatePhotoDimensions(width, height, limits = PHOTO_LIMITS) {
  if (
    !Number.isFinite(width) || width <= 0 ||
    !Number.isFinite(height) || height <= 0
  ) {
    return { ok: false, reason: "photo-invalid-dimensions" };
  }
  const pixels = width * height;
  const maxPixels = Number(limits && limits.maxPixels);
  const maxEdge = Number(limits && limits.maxEdge);
  if (
    !Number.isSafeInteger(pixels) ||
    (Number.isFinite(maxPixels) && maxPixels > 0 && pixels > maxPixels) ||
    (Number.isFinite(maxEdge) && maxEdge > 0 && Math.max(width, height) > maxEdge)
  ) {
    return { ok: false, reason: "photo-too-many-pixels" };
  }
  return { ok: true, pixels };
}

/** Resolve a promise normally, or return a fallback when it takes too long. */
export function resolveBeforeTimeout(promise, timeoutMs, timeoutValue) {
  const delay = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(timeoutValue);
    }, delay);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function stopLateStream(stream) {
  if (!stream || typeof stream.getTracks !== "function") return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch {}
  }
}

/**
 * Start getUserMedia with an explicit cancellation/timeout path. Browsers may
 * leave the native permission prompt pending forever; a stream that arrives
 * after cancellation is immediately stopped instead of reviving an old scan.
 */
export function createCameraRequest(
  getUserMedia,
  constraints,
  { timeoutMs = 12_000, isCancelled = () => false } = {}
) {
  const delay = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 12_000;
  let settled = false;
  let timer = null;
  let rejectRequest = null;

  const promise = new Promise((resolve, reject) => {
    const fail = (message) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(new Error(message));
    };
    rejectRequest = () => fail("cancelled");
    timer = setTimeout(() => fail("camera-start-timeout"), delay);

    Promise.resolve()
      .then(() => {
        if (settled) return null;
        if (typeof getUserMedia !== "function") {
          throw new TypeError("getUserMedia is unavailable");
        }
        return getUserMedia(constraints);
      })
      .then(
        (stream) => {
          if (!stream) return;
          if (settled || isCancelled()) {
            stopLateStream(stream);
            if (!settled) fail("cancelled");
            return;
          }
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(stream);
        },
        (error) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          reject(error);
        }
      );
  });

  return {
    promise,
    cancel() {
      if (rejectRequest) rejectRequest();
    },
  };
}

// A small, non-reversible fingerprint lets the camera loop debounce repeated
// detector output without retaining another copy of the barcode's PII.
function fingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Stateful gate for detector results. Repeated rejected frames are suppressed,
 * while every complete AAMVA frame is evaluated and accepted immediately.
 */
export function createDetectionGate(duplicateWindowMs = 1800) {
  let lastRejectedHash = null;
  let lastRejectedAt = 0;

  return {
    evaluate(raw, now = Date.now()) {
      const verdict = evaluateDetection(raw);
      if (verdict.ok) return verdict;

      const normalized = typeof raw === "string" ? raw : String(raw || "");
      const hash = fingerprint(normalized);
      if (
        lastRejectedHash === hash &&
        now - lastRejectedAt >= 0 &&
        now - lastRejectedAt < duplicateWindowMs
      ) {
        return {
          ok: false,
          reason: "duplicate",
          originalReason: verdict.reason,
        };
      }

      lastRejectedHash = hash;
      lastRejectedAt = now;
      return verdict;
    },
  };
}
