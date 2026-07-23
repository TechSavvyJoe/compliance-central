COMPLIANCE CENTRAL — CHROME WEB STORE LISTING COPY (v1.3.1)

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

Compliance Central — Michigan Dealer Compliance in One Side Panel

Compliance Central brings three common Michigan dealership screening tasks into Chrome's side panel: OFAC SDN name screening, MDOS Repeat Offender checks, and vehicle Title/Lien checks.

Enter customer and trade-in information once, choose the checks you need, and review the returned outcomes without leaving your current browser tab.

Key Features:

✅ Unified Compliance Dashboard — Run one check or all available checks from one interface. Buyer and optional co-buyer results are kept together for the current working session.

✅ On-Device OFAC SDN Name Screening — Compares names against the locally downloaded U.S. Treasury Specially Designated Nationals (SDN) list. The extension attempts a daily list refresh and shows a freshness warning if current data cannot be confirmed. Customer information does not leave your computer for this check. Fuzzy and alias matching helps surface possible spelling and name variations for human review.

✅ Repeat Offender Check — Sends the required name, date of birth, and Michigan DLN/PID over HTTPS to the Compliance Central service, which requests the MDOS portal result and returns the actual captured Michigan state page as current-run evidence. Potential, unavailable, or unexpected results require human review.

✅ Title & Lien Check — Sends the required customer fields and trade-in VIN over HTTPS and displays the details returned by the MDOS portal, including available title brand, lien, lienholder, vehicle, and weight information. The report includes the actual captured Michigan state page; missing or uncertain results are labeled for review.

✅ Scan a License with Your Phone — Open the one-time pairing code, then scan the large, wide barcode on the back of a driver's license or state ID. Scanning is automatic, with a brief confirmation beep and vibration when supported. After you review and finish, the approved text fields are encrypted and sent to your computer. The license image stays on the phone and is not uploaded.

✅ Printable Deal Jacket Screening Records — Print or download a timestamped summary of the current results. Reports record what the extension returned; they are not a legal certification. Downloaded files remain wherever you choose to save them.

✅ Privacy-Conscious by Design
• Customer fields, full results, VINs, and portal screenshots are kept in the current browser session, not persistent extension history.
• Persistent history contains only anonymous references, timestamps, overall decisions, check outcomes, and co-buyer/trade-in workflow flags. It is limited to 30 days / 50 records and can be cleared at any time.
• The MDOS service processes requested fields in memory and does not maintain a database of searches.
• The optional phone scan uses an encrypted, single-use package the relay service cannot read; the license image is not transmitted.
• No advertising or analytics tracking. Customer data is not sold.
• Compliance Central's use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

Full privacy policy: https://techsavvyjoe.github.io/compliance-central/

How It Works:
1. Open the Compliance Central side panel.
2. Enter the Buyer/Co-Buyer information and optional Trade-In VIN, or use the phone scanner.
3. Choose one check or "Run All Checks."
4. Review each labeled outcome. Possible matches and unavailable or uncertain results require human review.
5. Print or download a screening record when needed.

Built for: F&I Managers · Sales Managers · Title Clerks · Compliance Officers

Requirements:
• Google Chrome. No account, API key, or setup is required.


WHAT'S NEW IN 1.3.1

• State-sourced Repeat Offender and Title reports include the actual captured Michigan state page, including state branding and the returned result.
• Phone scanning gives one short confirmation beep and vibration after a valid PDF417 barcode is accepted.
• Settings is streamlined around service status, reminders, privacy controls, support, and version—no backend key setup.
• Persistent audit history is anonymous and outcome-only; customer identity, VINs, full results, and screenshots remain session-only.
• Title, lien, OFAC freshness, cancellation, backend isolation, and interrupted-run handling now fail closed instead of showing optimistic results.
• Scanner instructions, mobile layout, accessibility, and store imagery have been refined for straightforward dealership use.


WHAT'S NEW IN 1.2.0

• Every check is now included free — no account, API key, or setup required.
• OFAC data-freshness warning when the extension cannot confirm a current sanctions list.
• More reliable "Run All Checks" (protected against double-runs; one failing check no longer hides the others).
• Refreshed store media and privacy policy.


PERMISSION JUSTIFICATIONS (one per permission)

sidePanel — The entire user interface is a Chrome side panel; this permission opens and renders it.
storage — Saves preferences and bounded anonymous audit history (up to 30 days / 50 records). Persistent records contain an anonymous reference, timestamp, overall decision, check outcomes, and co-buyer/trade-in workflow flags; they exclude customer identity, VINs, screenshots, and full report payloads.
unlimitedStorage — Stores the downloaded OFAC SDN dataset for on-device screening and bounded anonymous audit history. Customer identity, VINs, full results, and portal screenshots remain session-only.
alarms — Schedules a daily attempt to refresh the local OFAC sanctions list and maintain the 30-day history limit.
Host permission https://sanctionslistservice.ofac.treas.gov/ — Downloads the official U.S. Treasury OFAC SDN list used for on-device sanctions screening.
Host permission https://wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com/ — Allows Treasury's signed OFAC-list download redirect to its dedicated AWS GovCloud file host.
Host permission https://compliance-central-api.fly.dev/ — Performs Repeat Offender and Title/Lien checks and relays the optional end-to-end encrypted phone scan package, which the backend cannot read.

(No remote code is executed; all extension code is bundled. No broad host permissions are requested.)


DATA SAFETY / PRIVACY PRACTICES (dashboard form answers)

Does this item collect or use user data? Yes.

Data handled (entered by the dealer about a customer):
• Personally identifiable information — name, date of birth, government ID (Michigan DLN/PID): Collected, transmitted (HTTPS) to the extension's backend for MDOS checks only. Not sold. Not stored server-side.
• Website content — Michigan portal responses and screenshots returned for user-requested checks; retained only for the current browser session.
• Location — the hosting service receives the request IP address. Compliance Central uses it transiently in memory for rate limiting and abuse prevention and does not write it to a database or application log.
• Vehicle identifier (VIN): transmitted for the optional title check only.
• Browser session: customer fields, VINs, full results, and portal screenshots stay in session storage so the current run can be reviewed, printed, or downloaded.
• Persistent history: only anonymous references, timestamps, overall decisions, check outcomes, and co-buyer/trade-in workflow flags are retained for up to 30 days / 50 records.
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

• This is version 1.3.1. Upload it as the update package for the currently published listing.
• Screenshots (1280x800) and promo tiles live in store-assets/chrome-web-store/images/.
• Screenshot 04 is visibly labeled as an instructional composite and uses fictional ID artwork; it is not a live scanner capture or a real identity document.
• Developer contact email (shown publicly): joejgallant@gmail.com — already set in lib/config.js, the privacy policy, and the dashboard account settings.
• All checks use built-in service access. Users do not enter or manage a backend API key.
