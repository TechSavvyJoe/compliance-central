import test from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, b64urlToBytes, bytesToB64url } from "../docs/lib/crypto-pair.js";

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
