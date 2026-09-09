# Flow review — September 9, 2026

This review preserves extension version **1.6.1** and the existing product model:
a Chrome side panel, a phone scanning page, and the Michigan-check API. It does
not introduce customer accounts, billing, cloud customer-history storage, or a
new legal/compliance policy.

## Corrections

- **Quote integrity:** owner birthdate and transfer-option edits invalidate old
  quotes. Each calculation uses an immutable copy of the vehicle details and
  its own cancellation identity. Late responses and storage writes cannot put
  an old price back on the edited form. Clear restores the complete default
  vehicle state, including fuel and registration mode.
- **Calculator flow:** the current result and print actions come into view after
  Calculate completes. Print controls stay hidden until a quote exists; the
  state's fee breakdown is available beside the result. Failed artwork loads
  show a readable fallback. VIN suggestions cannot overwrite later choices.
- **Multi-window safety:** worker-owned writes serialize result publication,
  cancellation, draft caching and cleanup. Clear targets only the record that
  panel owns/displays. Old completions cannot overwrite a newer deal or revive
  a cancelled one. History opens a new working identity, leaving its original
  audit record intact.
- **Partial runs:** Run all checks supports VIN-only and co-buyer-only input
  through the real worker, not just form validation. The worker derives its
  plan from submitted fields. Partial/invalid identities cannot be silently
  skipped by a supplied plan flag.
- **Decision consistency:** skipped checks remain Not run; missing co-buyer
  checks cannot become an approval. History, the screen and reports retain
  title brands, liens, unknown results and contradictory answers consistently.
- **Reports:** long dealership names wrap beside logos. State-capture headings
  and provenance no longer overlap. Branding remains a per-install Settings
  choice for documents; no dealership is hardcoded into the public app.
- **Phone recovery:** a stalled permission-status probe does not hide Start
  camera. An interrupted/failed send offers an honest retry without requiring
  another scan. Review and recovery controls remain keyboard reachable.
- **API boundaries:** identity-field read-back uses exact normalized comparison,
  preserving leading zeroes and date components. Supplied middle names/suffixes
  must land. Explicit add-ons and purchase dates cannot disappear as optional
  choices, nor can a stale total bypass state validation. Diagnostics retain
  structural counts, not arbitrary customer-bearing page text.
- **Deployment and dependencies:** shutdown stops accepting new requests and
  drains accepted work before closing Chromium, with a bounded deadline. Fly's
  grace period accommodates the active check and bounded queue. Targeted
  js-yaml/qs updates remove the reported advisories without an Express major
  migration or application-version change.
- **Maintainer flow:** browser tests and their pinned driver are reproducible;
  the asset command now invokes the real-interface screenshot generator rather
  than the retired mockup pipeline. Listing sample dates agree with their term.

## Verification and evidence

- `npm test`: regression suite covers worker ownership/cancellation, draft
  privacy, partial plans, report decisions, real PDF font measurements, and
  existing sanctions/fee/parser behavior.
- `npm run test:browser`: runs isolated Chrome using synthetic data. The panel
  checks cover fee edits, delayed replies, reset, inline errors, keyboard tabs,
  modal recovery, plate zoom, and 320/400/600px layouts. The viewer also fits
  400px-tall and 1280px-wide windows. Scanner checks simulate permission and
  relay failures; no real license data is used.
- `tools/verify-extension-flows.mjs`: loads the unpacked extension and its real
  service worker/storage in separate Chrome windows. Native network is blocked;
  only the backend replies are synthetic. It checks unrelated Clear, owning
  cancellation, late results, History reopen and worker restart recovery.
- PDF render inspection used synthetic subjects and unbranded, long-name,
  logo-plus-name and state-capture variants. Listing images are staged examples,
  not evidence of a current live Michigan fee.

The browser testing approach follows [Chrome's extension testing guidance](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
and [Puppeteer's extension support](https://pptr.dev/guides/chrome-extensions).
Keyboard/modal behavior was checked against the [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## Release and remaining acceptance boundaries

- Keep the existing release tag immutable. A same-version ZIP built from this
  review is a revised test artifact; identify it by source commit and checksum.
  Each successful CI run now retains an unpacked test-build artifact for 14 days
  so an authenticated GitHub user can test that exact commit on another computer.
- A passing simulated flow is not proof of a physical iPhone, Android or Samsung
  camera experience. Browser/site permission choices cannot be bypassed.
- Live Michigan portal compatibility, network outages and production deployment
  are separate checks from unit/browser tests. No state fee schedule or OFAC
  matching threshold was changed in this review.
- The pairing relay remains process-local: production must retain exactly one
  Fly Machine until a shared relay store is deliberately designed and deployed.
- This is not yet a multi-tenant account SaaS. Authentication, tenant isolation,
  billing, account-based synchronization and related retention/consent policies
  require a separate architecture and product decision before introducing cloud
  storage for dealership/customer information.

Final command results, artifact identity and actual deployment status are
recorded in the review handoff; none should be inferred from this checklist alone.
