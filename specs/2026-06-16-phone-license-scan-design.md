# Phone → Extension Driver's-License Scan — Design

- **Date:** 2026-06-16
- **Status:** Approved (brainstorm complete) — pending implementation plan
- **Component:** Compliance Central Chrome extension (MV3) + `compliance-central-api` (Fly) + GitHub Pages site

## Goal

Let a dealer scan a customer's driver's license with their **phone** and have the
parsed fields auto-fill the extension's form on their desktop — capturing the
**buyer and (optionally) the co-buyer** in one session. This removes manual typing,
which is both slow and a real compliance risk: a mistyped name is exactly how a true
OFAC SDN match gets *missed*.

The license's PDF417 barcode (back of the card, AAMVA standard) encodes name, DOB,
and license number as structured text. "Scanning" = capture the barcode → parse the
AAMVA fields → relay to the extension → autofill.

## Scope: jurisdiction drives check eligibility

Any US DL/State ID can be scanned, but the **issuing jurisdiction** decides which checks
the subject is eligible for:

- **OFAC** is a federal, name-based screen that applies to **everyone** — Michigan or
  out-of-state. Always runs.
- **Repeat Offender** is a Michigan Department of State function that searches the
  **Michigan driver record**, so it is only valid for a subject who holds a **Michigan**
  DL/State ID. For an out-of-state subject it is **skipped** (clearly marked, not failed).
- **Title/Lien** keys off the trade-in **VIN**, not a person, so it is unaffected by
  either subject's jurisdiction.

Therefore the scanner **accepts any state's DL/ID** (it never rejects out-of-state cards);
it reads the jurisdiction from the AAMVA data and carries it to the extension, which uses
it to enable/disable the Repeat Offender check per person (buyer and co-buyer independently).
Michigan issuance = AAMVA Issuer Identification Number `636032`.

Manual (non-scan) entry has no jurisdiction signal and is **assumed Michigan** (the tool's
core audience), so it behaves as today — adding a manual out-of-state toggle is out of
scope for this feature.

## Key decisions (locked during brainstorm)

1. **Scope:** Design the full feature now; build and verify the riskiest part (the
   phone scan itself) first.
2. **Privacy:** End-to-end encrypted, **zero-knowledge relay** — the backend only
   ever holds an encrypted blob it cannot read.
3. **Phones:** Both **iPhone and Android** from the start (native `BarcodeDetector`
   on Android; ZXing-WASM fallback for iOS Safari).
4. **Deal capture on the phone:** One pairing session captures buyer (required) and,
   if the dealer indicates one, co-buyer — then sends once. The extension fills both.
5. **Branding:** The mobile page uses the extension's identity — logo (`icon.svg` /
   `icon128.png`), Michigan navy `#00274c` + gold `#ffcb05`, dark card palette, and the
   "Compliance Central / Michigan Dealer Compliance Hub" header.
6. **Transport:** Backend relay with **short polling** (extension polls until the blob
   arrives or the ~2-minute window expires). Chosen over SSE/WebRTC for simplicity and
   robustness; encryption (not transport) provides privacy, so polling costs nothing.
7. **Jurisdiction-aware:** scan accepts any state's DL/State ID and reads the issuing
   jurisdiction (Michigan = AAMVA IIN `636032`). Michigan subjects are eligible for all
   checks; out-of-state subjects get OFAC only — the Michigan Repeat Offender check is
   skipped for them. Determined per person (buyer and co-buyer independently).

## Architecture & components

Four independently testable units:

| Unit | Where | Responsibility |
|------|-------|----------------|
| **Mobile scan page** | `docs/scan.html` (+ assets) on GitHub Pages | Camera, barcode decode, AAMVA parse, buyer/co-buyer capture, encrypt, send. Does all the heavy lifting. |
| **Relay endpoints** | `compliance-central-api` (Fly) | Dumb, zero-knowledge, ephemeral mailbox keyed by session ID. |
| **Pairing UI** | extension side panel | "Scan license" button → QR + status → decrypt → autofill. |
| **AAMVA parser** | mobile page JS (pure fn) | Decoded barcode text → `{firstName, middleName, lastName, suffix, dob, dlnPid}`. Unit-tested. |

## End-to-end flow

1. Dealer clicks **"Scan license"** in the side panel.
2. Extension generates a random **session ID** (128-bit) and a random **AES-256-GCM
   key**, calls `POST /pair/new` (keyed) to open a ~2-minute mailbox, and renders a QR
   encoding: `https://techsavvyjoe.github.io/compliance-central/scan.html?s=<sessionId>#k=<keyB64Url>`.
3. The AES key lives in the URL **fragment** (`#k=…`). Fragments are never sent in an
   HTTP request, so the key only ever travels **optically via the QR** — the GitHub
   Pages host and the Fly backend never see it. This is what makes the relay
   zero-knowledge without an ECDH handshake.
4. Dealer scans the QR with the phone camera → opens the branded scan page.
5. Phone flow:
   a. Scan **buyer's** license → decode → parse → show fields. Any state is accepted; if
      it's **out-of-state**, show a non-blocking note: *"Out-of-state ID — OFAC will run;
      the Michigan Repeat Offender check needs a Michigan DL/State ID."*
   b. Prompt **"Is there a co-buyer?"** (Yes / No).
   c. If Yes → scan **co-buyer's** license → decode → parse → show (same out-of-state note
      if applicable).
   d. **Review** both → **Send**.
   - Guard: if buyer and co-buyer license numbers are identical, warn before sending
     (likely a double-scan of the same card).
6. Phone builds the payload JSON, encrypts it with AES-GCM (random 96-bit IV) using the
   key from the fragment, and `POST /pair/:id/data` with `{iv, ciphertext}` (base64url).
7. Extension polls `GET /pair/:id` (~every 1.5 s). On arrival, the server returns the
   blob and **deletes it**. Extension decrypts locally, validates, and fills the form:
   buyer fields always; if `coBuyer` present, it checks **"Add Co-Buyer"** to reveal the
   section and fills it. One toast: *"License(s) scanned — buyer + co-buyer filled."*
8. Window expiry / cancel / error are handled with clear status.

## Crypto / zero-knowledge design

- **Key:** 256-bit AES-GCM, generated by the extension via Web Crypto
  (`crypto.subtle.generateKey`), exported raw, base64url-encoded into the QR fragment.
- **Encrypt (phone):** import the key from the fragment, `AES-GCM` with a fresh random
  12-byte IV per send. Output `{iv, ciphertext}` base64url.
- **Decrypt (extension):** `crypto.subtle.decrypt` with the same key. On failure
  (tamper / wrong session), discard and show an error.
- **Server sees:** session ID + opaque ciphertext + IV only. Never the key, never
  plaintext, never the license image.
- **Lifetime:** mailbox TTL ~2 min; single-use (deleted on first successful `GET`);
  payload size-capped (≤8 KB); session IDs unguessable (CSPRNG).

## Backend (relay) — `compliance-central-api`

In-memory store (same ephemeral pattern as `metrics.js`), `Map<sessionId, {iv, ciphertext, createdAt}>`
with a periodic sweep for expired entries.

| Endpoint | Auth | Behavior |
|----------|------|----------|
| `POST /pair/new` | **keyed** (x-api-key) | Create an empty slot, return `{sessionId, expiresInSec}`. Only a keyed extension can open a mailbox. |
| `POST /pair/:id/data` | **no key** (capability = unguessable session ID) | Accept `{iv, ciphertext}` if the slot exists, is unexpired, and is empty. Size-capped + rate-limited. Mounted **before** the global `apiKeyAuth` middleware. |
| `GET /pair/:id` | **keyed** (x-api-key) | If filled, return the blob once and delete the slot; else `204`. |

- **CORS:** allow `https://techsavvyjoe.github.io` for `POST /pair/:id/data` (the phone
  origin). Keyed endpoints are called by the extension; confirm the extension origin is
  permitted by the existing CORS config.
- **Auth ordering:** the global `apiKeyAuth` currently guards every route; the phone
  endpoint must be exempt. Mount the pairing router (or just the `:id/data` route) ahead
  of `apiKeyAuth`, with the session ID as its capability and a dedicated rate limit.
- **Abuse limits:** cap concurrent open slots; rate-limit `POST /pair/:id/data` and
  `POST /pair/new`; reject oversized bodies. Pure relay — never logs plaintext (there is
  none) and never logs the ciphertext.

## Mobile scan page — `docs/scan.html`

- **Branding:** navy/gold theme reusing the extension's tokens; logo + "Compliance
  Central / Michigan Dealer Compliance Hub" header; matches the product look.
- **Decode:** feature-detect `window.BarcodeDetector` with `pdf417` (Android Chrome);
  otherwise load a **locally-bundled ZXing-WASM** decoder (iOS Safari). No remote code.
- **Camera:** `getUserMedia({video:{facingMode:'environment'}})`; viewfinder with a
  framing guide ("line up the barcode on the back of the license").
- **Flow:** scan buyer → review parsed fields → "Is there a co-buyer?" → optional
  co-buyer scan → review → Send. Success screen: *"Sent — return to your computer."*
- **Privacy:** decode + parse + encrypt all happen on the phone; the **image is never
  transmitted** — only the encrypted parsed fields.
- **Hosting:** static on the existing GitHub Pages site (already HTTPS). Reads
  `sessionId` from query and the key from the fragment.

## Extension pairing UI + autofill

- **Entry point:** a "Scan license" button near the name fields (one button; serves
  both buyer and co-buyer because the phone captures both).
- **QR panel:** QR + live status ("Waiting for phone… / Received ✓"), a **Cancel**
  button, and a copyable link fallback (for manual entry on the phone if the QR won't
  scan).
- **QR rendering:** a small **locally-bundled** QR-encoder library (shipped like
  `lib/jspdf.umd.min.js`), so no remote scripts (MV3 CSP-safe).
- **On receipt:** decrypt → validate shape → fill buyer fields via the existing form
  inputs; if `coBuyer` present, set `#hasCoBuyer` checked (dispatch `change` to reveal
  the section) and fill `cb*` fields; reuse `setDateInputValue` for DOB; toast on
  success. Cancel/timeout cleanly tears down the session and stops polling.
- **Jurisdiction gating:** stash each person's `isMichigan` in form state (e.g. a
  `data-jurisdiction` attribute / the customer object). At run time, OFAC runs for
  everyone; the **Repeat Offender** check runs only for a Michigan subject — for an
  out-of-state subject it is skipped and shown as *"Not applicable — out-of-state ID"*
  (a distinct state, not an error/fail), buyer and co-buyer evaluated independently. The
  orchestrator and results UI gain a "not applicable / skipped" outcome for this. Title
  is unaffected. Manually-entered subjects (no scan) default to Michigan = eligible.
- **Permissions:** expected **none new** — QR is local, polling targets the
  already-permitted Fly origin, decryption uses built-in Web Crypto.

## Data shapes

QR URL: `…/scan.html?s=<sessionId>#k=<aesKeyBase64Url>`

Decrypted payload (the only thing that crosses, encrypted). Each person carries their
issuing `jurisdiction` + `isMichigan` so the extension can gate the Repeat Offender check:
```json
{
  "buyer":   { "firstName": "", "middleName": "", "lastName": "", "suffix": "", "dob": "YYYY-MM-DD", "dlnPid": "", "jurisdiction": "MI", "isMichigan": true },
  "coBuyer": { "firstName": "", "middleName": "", "lastName": "", "suffix": "", "dob": "YYYY-MM-DD", "dlnPid": "", "jurisdiction": "OH", "isMichigan": false },
  "scannedAt": "ISO-8601"
}
```
`coBuyer` is `null` when none. DOB normalized to the extension's expected format on fill.

Relay body (opaque to server): `{ "iv": "<b64url>", "ciphertext": "<b64url>" }`.

## AAMVA parsing

- AAMVA DL/ID subfile elements: `DAC`=first name, `DAD`=middle name, `DCS`=last name,
  `DBB`=DOB (`MMDDCCYY`), `DAQ`=license/ID number, `DCU`=name suffix. (Older/jurisdiction
  variants exist — e.g. a combined `DAA` full-name field — so the parser must tolerate
  missing elements and fall back gracefully.)
- Pure function `parseAAMVA(text) -> {firstName, middleName, lastName, suffix, dob, dlnPid, iin, jurisdiction, isMichigan}`,
  tolerant of the `@\n\rANSI ` header and element/segment separators.
- **Jurisdiction:** read the Issuer Identification Number from the header; `isMichigan`
  is `iin === "636032"`. The scan is **accepted regardless of state** — `isMichigan` is
  carried to the extension to drive Repeat Offender eligibility, never to reject the card.
- Normalize DOB to the extension's date format; trim/uppercase per the form's expectations.
- **Unit-tested** with fixture strings: a Michigan DL and a Michigan State ID (parse +
  `isMichigan === true`), plus an out-of-state sample (parses + `isMichigan === false`).

## Privacy & policy

Add a **"License scan (optional)"** section to `docs/index.html`:
- Scanning and parsing happen entirely on the dealer's phone.
- Parsed fields are **end-to-end encrypted**; the server relays a single-use,
  short-lived, encrypted blob it cannot read and then deletes it.
- The license **image is never transmitted**.

## Security considerations

- QR is shown only on the dealer's screen; only a phone that can see it gets the key.
- Session IDs are CSPRNG and unguessable; short TTL; single-use; size-capped; rate-limited.
- AES-GCM provides confidentiality + integrity (tampered blobs fail decryption).
- No plaintext or image ever reaches the server.
- The phone endpoint is keyless by design (capability URL); abuse is bounded by TTL +
  rate limits + the requirement that a keyed extension opened the slot.

## Phasing & testing

**Phase 1 — Mobile scan page (build + verify FIRST; de-risks the unknown):**
- Branded `scan.html`: camera, `BarcodeDetector` + ZXing-WASM fallback, AAMVA parse,
  buyer + optional co-buyer capture, on-screen review. (Networking stubbed/omitted.)
- Verify on a **real Android and a real iPhone** with a **real license**.
- Automated: `parseAAMVA` unit tests with multi-state fixtures (no camera needed).

**Phase 2 — Relay + crypto:**
- `POST /pair/new`, `POST /pair/:id/data`, `GET /pair/:id`; TTL/single-use/size-cap;
  CORS for the Pages origin; auth ordering.
- Backend tests: create → fill → fetch-once → expire → reject-second-fill → size-cap →
  rate-limit. Web-Crypto encrypt→decrypt round-trip test in Node.
- Wire the mobile page to encrypt + POST.

**Phase 3 — Extension pairing + autofill:**
- "Scan license" button, QR render (bundled lib), poll, decrypt, validate, fill buyer
  + co-buyer, cancel/timeout, toasts.
- Tests: payload validation + target routing + field-fill mapping (logic-level);
  manual end-to-end on devices. Privacy-policy update shipped with this phase.

## Out of scope / future

- Phone-as-scanner without a phone (USB keyboard-wedge scanner path) — separate, simpler
  feature; can be added later for dealers who prefer hardware.
- Front-of-license OCR, photo capture, address parsing.
- Multi-message sessions / reusing one QR for many deals (current design: one QR = one
  deal capture).
