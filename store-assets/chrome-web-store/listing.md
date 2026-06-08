# Compliance Central — Chrome Web Store Listing Copy (v1.2.0)

Paste these fields into the Chrome Web Store Developer Dashboard at submission.
Privacy policy URL: **https://techsavvyjoe.github.io/compliance-central/**

---

## Product name
Compliance Central - Michigan Dealer Compliance Hub

## Short description (≤132 chars — used in manifest)
Unified compliance screening for Michigan auto dealers. OFAC sanctions, Repeat Offender, and Title/Lien checks in one sidebar tool.

## Category
Productivity (alternate: Workflow & Planning / Business tools)

## Language
English (United States)

---

## Single purpose statement
Compliance Central lets Michigan automotive dealers screen buyers and co-buyers for OFAC sanctions, MDOS repeat-offender status, and vehicle title/lien status from a single browser side panel, and produce a printable record of the result.

---

## Detailed description (≤4000 chars)
Compliance Central brings the three checks every Michigan auto dealer needs into one fast, organized side panel — no juggling tabs, portals, or spreadsheets.

WHAT IT CHECKS
• OFAC Sanctions Screening — Matches the buyer (and co-buyer) against the U.S. Treasury OFAC SDN list. Runs entirely on your device, so no customer data leaves your computer for this check.
• Repeat Offender (MDOS) — Confirms the customer's eligibility through the Michigan Department of State portal.
• Title & Lien — Looks up a trade-in VIN for title brand, title status, and active liens.

WHY DEALERS USE IT
• One screen, one click. Enter the customer once and run all three checks together, or run any check on its own.
• A clean "Deal Jacket." Every run produces a clear APPROVED / REVIEW / DENIED decision you can print or save as a PDF for your records.
• Built-in history. Recent checks are kept locally so you can re-open, re-print, or export the evidence later.
• Fast date entry. A decade-based date-of-birth picker makes entering older customers quick and accurate.
• Co-buyer support. Screen a co-buyer in the same run.

HOW IT WORKS
OFAC screening works immediately with no setup. The Repeat Offender and Title/Lien checks connect to the secure Compliance Central backend (which queries the MDOS portal for you) and require a dealer API key — enter it once in Settings. Need a key? Use the "Request access" link in Settings.

PRIVACY
• OFAC screening is 100% local — no customer data is transmitted.
• For MDOS checks, the name, date of birth, DLN/PID, and VIN are sent over HTTPS to our backend, used to obtain the official result, and then discarded — never stored or logged on our servers.
• No tracking. No analytics. No ads.
Full policy: https://techsavvyjoe.github.io/compliance-central/

Built for Michigan dealerships that want their OFAC, repeat-offender, and title/lien compliance in one place — accurate, documented, and fast.

---

## What's new in 1.2.0
• New Settings panel to add your backend API key directly in the extension — no more developer tools.
• Clearer guidance when MDOS checks need a key (OFAC keeps working without one).
• OFAC data-freshness warning so you never screen against an outdated sanctions list.
• More reliable "Run All Checks" (protected against double-runs; one failing check no longer hides the others).
• Refreshed store media and privacy policy.

---

## Permission justifications (one per permission)
- **sidePanel** — The entire user interface is a Chrome side panel; this permission opens and renders it.
- **storage** — Saves the dealer's compliance history, preferences, and backend API key locally on the device.
- **unlimitedStorage** — The OFAC SDN dataset plus historical compliance records (with evidence screenshots) can exceed the default quota.
- **alarms** — Schedules an automatic daily refresh of the local OFAC sanctions list so screenings use current data.
- **Host permission: https://data.opensanctions.org/** — Downloads the public OFAC SDN list used for on-device sanctions screening.
- **Host permission: https://compliance-central-api.fly.dev/** — The dealer's backend endpoint that performs the Repeat Offender and Title/Lien checks against the MDOS portal.

(No remote code is executed; all extension code is bundled. No broad host permissions are requested.)

---

## Data safety / privacy practices (dashboard form answers)
**Does this item collect or use user data?** Yes.

Data handled (entered by the dealer about a customer):
- Personally identifiable information — name, date of birth, government ID (Michigan DLN/PID): **Collected, transmitted (HTTPS) to the extension's backend for MDOS checks only. Not sold. Not stored server-side.**
- Vehicle identifier (VIN): transmitted for the optional title check only.

Certifications to check in the form:
- ☑ Data is **not** sold to third parties.
- ☑ Data is **not** used for purposes unrelated to the item's single purpose.
- ☑ Data is **not** used to determine creditworthiness or for lending.
- ☑ Data is encrypted in transit (HTTPS).
- ☑ OFAC screening data is processed locally and never transmitted.
- ☑ Users can request deletion / clear local data (history clear + uninstall; backend retains nothing).

A privacy policy URL is provided (above).

---

## Submission notes
- This is version 1.2.0. If a prior version was never published, this is a **new** public listing; if 1.1.0 was published, upload 1.2.0 as an **update**.
- Screenshots (1280×800) and promo tiles live in `store-assets/chrome-web-store/images/`.
- Developer contact email is required in the account settings and is shown publicly — set a dedicated support inbox (placeholder used in code/policy: support@compliancecentral.app).
- Replace the `Request access` URL and support email placeholders in `lib/config.js` (CONFIG.support) and the privacy policy with your real values before submitting.
