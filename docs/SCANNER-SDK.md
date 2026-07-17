# License scanner (free live PDF417)

Compliance Central’s phone scanner is **live-camera first** and free forever.
It opens the rear camera right after you scan the pairing QR, shows a yellow
guide frame, and continuously decodes the wide **PDF417** barcode on the back
of a Michigan (AAMVA) driver’s license.

## Default path (recommended)

Leave `scanner-config.json` as:

```json
{
  "provider": "zxing",
  "dynamsoft": { "licenseKey": "", "sdkUrl": "..." }
}
```

What you get:

1. **Live scan** — `getUserMedia` starts immediately (WASM warms in parallel).
2. **PDF417-only** — yellow-frame ROI with a bottom-band crop so the thin 1D
   strip above the PDF417 does not confuse the decoder.
3. **Free local readers** — zxing-wasm (ZXing-C++) plus the vendored JS ZXing
   fallback; optional browser `BarcodeDetector` when the phone supports PDF417.
4. **Use a photo** — secondary optional button if the camera cannot run.

No paid SDK is required. Dynamsoft stays dormant unless you deliberately add a
key (see below).

## Optional Dynamsoft (paid / trial)

Only if you want the commercial SDK:

1. Set `"provider": "auto"` (or `"dynamsoft"`).
2. Paste a JavaScript Web license into `dynamsoft.licenseKey`.
3. Restrict the key to `techsavvyjoe.github.io` in the Dynamsoft portal.
4. Open `scan.html?debug=1` — diagnostics may show `provider Dynamsoft`.

If the key is missing or the SDK fails, the free live scanner runs instead.

## Data handling

Barcode recognition runs in the phone browser (WebAssembly / JS). The license
image and raw AAMVA barcode are not uploaded to Compliance Central. After the
user confirms the locally parsed fields, pairing encrypts those fields in the
browser and sends only the encrypted payload through the relay.

**Acceptance:** a complete AAMVA payload with DAQ (DLN) plus name fields;
Michigan cards set `isMichigan` from the IIN.
