// Phone-side AES-GCM encryption for the pairing relay. The key is supplied by
// the extension via the QR fragment; the server never sees it.

export function b64urlToBytes(b64url) {
  const b64 = b64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function encryptPayload(keyB64, obj) {
  const rawKey = b64urlToBytes(keyB64);
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { iv: bytesToB64url(iv), ct: bytesToB64url(new Uint8Array(ctBuf)) };
}
