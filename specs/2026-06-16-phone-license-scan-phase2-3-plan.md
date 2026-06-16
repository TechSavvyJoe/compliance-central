# Phone License Scan — Phase 2 + 3 Implementation Plan (Encrypted relay + extension autofill)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Carry the phone-scanned buyer/co-buyer data to the desktop extension and autofill the form, end-to-end-encrypted (the server only relays an opaque blob), with out-of-state subjects flagged so the Michigan Repeat Offender check is skipped for them.

**Architecture:** Phone encrypts the scan payload with an AES-GCM key carried in the QR fragment (never sent to a server), POSTs the ciphertext to a short-lived in-memory mailbox on the Fly backend; the extension generated that key + session, renders the QR, polls the mailbox, decrypts locally, and fills the form. Build order: **Phase 2** (backend relay + mobile encrypt/POST, verified by a crypto round-trip + live relay curl), then **Phase 3** (extension QR + poll + decrypt + autofill + jurisdiction gating).

**Tech stack:** Express (Fly) in-memory store; Web Crypto `AES-GCM` (both ends); vanilla ESM; vendored `qrcode-generator` UMD for the extension; `node --test`.

**Spec:** `specs/2026-06-16-phone-license-scan-design.md`. Phase 1 (scan page + parser) is already shipped.

**Crypto contract (both ends MUST agree):**
- Key: 32 random bytes, AES-GCM-256, exported raw, **base64url** (no padding) → QR fragment `#k=`.
- Encrypt: random 12-byte IV; `AES-GCM` over `TextEncoder().encode(JSON.stringify(payload))`.
- Wire JSON (relay body, opaque to server): `{ "iv": "<base64url>", "ct": "<base64url>" }`.
- Decrypt: reverse; `JSON.parse(TextDecoder().decode(plaintext))`.

**Backend base URL:** `https://compliance-central-api.fly.dev`. **Scan page origin:** `https://techsavvyjoe.github.io`.

---

## File structure

| File | Phase | Responsibility |
|------|-------|----------------|
| `compliance-central-api/src/services/pairing.js` (create) | 2 | In-memory mailbox: createSession / submit / take, TTL + size caps. |
| `compliance-central-api/src/__tests__/pairing.test.js` (create) | 2 | Unit tests for the store lifecycle. |
| `compliance-central-api/src/index.js` (modify) | 2 | Add Pages origin to CORS; skip auth for the phone submit route; mount 3 pair routes. |
| `docs/lib/crypto-pair.js` (create) | 2 | `encryptPayload(keyB64, obj)` + base64url helpers (phone side). |
| `docs/scan.js` (modify) | 2 | On finish, encrypt + POST to the relay when paired; standalone otherwise. |
| `lib/crypto-pair.js` (create) | 3 | `generateKeyB64()` + `decryptPayload(keyB64, {iv,ct})` (extension side). |
| `lib/qrcode.min.js` (create, vendored) | 3 | QR rendering (UMD global `qrcode`). |
| `src/sidepanel/scan-pairing.js` (create) | 3 | Pairing controller: new session, QR, poll, decrypt, autofill. |
| `src/sidepanel/form.js` (modify) | 3 | Extract `applyCustomerData(elements, data)` reused by restore + scan. |
| `sidepanel.html` (modify) | 3 | "Scan license" button + QR modal markup; load qrcode.min.js. |
| `sidepanel.js` (modify) | 3 | Wire the button → pairing controller; record jurisdiction. |
| `src/worker/orchestrator.js` (modify) | 3 | Skip Repeat Offender for an out-of-state subject. |
| `src/sidepanel/results.js` (modify) | 3 | Render "Not applicable — out-of-state ID" for a skipped Repeat Offender. |
| `package.json` (modify) | 3 | Exclude `lib/qrcode.min.js` from `check`. |

---

# PHASE 2 — Encrypted relay

### Task 2.1: Pairing store (backend, TDD)

**Files:**
- Create: `compliance-central-api/src/services/pairing.js`
- Test: `compliance-central-api/src/__tests__/pairing.test.js`

- [ ] **Step 1: Write the failing test**

Create `compliance-central-api/src/__tests__/pairing.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession, submit, take, MAX_BLOB_BYTES, _expire,
} from "../services/pairing.js";

test("create → submit → take returns the blob once, then null", () => {
  const { sessionId } = createSession();
  assert.equal(take(sessionId), null); // nothing submitted yet
  const blob = { iv: "aaa", ct: "bbb" };
  assert.equal(submit(sessionId, blob), true);
  assert.deepEqual(take(sessionId), blob);
  assert.equal(take(sessionId), null); // single-use: deleted after first take
});

test("submit to an unknown session is rejected", () => {
  assert.equal(submit("nope-not-real", { iv: "a", ct: "b" }), false);
});

test("a session cannot be filled twice", () => {
  const { sessionId } = createSession();
  assert.equal(submit(sessionId, { iv: "a", ct: "b" }), true);
  assert.equal(submit(sessionId, { iv: "c", ct: "d" }), false);
});

test("oversized blobs are rejected", () => {
  const { sessionId } = createSession();
  const big = { iv: "a", ct: "x".repeat(MAX_BLOB_BYTES + 1) };
  assert.equal(submit(sessionId, big), false);
});

test("malformed blobs are rejected", () => {
  const { sessionId } = createSession();
  assert.equal(submit(sessionId, { iv: "a" }), false);
  assert.equal(submit(sessionId, null), false);
  assert.equal(submit(sessionId, { iv: 1, ct: 2 }), false);
});

test("expired sessions cannot be submitted to or taken", () => {
  const { sessionId } = createSession();
  _expire(sessionId); // force-expire for the test
  assert.equal(submit(sessionId, { iv: "a", ct: "b" }), false);
  assert.equal(take(sessionId), null);
});
```

- [ ] **Step 2: Run it, expect failure (module missing)**

Run: `cd "compliance-central-api" && npm test 2>&1 | grep -i pairing | head`
Expected: FAIL — cannot find `../services/pairing.js`.

- [ ] **Step 3: Implement the store**

Create `compliance-central-api/src/services/pairing.js`:

```js
/**
 * Ephemeral, zero-knowledge pairing mailbox for the phone→extension license
 * scan. The server only ever holds an OPAQUE encrypted blob ({iv, ct}) it
 * cannot read, single-use, short-lived. State is in-memory per machine — that
 * is fine: a pairing lives for seconds and is consumed on the same machine that
 * created it (Fly session affinity is not required because the extension polls
 * the same backend host immediately).
 */

import crypto from "node:crypto";

const TTL_MS = 2 * 60 * 1000; // 2 minutes
export const MAX_BLOB_BYTES = 8 * 1024; // ciphertext is tiny; cap hard
const MAX_SESSIONS = 500; // backstop against memory abuse

// sessionId -> { createdAt, blob|null }
const sessions = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > TTL_MS) sessions.delete(id);
  }
}

export function createSession() {
  sweep();
  if (sessions.size >= MAX_SESSIONS) {
    // Drop the oldest to bound memory.
    const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  const sessionId = crypto.randomBytes(16).toString("hex");
  sessions.set(sessionId, { createdAt: Date.now(), blob: null });
  return { sessionId, expiresInSec: Math.floor(TTL_MS / 1000) };
}

function isValidBlob(blob) {
  if (!blob || typeof blob !== "object") return false;
  if (typeof blob.iv !== "string" || typeof blob.ct !== "string") return false;
  const bytes = blob.iv.length + blob.ct.length;
  return bytes > 0 && bytes <= MAX_BLOB_BYTES;
}

export function submit(sessionId, blob) {
  const s = sessions.get(sessionId);
  if (!s) return false;
  if (Date.now() - s.createdAt > TTL_MS) { sessions.delete(sessionId); return false; }
  if (s.blob !== null) return false; // already filled (single-use submit)
  if (!isValidBlob(blob)) return false;
  s.blob = { iv: blob.iv, ct: blob.ct };
  return true;
}

export function take(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  const expired = Date.now() - s.createdAt > TTL_MS;
  if (expired || s.blob === null) {
    if (expired) sessions.delete(sessionId);
    return null;
  }
  const blob = s.blob;
  sessions.delete(sessionId); // single-use: consumed on read
  return blob;
}

// Test-only: force-expire a session.
export function _expire(sessionId) {
  const s = sessions.get(sessionId);
  if (s) s.createdAt = 0;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd "compliance-central-api" && npm test 2>&1 | tail -6`
Expected: PASS, fail count 0.

- [ ] **Step 5: Commit**

```bash
cd "compliance-central-api"
git add src/services/pairing.js src/__tests__/pairing.test.js
git commit -m "feat(pairing): ephemeral zero-knowledge relay store + tests"
```

### Task 2.2: Relay routes + CORS + auth skip (backend)

**Files:**
- Modify: `compliance-central-api/src/index.js`

- [ ] **Step 1: Allow the scan-page origin in CORS**

In `src/index.js`, right after `const corsOrigins = [];` (line ~232) add:

```js
// The mobile scan page (GitHub Pages) POSTs the encrypted blob to the relay.
corsOrigins.push("https://techsavvyjoe.github.io");
```

- [ ] **Step 2: Skip API-key auth for the phone submit route only**

In `apiKeyAuth`, replace the opening skip block:

```js
function apiKeyAuth(req, res, next) {
  // Skip authentication for health checks and root info
  if (req.path === "/health" || req.path === "/") {
    return next();
  }
```

with:

```js
function apiKeyAuth(req, res, next) {
  // Skip authentication for health checks and root info
  if (req.path === "/health" || req.path === "/") {
    return next();
  }
  // The phone has no API key; its only endpoint is the pairing SUBMIT, whose
  // capability is the unguessable session id in the path. Everything else
  // (incl. creating a session and taking the blob) still requires the key.
  if (req.method === "POST" && /^\/pair\/[a-f0-9]{32}\/submit$/.test(req.path)) {
    return next();
  }
```

- [ ] **Step 3: Add the three relay routes**

In `src/index.js`, import the store near the other service imports (top of file):

```js
import { createSession as pairCreate, submit as pairSubmit, take as pairTake } from "./services/pairing.js";
```

Add the routes after the `/health` and `/` routes (before the OFAC section):

```js
// ============================================================================
// PHONE → EXTENSION PAIRING RELAY (zero-knowledge; blob is opaque to us)
// ============================================================================

// Extension opens a mailbox (keyed).
app.post("/pair/new", (req, res) => {
  const { sessionId, expiresInSec } = pairCreate();
  res.json({ success: true, sessionId, expiresInSec });
});

// Phone drops the encrypted blob (NO api key; capability = session id).
app.post("/pair/:id/submit", (req, res) => {
  const ok = pairSubmit(req.params.id, req.body);
  if (!ok) {
    return res.status(400).json({ success: false, error: "Invalid or expired pairing." });
  }
  res.json({ success: true });
});

// Extension polls; returns the blob once then deletes it (keyed).
app.get("/pair/:id", (req, res) => {
  const blob = pairTake(req.params.id);
  if (!blob) return res.status(204).end();
  res.json({ success: true, blob });
});
```

- [ ] **Step 4: Syntax check + tests**

Run: `cd "compliance-central-api" && node --check src/index.js && npm test 2>&1 | tail -5`
Expected: no syntax error; all tests pass.

- [ ] **Step 5: Live local round-trip (integration)**

Run (dev mode skips key auth so curl is simple; the auth-skip regex is still unit-covered by behavior):
```bash
cd "compliance-central-api"
PORT=3999 node src/index.js >/tmp/cc_api.log 2>&1 &
sleep 1.5
SID=$(curl -s -XPOST http://localhost:3999/pair/new | python3 -c "import sys,json;print(json.load(sys.stdin)['sessionId'])")
echo "session: $SID"
curl -s -XPOST -H "Content-Type: application/json" -d '{"iv":"AA","ct":"BB"}' "http://localhost:3999/pair/$SID/submit"
echo " (submit)"
curl -s "http://localhost:3999/pair/$SID" ; echo " (take #1)"
curl -s -o /dev/null -w "take #2 HTTP %{http_code}\n" "http://localhost:3999/pair/$SID"
pkill -f "node src/index.js"
```
Expected: submit → `{"success":true}`; take #1 → `{"success":true,"blob":{"iv":"AA","ct":"BB"}}`; take #2 → HTTP 204 (single-use).

- [ ] **Step 6: Commit**

```bash
cd "compliance-central-api"
git add src/index.js
git commit -m "feat(pairing): relay routes (/pair/new, /:id/submit, /:id) + CORS + auth skip"
```

### Task 2.3: Phone-side encrypt + POST

**Files:**
- Create: `docs/lib/crypto-pair.js`
- Modify: `docs/scan.js`

- [ ] **Step 1: Crypto helper (phone)**

Create `docs/lib/crypto-pair.js`:

```js
// Phone-side AES-GCM encryption for the pairing relay. The key is supplied by
// the extension via the QR fragment; the server never sees it.

export function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
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
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { iv: bytesToB64url(iv), ct: bytesToB64url(new Uint8Array(ctBuf)) };
}
```

- [ ] **Step 2: Wire finish() to encrypt + POST when paired**

In `docs/scan.js`, add near the top (after the DEBUG line):

```js
import { encryptPayload } from "./lib/crypto-pair.js";
const RELAY_BASE = "https://compliance-central-api.fly.dev";
```

Replace the end of `finish()` (the `show("done")` call) so it sends when paired. The full `finish()` becomes:

```js
async function finish() {
  if (deal.coBuyer && deal.buyer && deal.coBuyer.dlnPid === deal.buyer.dlnPid) {
    showError("Buyer and co-buyer have the same license number — did you scan the same card twice?");
  }
  lastPayload = {
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
  show("done");

  // If we arrived via a paired QR (session + key in the URL), encrypt + relay.
  if (sessionId && keyB64) {
    try {
      const blob = await encryptPayload(keyB64, lastPayload);
      const res = await fetch(`${RELAY_BASE}/pair/${encodeURIComponent(sessionId)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(blob),
      });
      if (!res.ok) throw new Error("relay " + res.status);
    } catch (e) {
      showError("Couldn't send to your computer: " + (e && e.message ? e.message : "network error") + ". The data stayed on this phone.");
    }
  }
}
```

Note: `finish` is already referenced by event listeners; making it `async` is safe (listeners ignore the returned promise).

- [ ] **Step 3: Syntax check**

Run: `cd "<ext repo>" && node --check docs/scan.js docs/lib/crypto-pair.js && echo OK`
Expected: `OK`.

- [ ] **Step 4: Crypto round-trip test (Node, proves the contract end-to-end)**

Create `tests/crypto-pair.test.js` in the EXTENSION repo:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, b64urlToBytes, bytesToB64url } from "../docs/lib/crypto-pair.js";

// Mirror the extension's key generation: 32 random bytes, base64url.
function genKeyB64() {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function decrypt(keyB64, blob) {
  const key = await crypto.subtle.importKey("raw", b64urlToBytes(keyB64), { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlToBytes(blob.iv) }, key, b64urlToBytes(blob.ct)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

test("encrypt on phone → decrypt on extension round-trips the payload", async () => {
  const keyB64 = genKeyB64();
  const payload = { buyer: { firstName: "WENDY", lastName: "UPCOTT", dob: "08/18/1969", isMichigan: true }, coBuyer: null, scannedAt: "2026-06-16T00:00:00Z" };
  const blob = await encryptPayload(keyB64, payload);
  assert.ok(blob.iv && blob.ct);
  const out = await decrypt(keyB64, blob);
  assert.deepEqual(out, payload);
});

test("a wrong key fails to decrypt (confidentiality)", async () => {
  const blob = await encryptPayload(genKeyB64(), { x: 1 });
  await assert.rejects(() => decrypt(genKeyB64(), blob));
});
```

Run: `cd "<ext repo>" && npm test 2>&1 | tail -6`
Expected: PASS (Node 25 has global `crypto.subtle`).

- [ ] **Step 5: Commit (extension repo)**

```bash
git add docs/lib/crypto-pair.js docs/scan.js tests/crypto-pair.test.js
git commit -m "feat(scan): encrypt scan payload + POST to pairing relay (Phase 2)"
```

- [ ] **Step 6: Deploy backend + push scan page**

Backend: `cd "compliance-central-api" && FLY_API_TOKEN=$(cat /tmp/fly_deploy_token) flyctl deploy --remote-only -a compliance-central-api` (deploy token method). Verify: `curl -s -XPOST https://compliance-central-api.fly.dev/pair/new -H "x-api-key: <built-in key>"` returns a sessionId; the no-key variant of `/pair/new` returns 401 (auth still enforced on create).
Extension repo: `git push` (publishes the updated scan page). Confirm `scan.js` live contains `pair/` + `crypto-pair.js` served 200.

---

# PHASE 3 — Extension pairing + autofill

### Task 3.1: Extract a shared autofill function

**Files:**
- Modify: `src/sidepanel/form.js`

- [ ] **Step 1: Add `applyCustomerData` and reuse it in `loadCachedFormData`**

In `src/sidepanel/form.js`, add an exported function that fills the form from a customer object (mirrors the existing restore logic, normalizes the DLN by stripping spaces so it passes `dlnPattern`):

```js
// Fills the form fields from a customer object (used by cache-restore and by
// the phone-scan autofill). DLN spaces are stripped to satisfy dlnPattern.
export function applyCustomerData(elements, data) {
  const dln = (v) => (v || "").replace(/\s+/g, "");
  elements.firstName.value = data.firstName || "";
  if (elements.middleName) elements.middleName.value = data.middleName || "";
  elements.lastName.value = data.lastName || "";
  if (elements.suffix) elements.suffix.value = data.suffix || "";
  setDateInputValue(elements.dob, data.dob || "");
  elements.dlnPid.value = dln(data.dlnPid);
  if (data.tradeVin !== undefined) elements.tradeVin.value = data.tradeVin || "";

  if (data.coBuyer && elements.hasCoBuyer) {
    elements.hasCoBuyer.checked = true;
    elements.hasCoBuyer.dispatchEvent(new Event("change"));
    const co = data.coBuyer;
    if (elements.cbFirstName) elements.cbFirstName.value = co.firstName || "";
    if (elements.cbMiddleName) elements.cbMiddleName.value = co.middleName || "";
    if (elements.cbLastName) elements.cbLastName.value = co.lastName || "";
    if (elements.cbSuffix) elements.cbSuffix.value = co.suffix || "";
    setDateInputValue(elements.cbDob, co.dob || "");
    if (elements.cbDlnPid) elements.cbDlnPid.value = dln(co.dlnPid);
  }
}
```

(Optionally refactor `loadCachedFormData`'s field-setting block to call `applyCustomerData`; not required for correctness.)

- [ ] **Step 2: Check**

Run: `node --check src/sidepanel/form.js && echo OK` → `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/form.js
git commit -m "refactor(form): shared applyCustomerData for restore + scan autofill"
```

### Task 3.2: Vendor a QR library

**Files:**
- Create: `lib/qrcode.min.js`
- Modify: `package.json`

- [ ] **Step 1: Download UMD QR generator**

Run:
```bash
curl -fL https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js -o lib/qrcode.min.js
grep -c "qrcode" lib/qrcode.min.js
```
Expected: file written; grep ≥ 1. (UMD exposes global `qrcode`; `qrcode(0,'M')` → `.addData(s).make()` → `.createDataURL(cellSize)`.)

- [ ] **Step 2: Exclude from check**

In `package.json`, add `-not -path './lib/qrcode.min.js'` to the `check` find (alongside the jspdf + zxing exclusions).

- [ ] **Step 3: Verify check + commit**

Run: `npm run check && echo OK` → `OK`.
```bash
git add lib/qrcode.min.js package.json
git commit -m "chore(scan): vendor qrcode-generator UMD for pairing QR"
```

### Task 3.3: Extension crypto helper

**Files:**
- Create: `lib/crypto-pair.js`

- [ ] **Step 1: Create the helper (key-gen + decrypt)**

Create `lib/crypto-pair.js`:

```js
// Extension-side pairing crypto: generate the AES-GCM key (shared via the QR
// fragment) and decrypt the relayed blob. The backend never sees the key.

function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
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

export async function decryptPayload(keyB64, blob) {
  const key = await crypto.subtle.importKey("raw", b64urlToBytes(keyB64), { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlToBytes(blob.iv) }, key, b64urlToBytes(blob.ct)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}
```

- [ ] **Step 2: Check + commit**

Run: `node --check lib/crypto-pair.js && echo OK` → `OK`.
```bash
git add lib/crypto-pair.js
git commit -m "feat(scan): extension pairing crypto (key-gen + decrypt)"
```

### Task 3.4: Pairing controller (QR + poll + decrypt + autofill)

**Files:**
- Create: `src/sidepanel/scan-pairing.js`

- [ ] **Step 1: Create the controller**

Create `src/sidepanel/scan-pairing.js`:

```js
import { CONFIG } from "../../lib/config.js";
import { generateKeyB64, decryptPayload } from "../../lib/crypto-pair.js";
import { applyCustomerData } from "./form.js";
import { showToast } from "./toast.js";

const RELAY_BASE = "https://compliance-central-api.fly.dev";
const SCAN_PAGE = "https://techsavvyjoe.github.io/compliance-central/scan.html";
const POLL_MS = 1500;
const WINDOW_MS = 2 * 60 * 1000;

let active = null; // { sessionId, key, timer, deadline }

function apiKey() {
  // Same built-in key the rest of the extension uses.
  return CONFIG.backend?.defaultApiKey || "";
}

function stop() {
  if (active?.timer) clearTimeout(active.timer);
  active = null;
}

// Opens a pairing session and returns the QR target URL, or throws.
async function openSession() {
  const res = await fetch(`${RELAY_BASE}/pair/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey() },
  });
  if (!res.ok) throw new Error("Could not start pairing (" + res.status + ")");
  const { sessionId } = await res.json();
  const key = generateKeyB64();
  const url = `${SCAN_PAGE}?s=${encodeURIComponent(sessionId)}#k=${key}`;
  return { sessionId, key, url };
}

// Polls until the phone submits the blob, the window expires, or cancelled.
function poll(elements, onDone) {
  const tick = async () => {
    if (!active) return;
    if (Date.now() > active.deadline) {
      stop();
      onDone({ status: "expired" });
      return;
    }
    try {
      const res = await fetch(`${RELAY_BASE}/pair/${active.sessionId}`, {
        headers: { "x-api-key": apiKey() },
      });
      if (res.status === 200) {
        const { blob } = await res.json();
        const payload = await decryptPayload(active.key, blob);
        stop();
        applyCustomerData(elements, { ...payload.buyer, coBuyer: payload.coBuyer });
        onDone({ status: "filled", payload });
        return;
      }
      // 204 = not yet; keep polling.
    } catch {
      // transient; keep polling until the window expires
    }
    active.timer = setTimeout(tick, POLL_MS);
  };
  tick();
}

// Public: start a pairing. Calls renderQr(url) to display the QR, and onDone
// with {status}. Returns a cancel function.
export async function startPairing(elements, renderQr, onDone) {
  stop();
  const { sessionId, key, url } = await openSession();
  active = { sessionId, key, timer: null, deadline: Date.now() + WINDOW_MS };
  renderQr(url);
  poll(elements, onDone);
  return stop; // cancel
}

export { stop as cancelPairing };
```

Notes: `payload.buyer` holds `{firstName, middleName, lastName, suffix, dob, dlnPid, jurisdiction, isMichigan}`. `applyCustomerData` reads the buyer fields off the spread object and `coBuyer` off the nested object. The per-person `isMichigan` is recorded in Task 3.6.

- [ ] **Step 2: Check**

Run: `node --check src/sidepanel/scan-pairing.js && echo OK` → `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/scan-pairing.js
git commit -m "feat(scan): pairing controller — session, QR url, poll, decrypt, autofill"
```

### Task 3.5: Button + QR modal + wiring

**Files:**
- Modify: `sidepanel.html`, `sidepanel.js`, `sidepanel.css`

- [ ] **Step 1: Load the QR lib + add the button and modal (sidepanel.html)**

Add before the closing `</body>` / module script (alongside other lib scripts):
```html
<script src="lib/qrcode.min.js"></script>
```

Add a "Scan license" button at the top of the Customer Information section (inside `#inputPanel`, just under the section title) — exact insertion after the `<h3 class="section-title">…Customer Information</h3>` block:
```html
<button id="scanLicenseBtn" type="button" class="btn-secondary btn-ghost scan-license-btn">
  <span class="btn-icon icon icon-camera"></span> Scan license with phone
</button>
```

Add the QR modal markup before `</main>` (reuse the existing modal/overlay styling pattern):
```html
<div id="scanPairModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="scanPairTitle">
  <div class="modal">
    <h3 id="scanPairTitle">Scan with your phone</h3>
    <p class="hint">Open your phone camera and scan this code. You'll scan the
      license barcode on your phone; the fields fill here automatically.</p>
    <div id="scanPairQr" class="scan-pair-qr"></div>
    <p id="scanPairStatus" class="status" role="status" aria-live="polite">Waiting for your phone…</p>
    <button id="scanPairCancel" class="btn-secondary btn-ghost">Cancel</button>
  </div>
</div>
```

(If `icon-camera` is not in the icon set, use an existing icon class such as `icon-file`.)

- [ ] **Step 2: Styles (sidepanel.css)**

```css
.scan-license-btn { width: 100%; margin-bottom: 14px; }
.scan-pair-qr { display: flex; justify-content: center; padding: 12px; background: #fff;
  border-radius: 8px; margin: 12px auto; width: max-content; }
.scan-pair-qr img { display: block; width: 220px; height: 220px; image-rendering: pixelated; }
```

- [ ] **Step 3: Wire it (sidepanel.js)**

Add element refs to the `elements` map:
```js
  scanLicenseBtn: $("scanLicenseBtn"),
  scanPairModal: $("scanPairModal"),
  scanPairQr: $("scanPairQr"),
  scanPairStatus: $("scanPairStatus"),
  scanPairCancel: $("scanPairCancel"),
```

Add the import near the other sidepanel imports:
```js
import { startPairing } from "./src/sidepanel/scan-pairing.js";
```

Add wiring inside `initEventListeners()`:
```js
  let cancelPair = null;
  const closePairModal = () => {
    if (cancelPair) { cancelPair(); cancelPair = null; }
    elements.scanPairModal.classList.add("hidden");
  };
  elements.scanLicenseBtn?.addEventListener("click", async () => {
    elements.scanPairQr.innerHTML = "";
    elements.scanPairStatus.textContent = "Waiting for your phone…";
    elements.scanPairModal.classList.remove("hidden");
    try {
      cancelPair = await startPairing(
        elements,
        (url) => {
          const qr = window.qrcode(0, "M");
          qr.addData(url);
          qr.make();
          elements.scanPairQr.innerHTML = qr.createImgTag(6, 8);
        },
        (result) => {
          if (result.status === "filled") {
            recordScanJurisdiction(result.payload); // Task 3.6
            elements.scanPairModal.classList.add("hidden");
            showToast("License(s) scanned — fields filled.", "success");
          } else if (result.status === "expired") {
            elements.scanPairStatus.textContent = "Pairing expired. Close and try again.";
          }
        }
      );
    } catch (e) {
      elements.scanPairStatus.textContent = "Couldn't start pairing: " + describeError(e);
    }
  });
  elements.scanPairCancel?.addEventListener("click", closePairModal);
```

- [ ] **Step 4: Check + commit**

Run: `npm run check && echo OK` → `OK`.
```bash
git add sidepanel.html sidepanel.css sidepanel.js
git commit -m "feat(scan): Scan-license button + QR pairing modal wired to autofill"
```

### Task 3.6: Jurisdiction gating (out-of-state ⇒ skip Repeat Offender)

**Files:**
- Modify: `sidepanel.js` (record per-person jurisdiction), `src/worker/orchestrator.js`, `src/sidepanel/results.js`

- [ ] **Step 1: Record the scanned jurisdiction (sidepanel.js)**

Add a module-level store + setter used by the pairing callback and read into the run payload:
```js
const scanJurisdiction = { buyer: null, coBuyer: null }; // true=MI, false=out-of-state, null=unknown/manual
function recordScanJurisdiction(payload) {
  scanJurisdiction.buyer = payload?.buyer ? !!payload.buyer.isMichigan : null;
  scanJurisdiction.coBuyer = payload?.coBuyer ? !!payload.coBuyer.isMichigan : null;
}
```
In `handleRunAllChecks`, attach it to the customer data sent to the worker:
```js
  customerData.buyerIsMichigan = scanJurisdiction.buyer;     // null when manually entered
  customerData.coBuyerIsMichigan = scanJurisdiction.coBuyer;
```
(Reset both to `null` in `handleClear`.)

- [ ] **Step 2: Skip Repeat Offender for an out-of-state subject (orchestrator.js)**

In `src/worker/orchestrator.js`, before the buyer Repeat Offender call, treat `buyerIsMichigan === false` as "not applicable":
```js
      if (customer.buyerIsMichigan === false) {
        results.checks.repeatOffender = {
          passed: null, status: "not_applicable",
          message: "Out-of-state ID — Michigan Repeat Offender check does not apply.",
        };
        completedMdos++;
        await updateMdosProgress(0);
      } else {
        // ... existing buyer Repeat Offender block unchanged ...
      }
```
Apply the same guard around the co-buyer Repeat Offender block using `customer.coBuyerIsMichigan === false`. (Manual entry leaves these `null`/`undefined`, so the existing path runs — Michigan assumed, unchanged behavior.)

- [ ] **Step 2 detail (exact):** wrap the existing "1. Buyer Repeat Offender" body in the `else` of the guard above; likewise the "2. Co-Buyer Repeat Offender" body with `customer.coBuyerIsMichigan === false`. The skip branch still increments `completedMdos` and calls `updateMdosProgress(0)` so progress totals stay correct.

- [ ] **Step 3: Render "Not applicable" (results.js)**

In `src/sidepanel/results.js`, where the Repeat Offender result is rendered (buyer + co-buyer), handle the new status before the pass/fail branch:
```js
      if (ro.status === "not_applicable") {
        setResultStatus(elements.repeatResultStatus, "skipped", "N/A — out of state");
        elements.repeatResultDetail.textContent =
          "Michigan Repeat Offender check applies only to Michigan license/ID holders.";
        setActionVisibility(elements.printRepeatBtn, false);
        setActionVisibility(elements.downloadRepeatBtn, false);
      } else if (/* existing error check */) { ... }
```
Apply the same to the co-buyer Repeat Offender renderer (`cbRepeatResultStatus`/`cbRepeatResultDetail`/`printCbRepeatBtn`/`downloadCbRepeatBtn`).

- [ ] **Step 4: Check + tests**

Run: `npm run check && npm test 2>&1 | tail -5`
Expected: clean; all tests pass (existing orchestrator test still green — manual path unaffected because the flags are undefined there).

- [ ] **Step 5: Commit**

```bash
git add sidepanel.js src/worker/orchestrator.js src/sidepanel/results.js
git commit -m "feat(scan): skip Michigan Repeat Offender for out-of-state scanned subjects"
```

### Task 3.7: End-to-end verification (headless + device)

- [ ] **Step 1: Headless pairing round-trip** — extend the puppeteer harness: run a local backend (`PORT=3999`), open the served scan page with a known `?s=&#k=` whose key matches one the harness generated, mock the BarcodeDetector with a Michigan fixture, drive scan→confirm→no-co-buyer→finish, then `GET /pair/:id` from the harness and `decryptPayload` — assert the decrypted buyer matches. (Confirms phone-encrypt → relay → decrypt.)
- [ ] **Step 2: Extension load-unpacked (manual)** — load the extension, click "Scan license with phone", scan the QR with the phone, scan a real Michigan license; confirm the buyer (and co-buyer if scanned) fields fill, DLN has no spaces, and an out-of-state ID marks Repeat Offender "N/A — out of state".
- [ ] **Step 3: Deploy** — push extension repo (scan page already live); backend already deployed in Task 2.2. Rebuild the store zip (`npm run package`) for the next CWS upload.

---

## Self-Review

**Spec coverage (Phase 2 + 3 of the design):** zero-knowledge relay (Task 2.1–2.2, key never sent — it's only in the QR fragment) ✓; AES-GCM key in QR fragment + encrypt/POST (2.3) ✓; polling transport (3.4) ✓; QR + status + cancel (3.5) ✓; decrypt + autofill buyer+co-buyer (3.4 + 3.1) ✓; DLN normalization for the form (3.1) ✓; out-of-state ⇒ skip Repeat Offender, manual ⇒ assume Michigan (3.6) ✓; single-use/TTL/size-cap relay (2.1) ✓; auth: create+take keyed, submit capability-only (2.2) ✓.

**Placeholder scan:** complete code for the store, crypto (both ends), routes, controller, autofill, gating. The results.js/orchestrator.js edits reference "existing block" — that's an in-place wrap of code that already exists in those files (not new code to invent); exact wrap points named. ✓

**Type/name consistency:** `{iv, ct}` blob shape identical in pairing.js, crypto-pair.js (both), routes, and tests. `encryptPayload`/`decryptPayload`/`generateKeyB64`/`b64urlToBytes`/`bytesToB64url` names consistent across phone + extension copies. `applyCustomerData(elements, data)` signature consistent between form.js and the controller. Session id format `[a-f0-9]{32}` consistent between `createSession` (randomBytes(16).hex) and the auth-skip regex. ✓

**Out of scope:** privacy-policy update for the relay (will add when shipping); USB-wedge scanner path; address capture (intentionally excluded).
