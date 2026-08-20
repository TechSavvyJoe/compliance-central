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

## 🖼️ Store Screenshots & Images (`store-assets/chrome-web-store/`)

The live listing set, captured 2026-08-19 from the real 1.6.0 side panel by
`node tools/capture-store-shots.mjs` (headless Chrome rendering `sidepanel.html`
itself — not mockups). `screenshots/screenshot-1.png` … `screenshot-5.png`
(1280x800) plus `promo-small-440x280.png` and `promo-marquee-1400x560.png`.
Captions and upload order live in `chrome-web-store/SUBMISSION-CHECKLIST.md`.
Every name, date, VIN, and dealership shown is fictional; History records are
identified by customer, not anonymized. The pre-1.6.0 JPEG set that used to sit
in `upload/` and `chrome-web-store/images/` showed the retired dark UI and has
been deleted.

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
