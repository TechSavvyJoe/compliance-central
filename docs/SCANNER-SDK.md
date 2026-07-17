# Optional commercial scanner (off by default)

Compliance Central's **default** license scanner is free forever: photo capture +
local ZXing-WASM with aggressive preprocessing. No trial key and no per-scan fee.

## Default (recommended)

Leave `scanner-config.json` as:

```json
{
  "provider": "zxing",
  "dynamsoft": { "licenseKey": "", "sdkUrl": "..." }
}
```

The phone page never loads Dynamsoft in this mode.

## Optional Dynamsoft (paid / trial)

Only if you deliberately want the commercial SDK:

1. Set `"provider": "auto"` (or `"dynamsoft"`).
2. Paste a JavaScript Web license into `dynamsoft.licenseKey`.
3. Restrict the key to `techsavvyjoe.github.io` in the Dynamsoft portal.
4. Open `scan.html?debug=1` — diagnostics may show `provider Dynamsoft`.

If the key is missing or the SDK fails to load, the free scanner runs instead.
Normal UI never asks the user to buy or start a Dynamsoft trial.

## Data handling

Barcode recognition runs in the phone browser (WebAssembly / JS). The license
image and raw AAMVA barcode are not uploaded to Compliance Central. After the
user confirms the locally parsed fields, pairing encrypts those fields in the
browser and sends only the encrypted payload through the relay.

**Best free results:** use **Capture photo** / **Use a photo** — still images
decode far more reliably than live video on iPhone Safari.
