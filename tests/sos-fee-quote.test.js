import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

import {
  SOS_QUOTE_MODE,
  SOS_QUOTE_SOURCE,
  createCapturedQuote,
  createManualQuote,
  createSosFeeQuotePrintHTML,
  dollarsToCents,
  normalizeSosFeeQuote,
  sanitizeVehicleDescription,
} from "../src/sidepanel/sos-fee-quote.js";

const contentScript = readFileSync(
  new URL("../sos-fee-quote-content.js", import.meta.url),
  "utf8"
);
const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8")
);
const sidepanelHtml = readFileSync(
  new URL("../sidepanel.html", import.meta.url),
  "utf8"
);
const packageScript = readFileSync(
  new URL("../tools/package-extension.sh", import.meta.url),
  "utf8"
);

function captureFromSosText(text, url = "https://dsvsesvc.sos.state.mi.us/fees") {
  let listener;
  const sandbox = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) {
            listener = fn;
          },
        },
      },
    },
    document: { body: { innerText: text } },
    location: { href: url },
    window: { print() {} },
    Date,
    String,
    Set,
  };
  vm.runInNewContext(contentScript, sandbox);
  let response;
  listener({ type: "SOS_CAPTURE_FEE_QUOTE" }, {}, (value) => {
    response = value;
  });
  return response;
}

test("SOS page adapter captures one clearly labelled fee and strips a VIN", () => {
  const response = captureFromSosText(
    "Registration fee: $126.00\nVehicle: 2026 Ford Explorer VIN 1FMDE8AP9RLA12345"
  );
  assert.equal(response.success, true);
  assert.equal(response.quote.feeCents, 12600);
  assert.equal(response.quote.vehicleDescription, "2026 Ford Explorer");
  assert.match(response.quote.calculatorUrl, /^https:\/\/dsvsesvc\.sos\.state\.mi\.us\//);
});

test("SOS page adapter fails closed when labels are absent or competing", () => {
  const unlabelled = captureFromSosText("Total due $126.00");
  assert.equal(unlabelled.success, false);
  assert.equal(unlabelled.code, "UNVERIFIED_RESULT");

  const competing = captureFromSosText(
    "Registration fee: $126.00\nPlate fee: $52.00"
  );
  assert.equal(competing.success, false);
});

test("quote model accepts only bounded session-safe data", () => {
  assert.equal(dollarsToCents("1,234.50"), 123450);
  assert.equal(dollarsToCents("-20"), null);
  assert.equal(sanitizeVehicleDescription("VIN: 1FMDE8AP9RLA12345 2026 Explorer"), "2026 Explorer");
  assert.equal(
    normalizeSosFeeQuote({
      mode: SOS_QUOTE_MODE.newPlate,
      source: SOS_QUOTE_SOURCE.captured,
      feeCents: 2500,
      vehicleDescription: "2026 Explorer",
      capturedAt: "not a timestamp",
    }),
    null
  );
  assert.equal(
    normalizeSosFeeQuote({
      mode: SOS_QUOTE_MODE.newPlate,
      source: SOS_QUOTE_SOURCE.captured,
      feeCents: 2500,
      vehicleDescription: "2026 Explorer",
      capturedAt: "2026-08-14T12:00:00.000Z",
      calculatorUrl: "https://example.com/private?token=secret",
    }).calculatorUrl,
    null
  );
});

test("customer print marks fallback quotes as salesperson-entered and never prints a VIN", () => {
  const captured = createCapturedQuote(
    {
      feeCents: 12600,
      vehicleDescription: "2026 Explorer VIN: 1FMDE8AP9RLA12345",
      calculatorUrl: "https://dsvsesvc.sos.state.mi.us/fees?session=private",
    },
    SOS_QUOTE_MODE.newPlate,
    new Date("2026-08-14T12:00:00.000Z")
  );
  const html = createSosFeeQuotePrintHTML(captured);
  assert.match(html, /Captured from SOS/);
  assert.match(html, /\$126\.00/);
  assert.match(html, /Title transfer fee/);
  assert.match(html, /6% of purchase price/);
  assert.match(html, /Optional Recreation Passport/);
  assert.doesNotMatch(html, /1FMDE8AP9RLA12345|session=private/);

  const manual = createManualQuote(
    { mode: SOS_QUOTE_MODE.plateTransfer, amount: "15.00", vehicleDescription: "2024 Escape" },
    new Date("2026-08-14T12:00:00.000Z")
  );
  assert.match(createSosFeeQuotePrintHTML(manual), /Salesperson-entered/);
});

test("extension access is restricted to official SOS pages and quote controls are explicit", () => {
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.host_permissions.includes("https://*.sos.state.mi.us/*"));
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["https://*.sos.state.mi.us/*"],
      js: ["sos-fee-quote-content.js"],
      run_at: "document_idle",
    },
  ]);
  assert.match(packageScript, /sos-fee-quote-content\.js/);
  for (const id of [
    "openSosCalculatorBtn",
    "captureSosQuoteBtn",
    "printSosQuoteBtn",
    "printSosPageBtn",
    "saveManualSosQuoteBtn",
  ]) {
    assert.match(sidepanelHtml, new RegExp(`id="${id}"`));
  }
  assert.match(sidepanelHtml, /Session only: no SOS sign-in, cookie, VIN, customer name, or page content is retained\./);
});
