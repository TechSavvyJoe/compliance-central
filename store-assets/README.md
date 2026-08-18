# Store Assets & Promotional Media

This directory contains all store assets and promotional videos generated for **Compliance Central - Michigan Dealer Compliance Hub**.

> ⚠️ **The images below are stale.** They were rendered on 2026-07-22 for version 1.3.1
> (the version currently published on the Web Store). They predate the side-panel redesign
> and the SOS registration/plate fee workspace, so they do not show the shipping 1.6.0 UI.
> Regenerate them with `npm run assets` before the next upload — and note that script needs
> `sharp`, which is not a declared dependency: run `npm i -D sharp` first.

## 🎥 Promo Videos (`store-assets/upload/`)

- `promo_video_main_with_logo.webm`: 41-second explainer video with audio overview, animations, and official branding.
- `promo_video_fast_paced_with_logo.webm`: 22-second high-energy marketing video highlighting core features with official logo integration.
- `raw_screen_recording.webm`: Raw 7-second toolbar/sidepanel usage clip.

> **Note for Chrome Web Store Dashboard:**
> Chrome Web Store accepts YouTube URLs for video teasers on your store listing. You can upload either `promo_video_main_with_logo.webm` or `promo_video_fast_paced_with_logo.webm` to YouTube (e.g. Unlisted or Public) and paste the YouTube link into the **"Promotional Video"** field in the Chrome Developer Dashboard Store Listing tab.

## 🖼️ Store Screenshots & Images (`store-assets/upload/`)

- `01-run-all-approved-1280x800.jpg`: Main screenshot showing unified compliance check.
- `02-ofac-only-local-1280x800.jpg`: Screenshot showing local OFAC SDN screening.
- `03-title-lien-1280x800.jpg`: Screenshot showing Title & Lien report result.
- `04-phone-license-scan-1280x800.jpg`: Screenshot showing phone license scanner QR pairing. Visibly labeled as an instructional composite; the ID artwork is fictional.
- `05-compliance-history-1280x800.jpg`: Screenshot showing saved Compliance History — device-local **customer** records that a dealership can reopen, re-screen, print, or download, kept up to 30 days / 50 records. This history is identified, not anonymous: records carry the submitted customer fields, and the audit CSV export includes Customer, Co-Buyer, and Trade VIN columns.
- `marquee-promo-1400x560.jpg`: Large Marquee Promo tile.
- `small-promo-440x280.jpg`: Small Promo tile.
- `cc-store-icon-128.png`: 128x128 Store icon.

## 📄 HTML Animations (`store-assets/`)

- `animated_promo.html`: Standard animated promo generator.
- `animated_promo_exciting.html`: High-energy animated promo generator.

## 📝 Listing copy (`store-assets/chrome-web-store/`)

- `listing.md`: the full reference doc — every field, with notes on where each one goes.
- `description.txt`: the Description box, verbatim. `tests/release-copy.test.js` asserts this
  file matches the copies embedded in `listing.md` and `SUBMISSION-PROMPT.txt`, so edit all
  three together.
- `privacy-tab.txt`: the Privacy tab fields.
- `SUBMISSION-PROMPT.txt`: a self-contained prompt for driving the dashboard update.
