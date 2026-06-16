# Phone License Scan — Phase 1 Implementation Plan (Mobile scan page + AAMVA parser)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a branded mobile web page that scans a US driver's license / state-ID PDF417 barcode on a real phone, parses the AAMVA fields (including issuing jurisdiction), captures buyer + optional co-buyer, and shows the assembled result — proving the scan works before any networking is added.

**Architecture:** A static page on the existing GitHub Pages site (`docs/scan.html` + `docs/scan.css` + `docs/scan.js`). Decoding uses the native `BarcodeDetector` when available (Android Chrome) and a vendored `@zxing/library` UMD fallback (iOS Safari). A pure, DOM-free `docs/lib/aamva.js` does the parsing and is unit-tested in Node. Phase 1 has **no backend/crypto** — the QR's `sessionId`/`key` are parsed from the URL (to lock the contract) but unused; "Send" just assembles and displays the payload object.

**Tech Stack:** Vanilla ESM JS, `node --test`, `BarcodeDetector` API, `@zxing/library` (UMD), Web `getUserMedia`. No build step (static page).

**Spec:** `specs/2026-06-16-phone-license-scan-design.md`. This plan implements only **Phase 1**; Phases 2 (encrypted relay) and 3 (extension pairing + autofill) get their own plans.

---

## File structure

| File | Responsibility |
|------|----------------|
| `docs/lib/aamva.js` (create) | Pure `parseAAMVA(text)` → `{firstName, middleName, lastName, suffix, dob, dlnPid, iin, jurisdiction, isMichigan}`. No DOM. |
| `tests/aamva.test.js` (create) | Node unit tests for `parseAAMVA` with Michigan DL, Michigan ID, and out-of-state fixtures. |
| `docs/lib/zxing.min.js` (create, vendored) | `@zxing/library` UMD build (PDF417 decoder) for the iOS fallback. |
| `docs/scan.html` (create) | Branded page markup: camera screen, review screen, co-buyer prompt, done screen. |
| `docs/scan.css` (create) | Navy/gold theme matching the extension. |
| `docs/scan.js` (create) | Page logic: camera + decode, parse, buyer/co-buyer flow, review, jurisdiction note, stub "Send". |
| `package.json` (modify) | Exclude `docs/lib/zxing.min.js` from the `check` script (minified vendor file). |

---

### Task 1: AAMVA parser (pure, TDD)

**Files:**
- Create: `docs/lib/aamva.js`
- Test: `tests/aamva.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/aamva.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseAAMVA } from "../docs/lib/aamva.js";

// Minimal but realistic AAMVA PDF417 payloads. Element separator is LF; the
// data segment starts with the 2-char subfile type ("DL"/"ID") then elements.
// DOB element DBB is MMDDCCYY. Michigan Issuer ID Number (IIN) = 636032.
const MI_DL =
  "@\n\rANSI 636032100002DL00410234\nDLDAQS123456789012\nDCSGALLANT\nDACJOSEPH\nDADJOHN\nDCUJR\nDBB08081985\nDAJMI\n\r";

const MI_ID =
  "@\n\rANSI 636032100002ID00410200\nIDDAQI987654321000\nDCSDOE\nDACJANE\nDADMARIE\nDBB03221990\nDAJMI\n\r";

const OH_DL =
  "@\n\rANSI 636023100002DL00410234\nDLDAQOH1234567\nDCSSMITH\nDACJOHN\nDADLEE\nDBB12151978\nDAJOH\n\r";

test("parses a Michigan driver's license, isMichigan true", () => {
  const r = parseAAMVA(MI_DL);
  assert.equal(r.firstName, "JOSEPH");
  assert.equal(r.middleName, "JOHN");
  assert.equal(r.lastName, "GALLANT");
  assert.equal(r.suffix, "JR");
  assert.equal(r.dob, "1985-08-08");
  assert.equal(r.dlnPid, "S123456789012");
  assert.equal(r.iin, "636032");
  assert.equal(r.jurisdiction, "MI");
  assert.equal(r.isMichigan, true);
});

test("parses a Michigan state ID, isMichigan true", () => {
  const r = parseAAMVA(MI_ID);
  assert.equal(r.lastName, "DOE");
  assert.equal(r.firstName, "JANE");
  assert.equal(r.middleName, "MARIE");
  assert.equal(r.dob, "1990-03-22");
  assert.equal(r.dlnPid, "I987654321000");
  assert.equal(r.isMichigan, true);
});

test("parses an out-of-state license, isMichigan false", () => {
  const r = parseAAMVA(OH_DL);
  assert.equal(r.lastName, "SMITH");
  assert.equal(r.firstName, "JOHN");
  assert.equal(r.dob, "1978-12-15");
  assert.equal(r.jurisdiction, "OH");
  assert.equal(r.isMichigan, false);
});

test("returns null for non-AAMVA text", () => {
  assert.equal(parseAAMVA("not a license"), null);
  assert.equal(parseAAMVA(""), null);
  assert.equal(parseAAMVA(null), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -A2 aamva`
Expected: FAIL — cannot import `parseAAMVA` (module/file does not exist).

- [ ] **Step 3: Write the parser**

Create `docs/lib/aamva.js`:

```js
/**
 * AAMVA PDF417 driver's-license / state-ID parser (client-side, no DOM).
 *
 * Returns the fields Compliance Central needs plus the issuing jurisdiction so
 * the extension can decide which checks a subject is eligible for (OFAC = any
 * state; Michigan Repeat Offender = Michigan-issued only).
 *
 * The barcode text is a header ("ANSI" + 6-digit Issuer ID Number + versions +
 * subfile directory) followed by a subfile whose elements are LF-separated,
 * each a 3-letter code immediately followed by its value.
 */

const MICHIGAN_IIN = "636032";

// IIN → USPS state, used only to label the jurisdiction when the card omits the
// address-state element (DAJ). Not exhaustive; DAJ is preferred when present.
const IIN_TO_STATE = {
  "636032": "MI",
  "636023": "OH",
};

// Read a single AAMVA element's value: the first occurrence of the 3-letter
// code, up to the next CR/LF. Codes are unique 3-letter tokens and do not occur
// in the numeric header, so an unanchored first-match is safe and avoids the
// "DL"/"ID" subfile prefix that is glued to the first element.
function readElement(text, code) {
  const m = text.match(new RegExp(code + "([^\\r\\n]*)"));
  return m ? m[1].trim() : "";
}

// AAMVA US date of birth is MMDDCCYY (e.g. 08081985 -> 1985-08-08).
function normalizeDob(raw) {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(4, 8)}-${raw.slice(0, 2)}-${raw.slice(2, 4)}`;
  }
  return raw;
}

export function parseAAMVA(text) {
  if (typeof text !== "string" || !text.includes("ANSI")) return null;

  const iinMatch = text.match(/ANSI\s?(\d{6})/);
  const iin = iinMatch ? iinMatch[1] : "";

  const middleRaw = readElement(text, "DAD");
  const daj = readElement(text, "DAJ");

  return {
    firstName: readElement(text, "DAC"),
    middleName: middleRaw === "NONE" ? "" : middleRaw,
    lastName: readElement(text, "DCS"),
    suffix: readElement(text, "DCU"),
    dob: normalizeDob(readElement(text, "DBB")),
    dlnPid: readElement(text, "DAQ"),
    iin,
    jurisdiction: (daj || IIN_TO_STATE[iin] || "").toUpperCase(),
    isMichigan: iin === MICHIGAN_IIN,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | tail -6`
Expected: PASS — total test count increased by 4, 0 failures.

- [ ] **Step 5: Verify syntax check is clean**

Run: `npm run check && echo CHECK_OK`
Expected: prints `CHECK_OK` (no syntax errors in the new files).

- [ ] **Step 6: Commit**

```bash
git add docs/lib/aamva.js tests/aamva.test.js
git commit -m "feat(scan): AAMVA PDF417 parser with jurisdiction detection + tests"
```

---

### Task 2: Branded scan page shell (HTML + CSS)

**Files:**
- Create: `docs/scan.html`
- Create: `docs/scan.css`

- [ ] **Step 1: Create the page markup**

Create `docs/scan.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Scan License — Compliance Central</title>
  <link rel="icon" href="../icons/icon32.png" />
  <link rel="stylesheet" href="scan.css" />
</head>
<body>
  <header class="cc-header">
    <img class="cc-logo" src="../icons/icon128.png" alt="Compliance Central" />
    <div class="cc-title">
      <h1>Compliance Central</h1>
      <span class="cc-subtitle">Michigan Dealer Compliance Hub</span>
    </div>
  </header>

  <main class="cc-main">
    <!-- Camera / scanning screen -->
    <section id="cameraScreen" class="screen">
      <h2 id="captureHeading">Scan the buyer's license</h2>
      <p class="hint">Line up the <strong>barcode on the back</strong> of the Michigan
        driver's license or state ID inside the frame.</p>
      <div class="viewport">
        <video id="video" playsinline muted></video>
        <div class="frame-guide" aria-hidden="true"></div>
      </div>
      <p id="status" class="status" role="status" aria-live="polite">Starting camera…</p>
      <button id="startBtn" class="btn btn-primary hidden">Start camera</button>
    </section>

    <!-- Review screen -->
    <section id="reviewScreen" class="screen hidden">
      <h2 id="reviewHeading">Confirm the details</h2>
      <dl id="fields" class="fields"></dl>
      <p id="jurisdictionNote" class="note hidden"></p>
      <div class="actions">
        <button id="rescanBtn" class="btn btn-ghost">Re-scan</button>
        <button id="confirmBtn" class="btn btn-primary">Looks good</button>
      </div>
    </section>

    <!-- Co-buyer prompt -->
    <section id="cobuyerPrompt" class="screen hidden">
      <h2>Is there a co-buyer?</h2>
      <p class="hint">A co-buyer is a second person on the deal. Scan their license too,
        or finish with just the buyer.</p>
      <div class="actions">
        <button id="noCoBuyerBtn" class="btn btn-ghost">No co-buyer</button>
        <button id="yesCoBuyerBtn" class="btn btn-primary">Scan co-buyer</button>
      </div>
    </section>

    <!-- Done screen -->
    <section id="doneScreen" class="screen hidden">
      <div class="done-check" aria-hidden="true">✓</div>
      <h2>Scan complete</h2>
      <p class="hint">Return to your computer — the form will fill automatically.</p>
      <pre id="payloadPreview" class="payload-preview"></pre>
      <button id="startOverBtn" class="btn btn-ghost">Start over</button>
    </section>

    <section id="errorBanner" class="error-banner hidden" role="alert"></section>
  </main>

  <script src="lib/zxing.min.js"></script>
  <script src="scan.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: Create the branded stylesheet**

Create `docs/scan.css` (tokens copied from the extension's `sidepanel.css`):

```css
:root {
  --bg-primary: #0a1628;
  --bg-card: #122a45;
  --text-primary: #ffffff;
  --text-secondary: #b8c9db;
  --text-muted: #6b8299;
  --accent: #00274c;
  --accent-gradient: linear-gradient(135deg, #00274c 0%, #003d73 100%);
  --gold: #ffcb05;
  --success: #22c55e;
  --warning: #f59e0b;
  --warning-bg: rgba(245, 158, 11, 0.12);
  --border: rgba(255, 255, 255, 0.10);
  --radius: 12px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  padding: env(safe-area-inset-top) 16px 24px;
}

.cc-header {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 20px;
}
.cc-logo { width: 44px; height: 44px; }
.cc-title h1 { font-size: 20px; letter-spacing: 0.3px; }
.cc-subtitle { color: var(--gold); font-size: 12px; font-weight: 600; }

.cc-main { max-width: 520px; margin: 0 auto; }
.screen { display: flex; flex-direction: column; gap: 16px; }
.screen.hidden, .hidden { display: none !important; }

h2 { font-size: 18px; }
.hint { color: var(--text-secondary); font-size: 14px; line-height: 1.5; }

.viewport { position: relative; width: 100%; aspect-ratio: 3 / 2;
  background: #000; border-radius: var(--radius); overflow: hidden; }
#video { width: 100%; height: 100%; object-fit: cover; }
.frame-guide {
  position: absolute; inset: 18% 8%; border: 3px solid var(--gold);
  border-radius: 8px; box-shadow: 0 0 0 100vmax rgba(0,0,0,0.35);
}
.status { color: var(--text-muted); font-size: 14px; text-align: center; }

.fields { background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px; }
.fields > div { display: flex; justify-content: space-between; gap: 12px;
  padding: 8px 0; border-bottom: 1px solid var(--border); }
.fields > div:last-child { border-bottom: none; }
.fields dt { color: var(--text-muted); font-size: 13px; }
.fields dd { font-weight: 600; text-align: right; }

.note { background: var(--warning-bg); border: 1px solid var(--warning);
  color: var(--warning); border-radius: var(--radius); padding: 12px; font-size: 13px; }

.actions { display: flex; gap: 12px; }
.btn { flex: 1; padding: 14px 16px; border: none; border-radius: var(--radius);
  font-size: 16px; font-weight: 600; cursor: pointer; }
.btn-primary { background: var(--accent-gradient); color: #fff; }
.btn-ghost { background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border); }

.done-check { font-size: 56px; color: var(--success); text-align: center; }
.payload-preview { background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 12px; font-size: 11px; color: var(--text-muted);
  white-space: pre-wrap; word-break: break-all; max-height: 220px; overflow: auto; }

.error-banner { background: rgba(239,68,68,0.12); border: 1px solid #ef4444;
  color: #ef4444; border-radius: var(--radius); padding: 12px; font-size: 14px; margin-top: 16px; }
```

- [ ] **Step 3: Verify the page renders (desktop, no camera assertions yet)**

Run: `cd "/Users/joegallant/AI App Development Projects/compliance-central" && python3 -m http.server 8777 --directory docs >/tmp/scan_srv.log 2>&1 &`
Then open `http://localhost:8777/scan.html` in a browser.
Expected: branded header (logo + "Compliance Central / Michigan Dealer Compliance Hub"), camera screen heading "Scan the buyer's license", gold frame guide. (Camera may prompt/!work on http localhost — that's fine here; Task 5 verifies camera on a real device over HTTPS.) Stop the server afterward: `kill %1` or `pkill -f "http.server 8777"`.

- [ ] **Step 4: Commit**

```bash
git add docs/scan.html docs/scan.css
git commit -m "feat(scan): branded mobile scan page shell (HTML + CSS)"
```

---

### Task 3: Vendor the ZXing decoder + exclude from syntax check

**Files:**
- Create: `docs/lib/zxing.min.js`
- Modify: `package.json` (the `check` script)

- [ ] **Step 1: Download the ZXing UMD build**

Run:
```bash
cd "/Users/joegallant/AI App Development Projects/compliance-central"
curl -fL https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js -o docs/lib/zxing.min.js
ls -l docs/lib/zxing.min.js
```
Expected: a file of ~400–800 KB is written. (This UMD bundle exposes a global `ZXing` with `BrowserMultiFormatReader`, `DecodeHintType`, `BarcodeFormat`.)

- [ ] **Step 2: Confirm the global the page expects is present**

Run: `grep -c "BrowserMultiFormatReader" docs/lib/zxing.min.js`
Expected: a number ≥ 1 (the class the page uses exists in the bundle).

- [ ] **Step 3: Exclude the minified vendor file from `node --check`**

Modify `package.json` — change the `check` script's `find` to also exclude the new file (it currently excludes `./lib/jspdf.umd.min.js`). New value:

```json
"check": "for f in $(find . -name '*.js' -not -path './lib/jspdf.umd.min.js' -not -path './docs/lib/zxing.min.js' -not -path './node_modules/*'); do node --check \"$f\" || exit 1; done",
```

- [ ] **Step 4: Verify check still passes**

Run: `npm run check && echo CHECK_OK`
Expected: prints `CHECK_OK` (the minified bundle is skipped; `docs/lib/aamva.js` still checked).

- [ ] **Step 5: Commit**

```bash
git add docs/lib/zxing.min.js package.json
git commit -m "chore(scan): vendor @zxing/library UMD (PDF417 fallback), exclude from check"
```

---

### Task 4: Scan page logic (camera, decode, parse, flow, review, stub send)

**Files:**
- Create: `docs/scan.js`

- [ ] **Step 1: Write the page controller**

Create `docs/scan.js`:

```js
import { parseAAMVA } from "./lib/aamva.js";

// Phase 1: sessionId + key are parsed to lock the URL contract but NOT used yet.
// Phase 2 will encrypt the payload with `keyB64` and POST to the relay for `sessionId`.
const params = new URLSearchParams(location.search);
const sessionId = params.get("s") || "";
const keyB64 = new URLSearchParams(location.hash.slice(1)).get("k") || "";

const el = (id) => document.getElementById(id);
const screens = {
  camera: el("cameraScreen"),
  review: el("reviewScreen"),
  cobuyer: el("cobuyerPrompt"),
  done: el("doneScreen"),
};

const deal = { buyer: null, coBuyer: null };
let capturing = "buyer"; // "buyer" | "coBuyer"
let pending = null; // last parsed result awaiting confirmation
let stream = null;
let zxingReader = null;
let detectorLoop = false;

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

function stopCamera() {
  detectorLoop = false;
  if (zxingReader) { try { zxingReader.reset(); } catch {} }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

// Resolve with the raw AAMVA barcode text from the camera.
async function scanRawBarcode() {
  const video = el("video");
  if ("BarcodeDetector" in window) {
    let formats = [];
    try { formats = await window.BarcodeDetector.getSupportedFormats(); } catch {}
    if (formats.includes("pdf417")) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ["pdf417"] });
      detectorLoop = true;
      return new Promise((resolve) => {
        const tick = async () => {
          if (!detectorLoop) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length && codes[0].rawValue) { resolve(codes[0].rawValue); return; }
          } catch {}
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
  }
  // Fallback: ZXing handles getUserMedia + decode (iOS Safari).
  if (typeof ZXing === "undefined") throw new Error("Barcode scanner failed to load.");
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  zxingReader = new ZXing.BrowserMultiFormatReader(hints);
  return new Promise((resolve, reject) => {
    zxingReader
      .decodeFromConstraints({ video: { facingMode: "environment" } }, video, (result) => {
        if (result) resolve(result.getText());
      })
      .catch(reject);
  });
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function beginCapture(which) {
  capturing = which;
  clearError();
  el("captureHeading").textContent =
    which === "buyer" ? "Scan the buyer's license" : "Scan the co-buyer's license";
  show("camera");
  el("status").textContent = "Point the camera at the barcode…";
  try {
    const raw = await scanRawBarcode();
    stopCamera();
    const parsed = parseAAMVA(raw);
    if (!parsed || !parsed.dlnPid) {
      showError("Couldn't read that barcode. Try again, holding steady and well-lit.");
      return beginCapture(which);
    }
    pending = parsed;
    renderReview(parsed);
    show("review");
  } catch (e) {
    stopCamera();
    showError("Camera error: " + (e && e.message ? e.message : "unable to access camera."));
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

function finish() {
  // Guard: same license scanned twice.
  if (deal.coBuyer && deal.buyer && deal.coBuyer.dlnPid === deal.buyer.dlnPid) {
    showError("Buyer and co-buyer have the same license number — did you scan the same card twice?");
  }
  const payload = {
    buyer: deal.buyer,
    coBuyer: deal.coBuyer || null,
    scannedAt: new Date().toISOString(),
  };
  // Phase 1: display the assembled payload (Phase 2 encrypts + relays it).
  el("payloadPreview").textContent = JSON.stringify(payload, null, 2);
  show("done");
}

function resetAll() {
  deal.buyer = null;
  deal.coBuyer = null;
  pending = null;
  capturing = "buyer";
  clearError();
  beginCapture("buyer");
}

el("confirmBtn").addEventListener("click", onConfirm);
el("rescanBtn").addEventListener("click", () => beginCapture(capturing));
el("yesCoBuyerBtn").addEventListener("click", () => beginCapture("coBuyer"));
el("noCoBuyerBtn").addEventListener("click", finish);
el("startOverBtn").addEventListener("click", resetAll);
el("startBtn").addEventListener("click", () => beginCapture(capturing));

// Auto-start the camera on load (button is the manual fallback if blocked).
beginCapture("buyer");
```

- [ ] **Step 2: Verify syntax check passes**

Run: `npm run check && echo CHECK_OK`
Expected: prints `CHECK_OK` (`docs/scan.js` parses as valid ESM).

- [ ] **Step 3: Smoke-test the flow logic locally (desktop)**

Run: `python3 -m http.server 8777 --directory docs >/tmp/scan_srv.log 2>&1 &` then open `http://localhost:8777/scan.html` in Chrome on the desktop. Allow camera if prompted. With no real license, you can't decode — but verify: no console errors on load, the camera screen shows, and the ZXing global loaded (`typeof ZXing` in console is `"object"`/`"function"`, not `"undefined"`). Stop: `pkill -f "http.server 8777"`.
Expected: page loads clean, camera viewfinder appears (or a clear camera-error banner), no uncaught exceptions.

- [ ] **Step 4: Commit**

```bash
git add docs/scan.js
git commit -m "feat(scan): camera + decode + AAMVA parse + buyer/co-buyer capture flow"
```

---

### Task 5: Real-device verification (manual — the core Phase 1 proof)

**Files:** none (verification only).

This is the point of Phase 1: confirm a real Michigan license decodes on real phones. Camera + decode cannot be unit-tested, so this step is manual and required.

- [ ] **Step 1: Deploy the page to GitHub Pages**

The page is static and unlinked, so deploying early is safe.
```bash
git push
```
Wait ~1 min for Pages to publish, then confirm it serves:
Run: `curl -fsS -o /dev/null -w "%{http_code}\n" https://techsavvyjoe.github.io/compliance-central/scan.html`
Expected: `200`.

- [ ] **Step 2: Verify on Android (native BarcodeDetector path)**

On an Android phone in Chrome, open `https://techsavvyjoe.github.io/compliance-central/scan.html`. Allow camera. Scan the **back** of a real Michigan driver's license.
Expected: the review screen shows the correct Name / DOB / DLN, "Issuing state: MI", and **no** out-of-state note. Tap "Looks good" → co-buyer prompt → "No co-buyer" → done screen shows the payload JSON with `isMichigan: true`.

- [ ] **Step 3: Verify on iPhone (ZXing fallback path)**

On an iPhone in Safari, open the same URL. Allow camera. Scan the same license.
Expected: same correct fields (this exercises the ZXing path since iOS lacks `BarcodeDetector`). If decoding is slow, confirm it still resolves within a few seconds of steady framing.

- [ ] **Step 4: Verify the out-of-state + co-buyer paths**

If an out-of-state license is available, scan it as the buyer: expect "Issuing state: <XX>" and the amber out-of-state note. Then exercise co-buyer: buyer scan → "Scan co-buyer" → second scan → done screen payload contains both `buyer` and `coBuyer`. Scanning the same card for both should surface the "same license number" warning.

- [ ] **Step 5: Record results**

Note which phones/path worked and any decode-reliability observations (lighting, distance) in the PR/commit description. If a path fails, capture the console error (Android: chrome://inspect; iPhone: Safari Web Inspector) — that informs whether to adjust the decoder approach before Phase 2.

---

## Self-Review

**Spec coverage (Phase 1 portions of `specs/2026-06-16-phone-license-scan-design.md`):**
- Mobile scan page, branded → Tasks 2 + 4. ✓
- `BarcodeDetector` + ZXing-WASM fallback (both phones) → Task 3 (vendor) + Task 4 (both paths) + Task 5 (verify each). ✓
- AAMVA parse incl. jurisdiction / `isMichigan` → Task 1. ✓
- Accept any state; out-of-state note (not rejected) → Task 4 `renderReview` note; verified Task 5 Step 4. ✓
- Buyer + optional co-buyer capture, review before send, same-license guard → Task 4 flow. ✓
- `parseAAMVA` unit-tested with MI DL + MI ID + out-of-state → Task 1 tests. ✓
- Networking stubbed in Phase 1 → Task 4 `finish()` displays payload, no POST. ✓
- URL contract (`?s=` + `#k=`) parsed but unused → Task 4 top. ✓
- (Phase 2/3 items — relay, crypto, extension QR/autofill, privacy-policy — intentionally NOT in this plan.)

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. Camera steps are manual-by-necessity and explicitly labeled. ✓

**Type/name consistency:** `parseAAMVA` returns `{firstName, middleName, lastName, suffix, dob, dlnPid, iin, jurisdiction, isMichigan}` in Task 1 and is consumed with those exact names in Task 4 (`renderReview`, `finish`). Screen IDs in `scan.html` (Task 2: `cameraScreen`, `reviewScreen`, `cobuyerPrompt`, `doneScreen`, `captureHeading`, `reviewHeading`, `fields`, `jurisdictionNote`, `status`, `video`, `payloadPreview`, `errorBanner`, and buttons `startBtn`/`rescanBtn`/`confirmBtn`/`yesCoBuyerBtn`/`noCoBuyerBtn`/`startOverBtn`) match the `el(...)`/`screens` references in `scan.js` (Task 4). ✓
