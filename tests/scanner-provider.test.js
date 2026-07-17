import test from "node:test";
import assert from "node:assert/strict";
import {
  extractDynamsoftPayloads,
  loadScannerConfig,
} from "../docs/lib/scanner-provider.js";

test("extracts only PDF417 text and preserves AAMVA control bytes", () => {
  const aamva = "@\n\u001e\rANSI 636032\nDLDAQS123";
  const result = {
    barcodeResultItems: [
      { formatString: "QR_CODE", text: "https://example.com" },
      {
        formatString: "PDF417",
        text: aamva,
        bytes: new TextEncoder().encode(aamva),
      },
    ],
  };

  assert.deepEqual(extractDynamsoftPayloads(result), [aamva]);
});

test("extracts PDF417 payloads from single-image capture results", () => {
  const result = {
    items: [
      { formatString: "PDF417", text: "ANSI 636032\nDLDAQS123" },
      { formatString: "CODE_128", text: "thin barcode" },
    ],
  };

  assert.deepEqual(extractDynamsoftPayloads(result), [
    "ANSI 636032\nDLDAQS123",
  ]);
});

test("runtime scanner config fails closed to an empty config", async () => {
  assert.deepEqual(
    await loadScannerConfig("/scanner-config.json", async () => ({
      ok: true,
      json: async () => ({ provider: "auto", dynamsoft: { licenseKey: "" } }),
    })),
    { provider: "auto", dynamsoft: { licenseKey: "" } }
  );

  assert.deepEqual(
    await loadScannerConfig("/scanner-config.json", async () => {
      throw new Error("offline");
    }),
    {}
  );
});
