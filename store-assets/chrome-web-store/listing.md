COMPLIANCE CENTRAL — CHROME WEB STORE LISTING COPY (v1.3.0)

⚠️ THIS IS A REFERENCE DOC — DO NOT PASTE THE WHOLE THING INTO ANY FIELD.
Each section below goes in a DIFFERENT place in the dashboard:

  • Store listing tab → "Description" box  → paste ONLY the file `description.txt`
                                              (the DETAILED DESCRIPTION section).
  • Store listing tab → Category            → Productivity (or Tools).
  • Store listing tab → Language            → English (United States).
  • Privacy tab → "Single purpose"          → the SINGLE PURPOSE STATEMENT.
  • Privacy tab → permission justifications → the PERMISSION JUSTIFICATIONS (one box each).
  • Privacy tab → data usage / disclosures  → the DATA SAFETY answers.
  • Privacy tab → "Privacy policy" URL      → https://techsavvyjoe.github.io/compliance-central/

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

✅ Instant OFAC Screening — 100% On-Device — Checks against the official U.S. Treasury OFAC Specially Designated Nationals (SDN) list, refreshed daily. OFAC runs entirely on your computer — no account, no setup, and no customer data ever leaves your device. Fuzzy and alias matching helps surface spelling and name variations for human review.

✅ Repeat Offender Checks — Verifies a customer's Michigan Department of State (MDOS) Repeat Offender eligibility. Our secure backend returns the official result plus a portal screenshot as current-run evidence for viewing, printing, or PDF export. Screenshots are session-only and are not retained in long-term history.

✅ Title & Lien Verification — Instantly retrieve key trade-in details:
• Title Brand (Clean, Salvage, Rebuilt, etc.)
• Active Liens & Lienholder Information
• Vehicle Weight & Model Year

✅ Scan a License with Your Phone — Tap "Scan license with phone," scan the QR, then scan the barcode on the back of a driver's license or state ID. Buyer and co-buyer fields fill automatically. The fields are end-to-end encrypted and the license image is never uploaded.

✅ Professional "Deal Jacket" Reports — Generate a timestamped proof-of-compliance report in one click. Print or save as a PDF for the deal jacket. Bounded text history is stored locally for up to 30 days and 50 records so you can review or re-screen recent deals.

✅ Privacy-Conscious by Design
• OFAC screening is processed entirely on your device — nothing is transmitted.
• For Repeat Offender and Title checks, the customer's name, date of birth, DLN/PID (and VIN) are sent over encrypted HTTPS to our secure backend, used to obtain the official MDOS result, then immediately discarded — never stored or logged on our servers.
• The optional phone scan relays only an encrypted, single-use package the backend cannot read; the license image is never transmitted.
• Local text history can include customer name, date of birth, DLN/PID, VIN, and check results. It is limited to 30 days / 50 records and can be deleted with Clear All History.
• No tracking. No analytics. We never sell your data.
Full policy: https://techsavvyjoe.github.io/compliance-central/

How It Works:
1. Open the Compliance Central side panel — every check is ready, no account or setup.
2. Enter the Buyer/Co-Buyer information and Trade-In VIN.
3. Click "Run All Checks."
4. View clear Approved / Review / Denied results instantly.
5. Click "Print All" to document your compliance.

Perfect for: F&I Managers · Sales Managers · Title Clerks · Compliance Officers

Requirements:
• Google Chrome. That's it — every check is included free, with no account, API key, or setup.

Take the headache out of compliance. Install Compliance Central today and deal with confidence.


WHAT'S NEW IN 1.3.0

• Clear and stuck-timeout now cancel in-flight runs so old results cannot overwrite a cleared form.
• Run All Checks correctly reports when another run is already in progress.
• OFAC-only screens show stale-data warnings when the local SDN list could not be refreshed.
• Phone license scan uses your Settings API key override (same as MDOS checks).
• Hardened screenshot handling, message validation, and OFAC download host pinning.
• Compliance history no longer stores bulky portal screenshots long-term (session print still works).


WHAT'S NEW IN 1.2.0

• Every check is now included free — no account, API key, or setup required.
• OFAC data-freshness warning so you never screen against an outdated sanctions list.
• More reliable "Run All Checks" (protected against double-runs; one failing check no longer hides the others).
• Refreshed store media and privacy policy.


PERMISSION JUSTIFICATIONS (one per permission)

sidePanel — The entire user interface is a Chrome side panel; this permission opens and renders it.
storage — Saves bounded compliance text history (up to 30 days / 50 records), preferences, and an optional custom backend API key locally on the device. History can include customer name, date of birth, DLN/PID, VIN, and check results. Portal screenshots are session-only and are not retained in long-term history.
unlimitedStorage — Stores the downloaded OFAC SDN dataset for on-device screening and bounded local text history. Portal screenshots are session-only current-run evidence, not retained in long-term compliance history.
alarms — Schedules an automatic daily refresh of the local OFAC sanctions list so screenings use current data.
Host permission https://sanctionslistservice.ofac.treas.gov/ — Downloads the official U.S. Treasury OFAC SDN list used for on-device sanctions screening.
Host permission https://wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com/ — Allows Treasury's signed OFAC-list download redirect to its dedicated AWS GovCloud file host.
Host permission https://compliance-central-api.fly.dev/ — Performs Repeat Offender and Title/Lien checks and relays the optional end-to-end encrypted phone scan package, which the backend cannot read.

(No remote code is executed; all extension code is bundled. No broad host permissions are requested.)


DATA SAFETY / PRIVACY PRACTICES (dashboard form answers)

Does this item collect or use user data? Yes.

Data handled (entered by the dealer about a customer):
• Personally identifiable information — name, date of birth, government ID (Michigan DLN/PID): Collected, transmitted (HTTPS) to the extension's backend for MDOS checks only. Not sold. Not stored server-side.
• Authentication information — optional custom backend API key: stored locally and sent securely only to the selected compliance backend for requested checks.
• Vehicle identifier (VIN): transmitted for the optional title check only.
• Local history: customer name, date of birth, DLN/PID, VIN, and text check results may be retained on the device for up to 30 days / 50 records. Portal screenshots remain session-only and are excluded from long-term history.

Certifications to check in the form:
• Data is NOT sold to third parties.
• Data is NOT used for purposes unrelated to the item's single purpose.
• Data is NOT used to determine creditworthiness or for lending.
• Data is encrypted in transit (HTTPS).
• OFAC screening data is processed locally and never transmitted.
• Users can request deletion / clear local data (history clear + uninstall; backend retains nothing).

A privacy policy URL is provided (above).


SUBMISSION NOTES

• This is version 1.3.0. If a prior version was never published, this is a new public listing; if 1.2.0 was published, upload 1.3.0 as an update.
• Screenshots (1280x800) and promo tiles live in store-assets/chrome-web-store/images/.
• Developer contact email (shown publicly): joejgallant@gmail.com — already set in lib/config.js, the privacy policy, and the dashboard account settings.
• All checks are free with no account/API key: the extension ships a built-in backend key (lib/config.js CONFIG.backend.defaultApiKey). To cut off abuse later, rotate CC_API_KEY on the Fly backend and ship a new value.
