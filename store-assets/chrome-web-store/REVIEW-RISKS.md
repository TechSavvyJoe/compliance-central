# Review Risks — 1.6.0 Update

The five things on THIS update most likely to draw a reviewer question, with the prepared
answer for each. Every claim below is verifiable in the uploaded package — do not answer a
reviewer with anything this repo contradicts.

---

## 1. Two new host permissions on an update

**Why it draws attention:** permission increases on updates get extra scrutiny, and this one
also disables the extension for every existing user until they re-consent. v1.3.1 declared
three hosts; 1.6.0 adds `dsvsesvc.sos.state.mi.us` and `vpic.nhtsa.dot.gov`.

**Prepared answer:**
- `dsvsesvc.sos.state.mi.us` — the extension loads official Michigan plate-design artwork
  shown beside a fee quote (`src/sidepanel/sos-plate-catalog.js` requests
  `https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/...`). That is the only request the
  extension itself makes to this host; the SOS fee calculator is driven by the backend after
  an explicit Calculate action.
- `vpic.nhtsa.dot.gov` — one endpoint
  (`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended`,
  `src/sidepanel/vin-lookup.js`), called only when the user clicks Decode VIN. The raw VIN is
  discarded from the returned object and never written to storage or sent to SOS.
- Both are narrow, single-host patterns tied to explicit user actions; no wildcard or broad
  match is requested, and the extension still has no `tabs` permission and zero `chrome.tabs`
  calls. Related plate-gallery images from `www.michigan.gov` load as plain images without
  any host permission, which is why that host is not in the list.
- The user-facing consequence (disabled until re-accepted) is disclosed in the What's New
  entry, first bullet.

## 2. Government-ID data sent to the developer's own service

**Why it draws attention:** the extension transmits name, date of birth, and a driver's
license/PID number — plus a VIN for title checks — to `compliance-central-api.fly.dev`.
That is the highest-sensitivity pattern in the User Data Policy.

**Prepared answer:**
- Transmission happens only for the user-requested MDOS Repeat Offender and Title/Lien
  checks, over HTTPS, because the Michigan portal requires those exact fields. OFAC
  screening is fully on-device and transmits nothing.
- The backend processes the fields in memory to fetch the portal response and does not
  intentionally retain them — nothing is written to its database or application log. The
  request IP is used transiently in memory for rate limiting only.
- On-device retention is bounded and disclosed: up to 30 days / 50 records, clearable from
  Settings or History, removed on uninstall.
- Prominent disclosure is in the UI before any collection: the side panel's data-use
  disclosure renders open until the user has read it, and 1.6.0 adds a one-time notice to
  existing users that saved records now keep the submitted fields and captured state pages
  (`sidepanel.html` `dataUseDetails` / `retentionNotice`). The privacy policy
  (effective 2026-08-18) says the same things the listing does.
- Data is not sold, not used for anything unrelated, and not used for credit/lending — the
  three certifications are checked and true.

## 3. A built-in API key visible in the shipped source

**Why it draws attention:** `lib/config.js` ships
`defaultApiKey: "cc_live_bbafa0f7..."` in plain text. A reviewer reading the package may
flag it as an exposed credential.

**Prepared answer:**
- It is not a secret and not an authentication boundary — it is a shipped soft-throttle
  identifier so the extension works with zero setup, and the code comment above it says
  exactly that. Real abuse protection is server-side: rate limiting plus a per-machine check
  queue.
- No user data can be obtained with the key. The phone-scan relay's security does not depend
  on it: the relay holds only an encrypted, single-use package protected by an unguessable
  128-bit session id, and the AES-GCM key exists only in the QR fragment — it never reaches
  the server.
- Rotation is one server-side change (`CC_API_KEY`) plus shipping a new value, so exposure
  is recoverable by design.
- Do not "fix" this before submission by obfuscating the key — a reviewer finding an
  obfuscated credential looks far worse than a commented, deliberate design.

## 4. Screenshots showing PII-like sample data

**Why it draws attention:** the product's screenshots necessarily show names, birth dates,
license numbers, and a driver's-license image — a reviewer may ask whether real people or
real documents appear.

**Prepared answer:**
- All sample data in every screenshot is fictional. The phone-scan screenshot is visibly
  labeled "Instructional composite · Phone scan" and uses fictional ID artwork — it is not a
  live capture of a real identity document. The History screenshot uses fictional customers
  and app-generated record ids (e.g. CC-20260722-091421). Both labels are pinned by
  `tests/release-copy.test.js` against the asset builder.
- Before uploading, open each regenerated image and confirm the labels survived — if the
  composite label is missing from the scan screenshot, regenerate before submitting.
- Related: exported OFAC records are branded as app-generated ("Compliance Central OFAC
  Screening Record — Not issued or endorsed by the U.S. Treasury or OFAC"); nothing imitates
  government letterhead.

## 5. A three-minor-version jump against a listing written for 1.3.1

**Why it draws attention:** the live listing describes 1.3.1; this upload is 1.6.0, and
1.3.2–1.5.1 were never uploaded. A reviewer diffing behavior against the old listing text
could find drift, and one old claim was materially wrong.

**Prepared answer:**
- All listing copy was rewritten for 1.6.0 and is pinned to the code by
  `tests/release-copy.test.js`. The important correction: earlier copy said the SOS fee
  calculator ran "in an inactive background tab" — since the server-side rework, the backend
  runs the public calculator and returns the fee plus a capture of the result page. Nothing
  opens on the user's computer, the extension does not request the `tabs` permission, and
  there are zero `chrome.tabs` calls in the package.
- Feature breadth is still one purpose — Michigan dealer deal screening — and the single
  purpose statement covers all five surfaces (OFAC, Repeat Offender, Title/Lien, SOS fee
  quote, phone scan). The What's New entry discloses everything shipped since 1.3.1,
  including the removal of built-in dealership branding (now per-install Settings) and the
  retention change with its one-time user notice.
