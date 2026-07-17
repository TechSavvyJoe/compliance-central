# Production scanner setup

Compliance Central prefers Dynamsoft Barcode Reader in the browser when a
license is configured. If it is unavailable, the scanner automatically falls
back to the local ZXing-WASM/JavaScript readers.

## Enable the 30-day Dynamsoft trial

1. Request a **JavaScript Web** trial key at
   <https://www.dynamsoft.com/customer/license/trialLicense/?package=js&product=dbr>.
2. In `scanner-config.json`, paste the key into `dynamsoft.licenseKey`.
3. In the Dynamsoft portal, restrict the key to the deployment domain
   `techsavvyjoe.github.io` and add the local development origin if needed.
4. Open `scan.html?debug=1`. The diagnostic line should report
   `provider Dynamsoft`.

The browser must receive this client-side SDK key, so it is not a server secret.
Domain restriction is the protection against reuse elsewhere. Do not put API
secrets or server credentials in this file.

The trial lasts 30 days and does not require a credit card. Dynamsoft does not
publish a fixed production price for this deployment; production requires a
JavaScript runtime/deployment license quoted by Dynamsoft. Their current
licensing documentation describes deployment licenses as non-usage-based (no
per-scan fee), with per-domain licensing available through sales/support.

## Data handling

Barcode recognition runs in WebAssembly in the phone browser. The license image
and raw AAMVA barcode are not uploaded to Compliance Central. After the user
confirms the locally parsed fields, the existing pairing code encrypts those
fields in the browser and sends only the encrypted payload through the relay.

The **Use a photo** path gives the original high-resolution file directly to
Dynamsoft's local `CaptureVisionRouter.capture()` API. If Dynamsoft cannot read
it, the existing local ZXing photo pipeline is tried next.
