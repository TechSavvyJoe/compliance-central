COMPLIANCE CENTRAL — CHROME WEB STORE LISTING COPY (v1.2.0)

Paste these fields into the Chrome Web Store Developer Dashboard at submission.
Privacy policy URL: https://techsavvyjoe.github.io/compliance-central/


PRODUCT NAME

Compliance Central - Michigan Dealer Compliance Hub


SHORT DESCRIPTION (≤132 chars — used in manifest)

Unified compliance screening for Michigan auto dealers. OFAC sanctions, Repeat Offender, and Title/Lien checks in one sidebar tool.


CATEGORY

Productivity (alternate: Workflow & Planning / Business tools)


LANGUAGE

English (United States)


SINGLE PURPOSE STATEMENT

Compliance Central lets Michigan automotive dealers screen buyers and co-buyers for OFAC sanctions, MDOS repeat-offender status, and vehicle title/lien status from a single browser side panel, and produce a printable record of the result.


DETAILED DESCRIPTION (≤4000 chars)

Compliance Central — The Ultimate Tool for Michigan Auto Dealers

Streamline your dealership's compliance workflow with Compliance Central, the all-in-one browser extension built specifically for Michigan automotive dealers.

Stop juggling multiple tabs and manual searches. Compliance Central lives in your browser's side panel, so you can run critical screenings — OFAC, Repeat Offender, and Title/Lien — in seconds without ever navigating away from your DMS or work screen.

Key Features:

✅ Unified Compliance Dashboard — Run every essential check from one intuitive interface. Enter customer and trade-in data once and screen the buyer (and co-buyer) in a single click.

✅ Instant OFAC Screening — 100% On-Device — Real-time checks against the U.S. Treasury's Specially Designated Nationals (SDN) list. OFAC runs entirely on your computer — no account, no setup, and no customer data ever leaves your device. Advanced fuzzy + alias matching improves accuracy so real matches aren't missed.

✅ Repeat Offender Checks — Verifies a customer's Michigan Department of State (MDOS) Repeat Offender eligibility. Our secure backend queries the MDOS portal on your behalf and returns the official result plus a screenshot for your records.

✅ Title & Lien Verification — Instantly retrieve key trade-in details:
• Title Brand (Clean, Salvage, Rebuilt, etc.)
• Active Liens & Lienholder Information
• Vehicle Weight & Model Year

✅ Professional "Deal Jacket" Reports — Generate a timestamped proof-of-compliance report in one click. Print or save as a PDF for the deal jacket. Recent checks are kept locally so you can re-open, re-print, or export them anytime.

✅ Privacy-Conscious by Design
• OFAC screening is processed entirely on your device — nothing is transmitted.
• For Repeat Offender and Title checks, the customer's name, date of birth, DLN/PID (and VIN) are sent over encrypted HTTPS to our secure backend, used to obtain the official MDOS result, then immediately discarded — never stored or logged on our servers.
• No tracking. No analytics. We never sell your data.
Full policy: https://techsavvyjoe.github.io/compliance-central/

How It Works:
1. Open the Compliance Central side panel.
2. First time only: open Settings and add your backend API key to enable MDOS checks — OFAC works right away without one.
3. Enter the Buyer/Co-Buyer information and Trade-In VIN.
4. Click "Run All Checks."
5. View clear Approved / Review / Denied results instantly.
6. Click "Print All" to document your compliance.

Perfect for: F&I Managers · Sales Managers · Title Clerks · Compliance Officers

Requirements:
• Google Chrome.
• OFAC screening: works immediately — no account required.
• Repeat Offender & Title/Lien checks: a Compliance Central backend API key (request access from the Settings panel).

Take the headache out of compliance. Install Compliance Central today and deal with confidence.


WHAT'S NEW IN 1.2.0

• New Settings panel to add your backend API key directly in the extension — no more developer tools.
• Clearer guidance when MDOS checks need a key (OFAC keeps working without one).
• OFAC data-freshness warning so you never screen against an outdated sanctions list.
• More reliable "Run All Checks" (protected against double-runs; one failing check no longer hides the others).
• Refreshed store media and privacy policy.


PERMISSION JUSTIFICATIONS (one per permission)

sidePanel — The entire user interface is a Chrome side panel; this permission opens and renders it.
storage — Saves the dealer's compliance history, preferences, and backend API key locally on the device.
unlimitedStorage — The OFAC SDN dataset plus historical compliance records (with evidence screenshots) can exceed the default quota.
alarms — Schedules an automatic daily refresh of the local OFAC sanctions list so screenings use current data.
Host permission https://data.opensanctions.org/ — Downloads the public OFAC SDN list used for on-device sanctions screening.
Host permission https://compliance-central-api.fly.dev/ — The dealer's backend endpoint that performs the Repeat Offender and Title/Lien checks against the MDOS portal.

(No remote code is executed; all extension code is bundled. No broad host permissions are requested.)


DATA SAFETY / PRIVACY PRACTICES (dashboard form answers)

Does this item collect or use user data? Yes.

Data handled (entered by the dealer about a customer):
• Personally identifiable information — name, date of birth, government ID (Michigan DLN/PID): Collected, transmitted (HTTPS) to the extension's backend for MDOS checks only. Not sold. Not stored server-side.
• Vehicle identifier (VIN): transmitted for the optional title check only.

Certifications to check in the form:
• Data is NOT sold to third parties.
• Data is NOT used for purposes unrelated to the item's single purpose.
• Data is NOT used to determine creditworthiness or for lending.
• Data is encrypted in transit (HTTPS).
• OFAC screening data is processed locally and never transmitted.
• Users can request deletion / clear local data (history clear + uninstall; backend retains nothing).

A privacy policy URL is provided (above).


SUBMISSION NOTES

• This is version 1.2.0. If a prior version was never published, this is a new public listing; if 1.1.0 was published, upload 1.2.0 as an update.
• Screenshots (1280x800) and promo tiles live in store-assets/chrome-web-store/images/.
• Developer contact email is required in the account settings and is shown publicly — set a dedicated support inbox (placeholder used in code/policy: support@compliancecentral.app).
• Replace the Request access URL and support email placeholders in lib/config.js (CONFIG.support) and the privacy policy with your real values before submitting.
