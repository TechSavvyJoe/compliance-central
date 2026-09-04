# Chrome Web Store — 1.6.1 UPDATE Submission Checklist

**Item:** Compliance Central - Michigan Dealer Compliance Hub
**Item ID:** `oijkbdclicekpggjblgknnphfdafdgod`
**Live version:** 1.3.1 → **Uploading:** 1.6.1 (an UPDATE to the existing listing, not a new submission)
**Prepared:** 2026-08-19

This is the master document: a literal walk of the developer dashboard, tab by tab,
field by field, with the exact value to paste and the file it comes from. Where this
checklist and any older note (including SUBMISSION-PROMPT.txt) disagree, this checklist wins.

Source-of-truth files in this directory:

| File | Feeds |
|---|---|
| `description.txt` | Store listing → Description (3,991 chars; the 4,000 limit leaves 9 to spare — do not pad it) |
| `privacy-tab.txt` | Privacy tab: single purpose, all justifications, data-usage form, Limited Use |
| `listing.md` | Reference copy incl. What's New; not pasted wholesale anywhere |
| `REVIEW-RISKS.md` | Prepared answers if the reviewer asks questions |

---

## ⚠️ Read this before uploading

**This update adds host permissions, and Chrome will disable the extension for every
existing user until they re-consent.**

- v1.3.1 (live) declared three hosts: `sanctionslistservice.ofac.treas.gov`,
  `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com`, `compliance-central-api.fly.dev`.
- v1.6.0 declares five: the same three **plus `dsvsesvc.sos.state.mi.us` (official Michigan
  plate artwork) and `vpic.nhtsa.dot.gov` (NHTSA VIN decoding)**. The four API permissions
  (`sidePanel`, `storage`, `alarms`, `unlimitedStorage`) are unchanged.
- When the update installs, Chrome flags it as requiring new permissions and **disables the
  extension** until the user reviews and accepts them (Extensions menu / `chrome://extensions`).
  Every current user will hit this. The first What's New bullet in `listing.md` tells users
  exactly what happened and what to click — keep it first.
- Expect this update to get a closer review than a routine one: new hosts + government-ID
  data. The prepared answers are in `REVIEW-RISKS.md`.

---

## Pre-flight (before opening the dashboard)

1. `npm test` — all tests green (337 passing as of this writing).
   `tests/release-copy.test.js` pins the store copy to the code and policy; if it fails, fix
   the copy, not the test.
2. `npx eslint .` — clean.
3. `npm run package` — produces `compliance-central-1.6.1.zip` and runs
   `tools/verify-extension-package.mjs`. Confirm in the printed contents:
   - `manifest.json` says `"version": "1.6.1"`;
   - **no** `assets/dealer-logo.webp` (the built-in dealership branding was removed in 1.6.0);
   - no `docs/`, `tests/`, `store-assets/`, or `tools/` inside the zip.
4. Confirm the image set exists and matches the captions in "Graphic assets" below:
   - `store-assets/chrome-web-store/screenshots/screenshot-1.png` … `screenshot-5.png`
   - `store-assets/chrome-web-store/promo-small-440x280.png`
   - `store-assets/chrome-web-store/promo-marquee-1400x560.png`
   These are being regenerated for the 1.6.0 UI by a separate process. **Open every one and
   look at it before uploading** — they must show the redesigned side panel and the SOS plate
   workspace, not the 1.3.1 UI. Do not upload the stale 2026-07-22 JPEGs from `images/` or
   `store-assets/upload/`.
5. The public privacy policy at https://techsavvyjoe.github.io/compliance-central/ is the
   deployed copy of `docs/index.html` (effective August 18, 2026). Confirm the live page shows
   that effective date before submitting — the Privacy-tab answers below quote it.

---

## Tab 1 — Package

| Field | Value |
|---|---|
| Upload | `compliance-central-1.6.1.zip` from the repo root (built in pre-flight step 3) |

After upload the dashboard shows the draft version as 1.6.1 and lists the permissions it
parsed from the manifest. Verify it lists exactly: `sidePanel`, `storage`, `alarms`,
`unlimitedStorage`, and the five hosts from the warning box above. If the dashboard shows a
permission warning banner about new permissions, that is expected — it is the re-consent
behavior described above, not a packaging error.

---

## Tab 2 — Store listing

Fields in dashboard order:

| # | Field | Value | Source |
|---|---|---|---|
| 1 | Title | `Compliance Central - Michigan Dealer Compliance Hub` — taken from the package; not editable here | `manifest.json` `name` |
| 2 | Summary | `Unified compliance screening for Michigan auto dealers. OFAC sanctions, Repeat Offender, and Title/Lien checks in one sidebar tool.` — taken from the package; not editable here | `manifest.json` `description` |
| 3 | Description | Select-all in the box, delete, paste the entire file **exactly** — nothing before or after it | `description.txt` |
| 4 | Category | **Productivity** (if the dashboard offers subcategories, Tools/Workflow is acceptable; do not change from what the live listing already uses unless it is wrong) | `listing.md` |
| 5 | Language | **English (United States)** | `listing.md` |

### Graphic assets (still Tab 2, in dashboard order)

| # | Field | Value |
|---|---|---|
| 6 | Store icon (128×128) | Keep the existing listing icon — it has not changed for 1.6.0. Only re-upload if the dashboard flags it missing. |
| 7 | Global promo video | None — leave empty. |
| 8 | Screenshots (1280×800, exactly five, in this order) | See table below. |
| 9 | Small promo tile (440×280) | `store-assets/chrome-web-store/promo-small-440x280.png` — brand mark and one short tagline on the navy/gold brand ground. No customer data, no UI text too small to read. |
| 10 | Marquee promo tile (1400×560) | `store-assets/chrome-web-store/promo-marquee-1400x560.png` — same brand treatment at marquee size, optionally with a cropped panel mock. No customer data. |

Screenshots in display order (paths under `store-assets/chrome-web-store/screenshots/`):

| Order | File | Caption (one line) | What the image shows |
|---|---|---|---|
| 1 | `screenshot-1.png` | Every check in one side panel — scan the buyer's ID or type it in | The 1.6.0 screening workspace: the phone-scan prompt above the buyer form, with placeholder text only (no filled customer data). |
| 2 | `screenshot-2.png` | One verdict per deal, with the evidence saved under it | A completed screening: the green "Clear to deliver" banner over the Evidence list showing OFAC, Repeat Offender, and Title & Lien each passing. Fictional buyer "Delaney, Marcus". |
| 3 | `screenshot-3.png` | The official plate fee, from the official Michigan SOS calculator | The Plate Calculator with a calculated $179.00 total, 12-month term and expiration, plate artwork, and the enabled customer-print actions. |
| 4 | `screenshot-4.png` | Saved records: reopen, re-screen, print, or delete — on this device, 30 days | The History tab: the "3 local records" summary with two fictional records in frame (Delaney approved with status chips and per-record Re-screen/Delete; Whitfield flagged for review with the aging badge). |
| 5 | `screenshot-5.png` | Your dealership's name on every printed worksheet — no account, no key | Settings showing the service-ready status, the Dealership name field ("Great Lakes Auto Group" — deliberately fictional), the logo control, and the re-screen reminder. |

All five are generated by `node tools/capture-store-shots.mjs`, which renders the **real
sidepanel.html** in headless Chrome rather than a mock-up, so what the listing shows is what
installs. Regenerate after any UI change and re-open each file before uploading.

Sample data in every image is fictional. No real customer name, DOB, licence number, or VIN
appears in any screenshot.

### Additional fields (bottom of Tab 2)

| Field | Value |
|---|---|
| Official URL | Leave as-is (requires a Search-Console-verified domain; do not add one during this update). |
| Homepage URL | `https://techsavvyjoe.github.io/compliance-central/` |
| Support URL | `https://techsavvyjoe.github.io/compliance-central/` |
| Mature content | **No** |

---

## Tab 3 — Privacy

Every paste block below lives in `privacy-tab.txt`; this table is the field map.

| # | Dashboard field | Value |
|---|---|---|
| 1 | Single purpose | The SINGLE PURPOSE block from `privacy-tab.txt` |
| 2 | Permission justification — `sidePanel` | "The entire user interface is a Chrome side panel; this permission opens and renders it." |
| 3 | Permission justification — `storage` | "Saves preferences (including the per-install dealership name and logo printed on the customer fee worksheet) and bounded device-local customer/report history (up to 30 days / 50 records) so an authorized dealership user can reopen, re-screen, print, or download a prior record." |
| 4 | Permission justification — `unlimitedStorage` | "Stores the downloaded OFAC SDN sanctions dataset and bounded device-local report history, including captured state-site evidence images. SOS credentials and authentication tokens are not stored in History." |
| 5 | Permission justification — `alarms` | "Schedules a daily attempt to refresh the local OFAC sanctions list and purge device-local History past the 30-day limit." |
| 6 | Host justification — `sanctionslistservice.ofac.treas.gov` | Treasury SDN list download for on-device screening; no customer data sent. (Full text in `privacy-tab.txt`.) |
| 7 | Host justification — `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com` | Treasury's signed download redirect to its dedicated AWS GovCloud file host; only the public list. (Full text in `privacy-tab.txt`.) |
| 8 | Host justification — `compliance-central-api.fly.dev` | The extension's backend: MDOS Repeat Offender + Title/Lien checks, server-driven SOS fee-calculator runs (the submission includes the registered owner's birthdate, which sets the Michigan expiration date), and the encrypted single-use phone-scan relay it cannot read. In-memory processing; no server-side retention; IP used transiently for rate limiting only. (Full text in `privacy-tab.txt`.) |
| 9 | Host justification — `dsvsesvc.sos.state.mi.us` **(new)** | Loads official Michigan plate-design artwork shown beside a fee quote — the only request the extension itself makes to this host; the fee calculator is driven by the backend. (Full text in `privacy-tab.txt`.) |
| 10 | Host justification — `vpic.nhtsa.dot.gov` **(new)** | Explicit Decode VIN action sends a VIN/partial VIN to NHTSA's public vPIC decoder; the raw VIN is not kept, sent to SOS, or written to storage. (Full text in `privacy-tab.txt`.) |
| 11 | Are you using remote code? | **No.** All code is bundled in the package, including the vendored jsPDF and QR-code libraries in `lib/`; the manifest CSP allows only `'self'` scripts. (Verified: no remote `<script src>`, no `import()` from URLs, no `importScripts` in the package.) |

### Data usage form (question by question)

| Question | Answer |
|---|---|
| Does this item collect or use user data? | **Yes** |
| Personally identifiable information | **Check.** Name, date of birth, government ID (Michigan DLN/PID), and trade-in VIN — entered by the dealer about a customer. Transmitted over HTTPS to the extension's own backend only on user-requested checks: the MDOS Repeat Offender check (name, date of birth, DLN/PID), the Title/Lien check (trade-in VIN), and an explicit SOS fee calculation (the completed calculator fields, including the registered owner's birthdate and, for a transfer, the plate number). Processed in memory server-side; retained on-device in History for up to 30 days / 50 records. |
| Health information | Leave unchecked |
| Financial and payment information | Leave unchecked |
| Authentication information | Leave unchecked |
| Personal communications | Leave unchecked |
| Location | **Check.** The hosting service receives the request IP address; it is used transiently in memory for rate limiting and abuse prevention and is not written to a database or application log. |
| Web history | Leave unchecked |
| User activity | Leave unchecked |
| Website content | **Check.** Michigan Repeat Offender and title/lien responses and screenshots saved in bounded device-local History; SOS fee result-page captures remain session-only. |
| Certification 1 — data is not sold/transferred outside approved use cases | **Check** (true — nothing is sold; data goes only to the extension's own backend to perform the requested check) |
| Certification 2 — data is not used for purposes unrelated to the single purpose | **Check** (true — no ads, analytics, market research, or unrelated use) |
| Certification 3 — data is not used for creditworthiness or lending | **Check** (true) |
| Privacy policy URL | `https://techsavvyjoe.github.io/compliance-central/` |

Retention, in one sentence for any free-text field or reviewer question: *customer data is
kept up to 30 days / 50 records on the user's device (clearable at any time and removed on
uninstall), and is processed only in memory by the backend — never written to its database
or application log.*

---

## Tab 4 — Distribution

| Field | Value |
|---|---|
| Payments | **Free of charge** (unchanged — the extension has no payments) |
| Visibility | **Public** (unchanged) |
| Distribution regions | **Leave exactly as the live 1.3.1 listing has them.** The tool is Michigan-specific; do not broaden the region list as part of this update. |

---

## Submit

1. Click **Save draft**, then re-open each tab and confirm nothing is flagged red.
2. Click **Submit for review**. In the confirm dialog, decide on
   "Publish automatically after it has passed review" — leaving it checked is fine; uncheck
   it only if you want to time the release of the re-consent prompt to a workday.
3. Because this update adds host permissions and handles government-ID data, allow for a
   longer-than-usual review and possible reviewer email. Answer from `REVIEW-RISKS.md` —
   every prepared answer there is verifiable in the uploaded package.
4. After publication, watch for user reports of the extension "turning off" — that is the
   expected re-consent prompt; the What's New entry and the support email
   (joejgallant@gmail.com) both cover it.
