import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPairingState,
  commitPendingScan,
  createCameraRequest,
  createDetectionGate,
  decodeIntervalElapsed,
  PHOTO_LIMITS,
  resolveBeforeTimeout,
  validatePhotoDimensions,
  validatePhotoFile,
} from "../docs/lib/scan-state.js";

const COMPLETE =
  "@\n\rANSI 636032100102DL00410279\n" +
  "DLDAQS123456789012\nDCSSAMPLE\nDCTPAT ALEX\nDBB08081985\nDAJMI\n\r";
const PARTIAL =
  "@\n\rANSI 636032100102DL00410279\nDLDCSAMPLE\nDCTPAT\nDBB08081985\nDAJMI\n\r";

test("detection gate debounces duplicate partial frames", () => {
  const gate = createDetectionGate(1800);
  assert.equal(gate.evaluate(PARTIAL, 1000).reason, "incomplete");
  const duplicate = gate.evaluate(PARTIAL, 1200);
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(duplicate.originalReason, "incomplete");
  assert.equal(gate.evaluate(PARTIAL, 3000).reason, "incomplete");
});

test("later complete frame is accepted during duplicate cooldown", () => {
  const gate = createDetectionGate(1800);
  assert.equal(gate.evaluate(PARTIAL, 1000).ok, false);
  const accepted = gate.evaluate(COMPLETE, 1100);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.person.firstName, "PAT");
  assert.equal(accepted.person.isMichigan, true);
});

test("QR, malformed AAMVA, and empty detections stay rejected", () => {
  const gate = createDetectionGate();
  assert.equal(gate.evaluate("https://example.com/pair", 1).reason, "not-aamva");
  assert.equal(gate.evaluate("ANSI broken", 2).reason, "not-aamva");
  assert.equal(gate.evaluate("", 3).reason, "empty");
});

test("photo preflight accepts normal mobile images and rejects oversized inputs", () => {
  assert.deepEqual(
    validatePhotoFile({ size: 2_000_000, type: "image/jpeg" }),
    { ok: true }
  );
  assert.equal(
    validatePhotoFile({ size: PHOTO_LIMITS.maxBytes + 1, type: "image/jpeg" }).reason,
    "photo-too-large"
  );
  assert.equal(
    validatePhotoFile({ size: 20, type: "text/html" }).reason,
    "photo-not-image"
  );
  assert.equal(validatePhotoFile({ size: 0, type: "image/png" }).reason, "photo-empty");
});

test("photo dimension preflight allows 48 MP but bounds pathological canvases", () => {
  assert.equal(validatePhotoDimensions(8064, 6048).ok, true);
  assert.equal(
    validatePhotoDimensions(12_001, 100).reason,
    "photo-too-many-pixels"
  );
  assert.equal(
    validatePhotoDimensions(10_000, 10_000).reason,
    "photo-too-many-pixels"
  );
  assert.equal(
    validatePhotoDimensions(0, 100).reason,
    "photo-invalid-dimensions"
  );
});

test("camera request timeout rejects and stops a stream that resolves late", async () => {
  let release;
  let stopped = 0;
  const deferred = new Promise((resolve) => { release = resolve; });
  const request = createCameraRequest(() => deferred, { video: true }, { timeoutMs: 5 });

  await assert.rejects(request.promise, /camera-start-timeout/);
  release({ getTracks: () => [{ stop: () => { stopped++; } }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, 1);
});

test("camera request cancellation rejects and cleans up a late stream", async () => {
  let release;
  let stopped = 0;
  const deferred = new Promise((resolve) => { release = resolve; });
  const request = createCameraRequest(() => deferred, { video: true });
  await Promise.resolve();
  request.cancel();

  await assert.rejects(request.promise, /cancelled/);
  release({ getTracks: () => [{ stop: () => { stopped++; } }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, 1);
});

test("bounded promise prefers an on-time value and falls back after timeout", async () => {
  assert.equal(await resolveBeforeTimeout(Promise.resolve("ready"), 20, "fallback"), "ready");
  assert.equal(
    await resolveBeforeTimeout(new Promise(() => {}), 5, "fallback"),
    "fallback"
  );
});

test("pairing state blocks partial links but permits standalone scans", () => {
  assert.equal(classifyPairingState("", ""), "standalone");
  assert.equal(classifyPairingState("session", "key"), "paired");
  assert.equal(classifyPairingState("session", ""), "partial");
  assert.equal(classifyPairingState("", "key"), "partial");
});

test("confirmation rejects a duplicate co-buyer before mutating the deal", () => {
  const buyer = { dlnPid: "S 123 456 789 012", firstName: "PAT" };
  const duplicate = { dlnPid: "s-123-456-789-012", firstName: "ALEX" };
  const deal = { buyer, coBuyer: null };
  let pending = duplicate;

  const result = commitPendingScan(deal, "coBuyer", pending);
  if (result.ok) pending = null;
  assert.deepEqual(result, {
    ok: false,
    reason: "duplicate-license",
  });
  assert.equal(deal.buyer, buyer);
  assert.equal(deal.coBuyer, null);
  assert.equal(pending, duplicate);
});

test("a repeated confirm click cannot clear an already committed buyer", () => {
  const buyer = { dlnPid: "S 123 456 789 012", firstName: "PAT" };
  const deal = { buyer: null, coBuyer: null };
  let pending = buyer;

  assert.deepEqual(commitPendingScan(deal, "buyer", pending), { ok: true });
  pending = null;
  assert.deepEqual(commitPendingScan(deal, "buyer", pending), {
    ok: false,
    reason: "missing-scan",
  });
  assert.equal(deal.buyer, buyer);
});

test("live decoding waits for an idle interval after the prior frame", () => {
  assert.equal(decodeIntervalElapsed(1000, Number.NEGATIVE_INFINITY, 180), true);
  assert.equal(decodeIntervalElapsed(1179, 1000, 180), false);
  assert.equal(decodeIntervalElapsed(1180, 1000, 180), true);
});
