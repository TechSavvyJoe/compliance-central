// Extension-side pairing crypto: generate the AES-GCM key (shared with the
// phone via the QR fragment) and decrypt the relayed blob. The backend never
// sees the key.
//
// SYNC: the base64url + AES-GCM primitives here MUST stay byte-compatible with
// docs/lib/crypto-pair.js (the phone side). They live in two deployment roots
// (extension bundle vs GitHub Pages) and can't share a runtime module. The
// PARITY tests in tests/crypto-pair.test.js encrypt with one and decrypt with
// the other to catch drift — change both files together and re-run those tests.

function b64urlToBytes(b64url) {
  const b64 = b64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateKeyB64() {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
}

// A scan payload is a handful of licence fields. Bounding the envelope before
// decoding means a hostile or compromised relay cannot make the side panel
// allocate arbitrary memory by answering a poll with a huge ct.
const PAIR_IV_B64_LENGTH = 16; // 12 bytes, unpadded base64url
const PAIR_MAX_CT_B64_LENGTH = 64_000;

export async function decryptPayload(keyB64, blob) {
  if (!keyB64 || typeof keyB64 !== "string" || !blob || typeof blob !== "object" || !blob.iv || !blob.ct) {
    throw new Error("Invalid payload format");
  }
  if (
    typeof blob.iv !== "string" ||
    blob.iv.length !== PAIR_IV_B64_LENGTH ||
    typeof blob.ct !== "string" ||
    blob.ct.length > PAIR_MAX_CT_B64_LENGTH
  ) {
    throw new Error("Invalid payload format");
  }
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
