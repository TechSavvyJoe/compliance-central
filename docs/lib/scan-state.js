import { evaluateDetection } from "./aamva.js?v=20260717-3";

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
