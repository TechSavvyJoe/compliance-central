import test from "node:test";
import assert from "node:assert/strict";
import { createDetectionGate } from "../docs/lib/scan-state.js";

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
