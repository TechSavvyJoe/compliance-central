COMPLIANCE CENTRAL — CHROME WEB STORE LISTING COPY (v1.6.0)

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


SHORT DESCRIPTION (≤132 chars — must match manifest.json "description")

Unified compliance screening for Michigan auto dealers. OFAC sanctions, Repeat Offender, and Title/Lien checks in one sidebar tool.


CATEGORY

Productivity (alternate: Workflow & Planning / Business tools)


LANGUAGE

English (United States)


SINGLE PURPOSE STATEMENT

Compliance Central lets Michigan automotive dealers screen buyers and co-buyers for OFAC sanctions, MDOS repeat-offender status, and vehicle title/lien status, calculate an official SOS registration fee, and produce printable records from one browser side panel.


DETAILED DESCRIPTION (≤4000 chars)

Compliance Central — Michigan Dealer Compliance in One Side Panel

Compliance Central puts five Michigan dealership tasks in Chrome's side panel: OFAC sanctions screening, MDOS Repeat Offender and Title/Lien checks, an SOS registration and plate fee workspace, and an optional phone license scan.

Enter customer and trade-in information once, choose the checks you need, and review the outcomes without leaving your current tab.

Key Features:

✅ Unified Compliance Dashboard — Run one check or all available checks from one interface.

✅ On-Device OFAC SDN Name Screening — Screens names against the local U.S. Treasury SDN list, attempts a daily refresh, and warns when freshness cannot be confirmed. Customer information stays on your computer for this check; fuzzy and alias matching helps human review.

✅ Repeat Offender Check — Sends the required name, date of birth, and Michigan DLN/PID over HTTPS to the Compliance Central service, which requests the MDOS portal result and returns the actual captured Michigan state page as evidence. Potential, unavailable, or unexpected results require human review.

✅ Title & Lien Check — Sends the trade-in VIN over HTTPS and displays what the MDOS portal returns, including available title brand, lien, lienholder, vehicle, and weight information. The report includes the captured Michigan state page; uncertain results are labeled for review.

✅ SOS Registration & Plate Fee Workspace — Complete vehicle, fuel, use, and plate choices locally and inspect official Michigan plate artwork in a zoomable viewer. One explicit Calculate action sends your completed choices — including the owner's birthdate, which sets the Michigan expiration date — to the Compliance Central service, which runs the public Michigan SOS calculator and returns the verified fee plus a capture of the official result page. Nothing opens on your computer. Print or download the verified total, or hand the customer a plain-language fee worksheet.

✅ VIN Assist — An explicit NHTSA vPIC lookup fills supported vehicle type, body, fuel, and model-year fields locally for review. The raw VIN is not stored in quote history or passed to SOS.

✅ Scan a License with Your Phone — Use a one-time pairing code to scan the barcode on a driver's license or state ID. Approved text fields are encrypted and sent to your computer; the license image stays on the phone.

✅ Printable Deal Jacket Screening Records — Print or download a timestamped summary of the results. Reports record what the extension returned; they are not a legal certification. Downloaded files remain wherever you choose to save them.

✅ Privacy-Conscious by Design
• Compliance History stores customer fields, results, trade VINs, and report evidence on your device so staff can reopen, re-screen, print, or download a record later.
• Local History is limited to 30 days / 50 records and can be cleared anytime. SOS fee choices stay session-only; credentials and tokens are never stored.
• The MDOS service processes requested fields in memory and keeps no database of searches.
• The optional phone scan uses an encrypted, single-use package the relay cannot read; the license image is not transmitted.
• No advertising or analytics tracking. Customer data is not sold.
• Compliance Central's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

Full privacy policy: https://techsavvyjoe.github.io/compliance-central/

How It Works:
1. Open the Compliance Central side panel.
2. Enter the Buyer/Co-Buyer information and optional Trade-In VIN, or use the phone scanner.
3. Choose one check or "Run all checks."
4. Review each labeled outcome. Possible matches and unavailable or uncertain results require human review.
5. Print or download a screening record when needed.

Built for: F&I Managers · Sales Managers · Title Clerks · Compliance Officers

Requirements:
• Google Chrome. No account, API key, or setup is required.


WHAT'S NEW IN 1.6.0

(1.3.1 is the version currently published on the Web Store, so this entry covers
everything in 1.3.2 through 1.6.0 — those builds were never uploaded.)

• Permissions note for existing users: this update adds two host permissions — official Michigan SOS plate artwork (dsvsesvc.sos.state.mi.us) and NHTSA VIN decoding (vpic.nhtsa.dot.gov). Chrome disables the extension until you review and accept them: open the Extensions menu (or chrome://extensions), find Compliance Central, and choose to accept the new permissions and re-enable it. Nothing else changes about where customer data goes.
• Michigan SOS registration and plate fees are now a full workspace. Choose the passenger or commercial vehicle, fuel, use, and plate options locally, then one Calculate action asks the Compliance Central service to run the public Michigan SOS calculator and return the verified fee with a capture of the official result page. Nothing opens on your computer, and the extension no longer navigates anywhere itself.
• A printable customer fee worksheet shows the selected plate and the dealership name and logo you configure in Settings — nothing ships pre-branded, the logo stays on your device, and the worksheet prints correctly with neither set. The 2026 fee table is checked against the Michigan SOS plates-and-tabs page and the MDOS Dealer Manual (Rev. 07/26). It now applies Michigan's partial trade-in sales-tax credit instead of a flat 6% of purchase price, includes the $5 instant-title fee, and no longer describes the digital-plate deadline as upcoming.
• A plate transfer submits the vehicle actually being purchased, and the quote leads with the total and the coverage window it buys.
• OFAC screening requires a stand-alone surname match before a hit can qualify. A surname that only shares a prefix (GALLO against Gallant) no longer flags, while transliteration variants such as Qaddafi/Gaddafi still do. The threshold is measured against a 22-case labelled corpus rather than argued.
• The saved audit trail now derives its states from the same code that produced the on-screen decision. A contradictory Repeat Offender response can no longer be filed as "Eligible", a confirmed OFAC match outranks a stale-list note, and the CSV distinguishes potential, confirmed, and false-positive matches.
• The re-screen reminder is a banner that stays until the work is done and opens the saved records with the re-screen filter applied. It now also flags a plate fee quoted on an earlier day, because Michigan prices a registration from the purchase date.
• A saved record can be re-screened or deleted from its own card, and deletion targets the record's audit id rather than its position in the list.
• The data-use disclosure now sits open in the panel until it has been read, and existing users see a one-time notice that saved records now keep the submitted buyer/co-buyer fields and the captured state pages for up to 30 days.
• The side panel and the printed report now derive one shared verdict, fail-closed: a saved record with a missing required check reads REVIEW REQUIRED on both surfaces instead of the screen and the document disagreeing.
• The local OFAC database upgrade (schema v2) drops an unused per-check feed and was verified against a populated v1 database, so the downloaded sanctions list survives the update.
• Compliance report exports are selectable, and Michigan SOS evidence prints as a one-page portrait record.
• Redesigned side panel with a single spacing rhythm across every panel.
• Accessibility: the Plate Calculator and History tabs are reachable by keyboard through the standard ARIA tablist pattern, the compliance verdict is announced to screen readers, the History search box has a real label, and the remaining light-canvas contrast failures are cleared.
• The extension and the phone scan page each carry a real Content Security Policy; the scan page also sends no referrer. The unused WebAssembly exemption is gone.
• Phone scanning skips the "Start camera" tap once the phone has already granted camera access, on every mobile browser rather than only Chromium.


WHAT'S NEW IN 1.3.1

• State-sourced Repeat Offender and Title reports include the actual captured Michigan state page, including state branding and the returned result.
• Phone scanning gives one short confirmation beep and vibration after a valid PDF417 barcode is accepted.
• Settings is streamlined around service status, reminders, privacy controls, support, and version—no backend key setup.
• Saved customer/report history can be reopened for re-screening, printing, and PDF download and remains device-local with 30-day / 50-record limits.
• Title, lien, OFAC freshness, cancellation, backend isolation, and interrupted-run handling now fail closed instead of showing optimistic results.
• Scanner instructions, mobile layout, accessibility, and store imagery have been refined for straightforward dealership use.


WHAT'S NEW IN 1.2.0

• Every check is now included free — no account, API key, or setup required.
• OFAC data-freshness warning when the extension cannot confirm a current sanctions list.
• More reliable "Run all checks" (protected against double-runs; one failing check no longer hides the others).
• Refreshed store media and privacy policy.


PERMISSION JUSTIFICATIONS (one per permission)

sidePanel — The entire user interface is a Chrome side panel; this permission opens and renders it.
storage — Saves preferences and bounded device-local customer/report history (up to 30 days / 50 records) so an authorized dealership user can reopen, re-screen, print, or download a prior record.
unlimitedStorage — Stores the downloaded OFAC SDN dataset and bounded device-local report history, including captured state-site evidence images. SOS credentials and authentication tokens are not stored in History.
alarms — Schedules a daily attempt to refresh the local OFAC sanctions list and maintain the 30-day history limit.
Host permission https://sanctionslistservice.ofac.treas.gov/ — Downloads the official U.S. Treasury OFAC SDN list used for on-device sanctions screening.
Host permission https://wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com/ — Allows Treasury's signed OFAC-list download redirect to its dedicated AWS GovCloud file host.
Host permission https://compliance-central-api.fly.dev/ — Performs Repeat Offender, Title/Lien, and Michigan SOS fee-calculator runs, and relays the optional end-to-end encrypted phone scan package, which the backend cannot read.
Host permission https://dsvsesvc.sos.state.mi.us/ — Loads official Michigan plate artwork shown in the side panel. This is the only thing the extension itself requests from the SOS host; the public SOS fee calculator is driven by the backend after an explicit action, which returns a session-only verified result plus the actual official result-page capture.
Host permission https://vpic.nhtsa.dot.gov/ — Runs an optional user-requested VIN or partial-VIN decode to fill supported local vehicle fields.

(No remote code is executed; all extension code is bundled. No broad host permissions are requested. The extension does not request the "tabs" permission and never opens or reads a browser tab.)


DATA SAFETY / PRIVACY PRACTICES (dashboard form answers)

Does this item collect or use user data? Yes.

Data handled (entered by the dealer about a customer):
• Personally identifiable information — name, date of birth, government ID (Michigan DLN/PID): Collected, transmitted (HTTPS) to the extension's backend for MDOS checks only. Not sold. Not stored server-side.
• Website content — Michigan portal responses and screenshots returned for user-requested checks; retained only for the current browser session.
• Location — the hosting service receives the request IP address. Compliance Central uses it transiently in memory for rate limiting and abuse prevention and does not write it to a database or application log.
• Vehicle identifier (VIN): transmitted for the optional title check only.
• Browser session: current customer fields, VINs, full results, and portal screenshots remain available while the active record is being worked.
• Persistent local history: submitted customer fields, trade VINs, results, and report evidence are retained for up to 30 days / 50 records so dealership staff can reopen and reproduce a record.
• User-requested downloads: PDF or CSV files are saved only when the user asks and remain in the user's chosen download location until deleted.

Certifications to check in the form:
• Data is NOT sold to third parties.
• Data is NOT used for purposes unrelated to the item's single purpose.
• Data is NOT used to determine creditworthiness or for lending.
• Data is encrypted in transit (HTTPS).
• OFAC screening data is processed locally and never transmitted.
• Users can request deletion / clear local data (history clear + uninstall; backend retains nothing).

A privacy policy URL is provided (above).

Limited Use disclosure:
Compliance Central's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.


SUBMISSION NOTES

• The dashboard walk-through for this update lives in SUBMISSION-CHECKLIST.md (same directory). It is the master document; where it and older notes disagree, the checklist wins.
• The published listing is at 1.3.1. This repo is at 1.6.0, so the next upload is an UPDATE to the existing listing, not a first submission. Upload compliance-central-1.6.0.zip (`npm run package`).
• PERMISSION RE-CONSENT: 1.3.1 declared three host permissions; 1.6.0 declares five (adds dsvsesvc.sos.state.mi.us and vpic.nhtsa.dot.gov). When the update lands, Chrome DISABLES the extension for every existing user until they accept the new permissions. Expect support questions; the first WHAT'S NEW bullet above tells users what to do.
• 1.3.2, 1.3.3, 1.4.0, 1.5.0, and 1.5.1 were built but never uploaded; the WHAT'S NEW IN 1.6.0 entry above covers all of them.
• Screenshots and promo tiles for this update are being regenerated as store-assets/chrome-web-store/screenshots/screenshot-1.png through screenshot-5.png plus store-assets/chrome-web-store/promo-small-440x280.png and promo-marquee-1400x560.png. Review each against the captions in SUBMISSION-CHECKLIST.md before uploading. The older JPEGs in store-assets/chrome-web-store/images/ and store-assets/upload/ were rendered 2026-07-22 for 1.3.1 and predate both the side-panel redesign and the SOS plate fee workspace — do not upload those.
• Screenshot 04 is visibly labeled as an instructional composite and uses fictional ID artwork; it is not a live scanner capture or a real identity document.
• Developer contact email (shown publicly): joejgallant@gmail.com — already set in lib/config.js, the privacy policy, and the dashboard account settings.
• All checks use built-in service access. Users do not enter or manage a backend API key.
