import test from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, b64urlToBytes, bytesToB64url } from "../docs/lib/crypto-pair.js";
// The extension side lives in a SEPARATE deployment root (lib/) and duplicates
// the AES-GCM/base64url helpers — they can't share a runtime module. This
// parity test pins the two roots together so they can't silently diverge.
import {
  generateKeyB64 as extGenerateKeyB64,
  decryptPayload as extDecryptPayload,
} from "../lib/crypto-pair.js";

// Mirror the extension's key generation: 32 random bytes, base64url.
function genKeyB64() {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function decrypt(keyB64, blob) {
  const key = await crypto.subtle.importKey(
    "raw",
    b64urlToBytes(keyB64),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlToBytes(blob.iv) },
    key,
    b64urlToBytes(blob.ct)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

test("encrypt on phone → decrypt on extension round-trips the payload", async () => {
  const keyB64 = genKeyB64();
  const payload = {
    buyer: { firstName: "WENDY", lastName: "UPCOTT", dob: "08/18/1969", isMichigan: true },
    coBuyer: null,
    scannedAt: "2026-06-16T00:00:00Z",
  };
  const blob = await encryptPayload(keyB64, payload);
  assert.ok(blob.iv && blob.ct);
  const out = await decrypt(keyB64, blob);
  assert.deepEqual(out, payload);
});

test("a wrong key fails to decrypt (confidentiality)", async () => {
  const blob = await encryptPayload(genKeyB64(), { x: 1 });
  await assert.rejects(() => decrypt(genKeyB64(), blob));
});

test("base64url round-trips arbitrary bytes", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  assert.deepEqual([...b64urlToBytes(bytesToB64url(bytes))], [...bytes]);
});

test("PARITY: phone (docs/) encrypt → extension (lib/) decrypt round-trips", async () => {
  // The real flow uses an extension-generated key; the phone encrypts to it.
  const keyB64 = extGenerateKeyB64();
  const payload = {
    buyer: { firstName: "WENDY", lastName: "UPCOTT", dob: "08/18/1969", isMichigan: false },
    coBuyer: { firstName: "JOHN", lastName: "UPCOTT", dob: "01/02/1970", isMichigan: true },
    scannedAt: "2026-06-16T00:00:00Z",
  };
  const blob = await encryptPayload(keyB64, payload);
  const out = await extDecryptPayload(keyB64, blob);
  assert.deepEqual(out, payload);
});

test("PARITY: extension rejects a blob it cannot authenticate (tampered ct)", async () => {
  const keyB64 = extGenerateKeyB64();
  const blob = await encryptPayload(keyB64, { x: 1 });
  // Flip the FIRST base64url char of the ciphertext — it encodes the top bits
  // of byte 0 (always a real byte), so this reliably breaks the GCM tag.
  // (Flipping the LAST char can be a no-op when its trailing bits are unused.)
  const first = blob.ct[0];
  const swapped = first === "A" ? "B" : "A";
  const tampered = { iv: blob.iv, ct: swapped + blob.ct.slice(1) };
  await assert.rejects(() => extDecryptPayload(keyB64, tampered));
});
