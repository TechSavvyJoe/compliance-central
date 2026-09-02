import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { printBaseCSS } from "../lib/print-html.js";

import { STORAGE_KEYS } from "../lib/storage-keys.js";
import {
  SOS_QUOTE_MODE,
  SOS_QUOTE_SOURCE,
  createCalculatedQuote,
  createSosFeeQuotePrintHTML,
  createSosOfficialEvidencePrintHTML,
  normalizeSosFeeQuote,
  sanitizePlatePreviewUrl,
  sanitizeVehicleDescription,
  registrationTermText,
  sanitizeDealerLogo,
} from "../src/sidepanel/sos-fee-quote.js";
import {
  SOS_FUEL_OPTIONS,
  SOS_PLATE_DESIGNS,
  SOS_VEHICLE_OPTIONS,
  buildSosSubmission,
  localSosVinFields,
  plateDesignOptionsForType,
  plateOptionsForUse,
  validateSosLocalValues,
} from "../src/sidepanel/sos-local-form.js";
import { isPlateQuoteStale } from "../src/sidepanel/history.js";
import {
  lookupVin,
  makeSosVinSuggestions,
  normalizeVinLookupInput,
  vinLookupSummary,
} from "../src/sidepanel/vin-lookup.js";
import {
  SOS_FEE_MESSAGES,
  createSosFeeRunner,
  validSosSubmissionFields,
} from "../src/worker/sos-fee-runner.js";
import { __test as sosLienCheckTest } from "../src/worker/sos-lien-check.js";

const runnerScript = readFileSync(
  new URL("../src/worker/sos-fee-runner.js", import.meta.url),
  "utf8"
);
const lienScript = readFileSync(
  new URL("../src/worker/sos-lien-check.js", import.meta.url),
  "utf8"
);
const sidepanelHtml = readFileSync(
  new URL("../sidepanel.html", import.meta.url),
  "utf8"
);
const sidepanelScript = readFileSync(
  new URL("../sidepanel.js", import.meta.url),
  "utf8"
);
const datePickerScript = readFileSync(
  new URL("../src/sidepanel/date-picker.js", import.meta.url),
  "utf8"
);
const sidepanelCss = readFileSync(
  new URL("../sidepanel.css", import.meta.url),
  "utf8"
);
const packageScript = readFileSync(
  new URL("../tools/package-extension.sh", import.meta.url),
  "utf8"
);
const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8")
);

function newPlateValues(overrides = {}) {
  return {
    mode: SOS_QUOTE_MODE.newPlate,
    vehicleType: "Passenger",
    bodyStyle: "4D",
    vehicleUse: "PASS",
    fuelType: "GAS",
    modelYear: "2026",
    msrp: "42500",
    firstTitle: "no",
    businessRegistration: "no",
    // Michigan expires a passenger plate on the owner's birthday, so the
    // official calculator will not return any total without this.
    ownerBirthdate: "03/14/1985",
    plateType: "PAS",
    plateDesign: "pure_michigan",
    recreationPassport: "no",
    purchaseDate: "",
    transferPlateNumber: "",
    ...overrides,
  };
}

function verifiedResult(mode = SOS_QUOTE_MODE.newPlate) {
  return {
    success: true,
    quote: {
      calculationMode: mode,
      feeCents: 20500,
      feeBreakdown: [{ label: "Registration fee", feeCents: 20500 }],
      vehicleDescription: "2026 · Car / Mini-Van / SUV · 4 Door",
      platePreviewUrl: "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.PAS.PM",
      recreationPassport: false,
      officialPageImage: "data:image/jpeg;base64,QUJDRA==",
      calculatedAt: "2026-08-15T12:00:00.000Z",
    },
  };
}

/**
 * Drive the runner against a stubbed backend client.
 *
 * `respond` receives the payload and the caller's abort signal so a test can
 * assert what was sent, resolve, reject, or hang until it is cancelled.
 */
function runnerHarness(respond) {
  const requests = [];
  const runner = createSosFeeRunner({
    async requestQuote(payload, options) {
      requests.push({ payload, options });
      return respond(payload, options);
    },
  });
  return { requests, runner };
}

test("local dealer form defaults to Gas and includes modern fuels and commercial plates", () => {
  assert.deepEqual(SOS_VEHICLE_OPTIONS.map(([value]) => value), [
    "Passenger",
    "Pickup",
    "UtilityTruck",
    "Van",
    "StakeTruck",
  ]);
  assert.equal(SOS_FUEL_OPTIONS[0][1], "Gas");
  for (const fuel of [
    "Diesel",
    "Electric",
    "Electric & Gas Hybrid",
    "Electric & Diesel Hybrid",
    "Plug in Hybrid Electric",
  ]) {
    assert.ok(SOS_FUEL_OPTIONS.some(([, label]) => label === fuel));
  }
  assert.ok(plateOptionsForUse("COM").some(([, label]) => label === "Commercial"));
  assert.equal(plateOptionsForUse("COM").some(([value]) => value === "PAS"), false);
});

test("selected plate artwork expands in a fast in-sidebar viewer", () => {
  const designs = Object.values(SOS_PLATE_DESIGNS);
  assert.equal(new Set(designs.map((design) => design.value)).size, designs.length);
  assert.equal(designs.length, 89);
  for (const design of designs) {
    if (design.imageUrl) {
      assert.match(
        design.imageUrl,
        /^https:\/\/(?:www\.michigan\.gov\/sos\/|dsvsesvc\.sos\.state\.mi\.us\/TAP\/Image\/)/
      );
      assert.match(
        design.fullImageUrl,
        /^https:\/\/(?:www\.michigan\.gov\/sos\/|dsvsesvc\.sos\.state\.mi\.us\/TAP\/Image\/)/
      );
      if (design.fullImageUrl.startsWith("https://www.michigan.gov/")) {
        assert.match(design.fullImageUrl, /[?&]mw=1600(?:&|$)/);
      }
    } else {
      assert.equal(design.fullImageUrl, null);
    }
    assert.ok(design.label);
    assert.ok(design.plateType);
    assert.ok(design.selection?.field);
    assert.ok(design.selection?.optionValue);
    assert.match(design.sourceUrl, /^https:\/\/www\.michigan\.gov\/sos\/vehicle\/license-plates(?:\/|$)/);
  }
  assert.equal(designs.filter((design) => !design.imageUrl).length, 0);
  assert.equal(plateDesignOptionsForType("PAS").length, 4);
  assert.equal(plateDesignOptionsForType("LCY").length, 3);
  assert.equal(plateDesignOptionsForType("SC").length, 18);
  assert.equal(plateDesignOptionsForType("U").length, 15);
  assert.equal(plateDesignOptionsForType("VT").length, 32);
  assert.equal(plateDesignOptionsForType("PSO").length, 10);
  assert.equal(plateDesignOptionsForType("GLD").length, 1);
  assert.equal(plateDesignOptionsForType("ARO").length, 1);
  assert.equal(plateDesignOptionsForType("COM").length, 2);
  assert.equal(plateDesignOptionsForType("FLT").length, 1);
  assert.equal(plateDesignOptionsForType("RFL").length, 1);
  assert.equal(plateDesignOptionsForType("CONSUL").length, 1);
  assert.equal(SOS_PLATE_DESIGNS.aro_amateur_radio.selection.optionValue, "PM");
  assert.match(SOS_PLATE_DESIGNS.commercial_mackinac_bridge.imageUrl, /Standard_MacBridge\.jpg/);
  assert.match(sidepanelHtml, /id="sosPlatePreviewImage"[^>]+src="https:\/\/www\.michigan\.gov\/sos\//);
  for (const id of [
    "sosPlateViewer",
    "sosPlateViewerImage",
    "closeSosPlateViewer",
    "sosPlateZoomOut",
    "sosPlateZoomReset",
    "sosPlateZoomIn",
  ]) {
    assert.match(sidepanelHtml, new RegExp(`id="${id}"`));
  }
  assert.match(sidepanelHtml, /class="modal sos-plate-viewer hidden"[^>]+role="dialog"/);
  assert.match(sidepanelHtml, /Design sample only · non-personalized/);
  assert.match(sidepanelScript, /showModal\(elements\.sosPlateViewer/);
  assert.match(sidepanelScript, /hideModal\(elements\.sosPlateViewer\)/);
  assert.match(sidepanelScript, /SOS_PLATE_ZOOM_MIN\s*=\s*0\.75/);
  assert.match(sidepanelScript, /SOS_PLATE_ZOOM_MAX\s*=\s*2\.5/);
  assert.match(sidepanelScript, /Loading the largest official artwork/);
  assert.match(sidepanelScript, /const fullImage = new Image\(\)/);
  assert.match(sidepanelScript, /fullImage\.onerror/);
  assert.match(sidepanelScript, /credentials:\s*"omit"/);
  assert.match(sidepanelScript, /URL\.createObjectURL\(blob\)/);
  assert.match(sidepanelScript, /URL\.revokeObjectURL/);
  assert.match(sidepanelScript, /SOS_PLATE_IMAGE_MAX_BYTES/);
  assert.match(sidepanelScript, /new AbortController\(\)/);
  assert.match(sidepanelScript, /response\.body\.getReader\(\)/);
  assert.match(sidepanelScript, /reader\.cancel\(/);
  assert.match(sidepanelScript, /decodedImage\.onerror/);
  assert.match(sidepanelScript, /addEventListener\("pagehide",\s*disposeSosPlateImages/);
  assert.match(sidepanelScript, /addEventListener\("pointermove",\s*moveSosPlatePan\)/);
  assert.match(sidepanelScript, /invalidateSosQuoteAfterEdit\(\)/);
  assert.match(sidepanelCss, /\.sos-plate-viewer-stage/);
  assert.match(sidepanelCss, /width:\s*var\(--sos-plate-zoom-width/);
  assert.doesNotMatch(sidepanelScript, /chrome\.windows\./);
  assert.doesNotMatch(sidepanelScript, /type:\s*"popup"/);
  assert.doesNotMatch(sidepanelScript, /:\s*"pure_michigan"\s*\)/);
  assert.doesNotMatch(packageScript, /plate-preview\.(?:html|js|css)/);
  assert.match(manifest.content_security_policy.extension_pages, /https:\/\/www\.michigan\.gov/);
});

test("local form builds one semantic SOS batch and validates commercial details", () => {
  const values = newPlateValues({
    vehicleType: "Pickup",
    bodyStyle: "PU",
    vehicleUse: "COM",
    fuelType: "DIESEL",
    plateType: "COM",
    plateDesign: "commercial_standard_white",
    businessRegistration: "yes",
  });
  assert.deepEqual(validateSosLocalValues(values), []);
  const submission = buildSosSubmission(values);
  assert.equal(validSosSubmissionFields(submission), true);
  assert.equal(
    submission.find((field) => field.label === "Select your fuel type").optionLabel,
    "Diesel"
  );
  assert.equal(
    submission.find((field) => field.label === "Is this for a business?").value,
    "Yes"
  );
  assert.equal(submission.some((field) => /VIN/i.test(field.label)), false);
  assert.equal(
    validateSosLocalValues({ ...values, businessRegistration: "" })[0].id,
    "sosBusinessRegistration"
  );
  assert.equal(
    validateSosLocalValues({ ...values, purchaseDate: "02/31/2026" }).at(-1).id,
    "sosPurchaseDate"
  );
  // The caption moved out of the label and under the input: inside the label it
  // wrapped to two lines and made its cell taller than the control beside it.
  assert.match(sidepanelHtml, /<label for="sosPurchaseDate">Plate purchase date<\/label>/);
  assert.match(sidepanelHtml, /<small id="sosPurchaseDateHint">Changes the fee · defaults to today<\/small>/);
  assert.doesNotMatch(sidepanelHtml, /Passport &amp; purchase date/);
});

test("specialty selections submit the exact live SOS subtype and background", () => {
  const values = newPlateValues({
    plateType: "SC",
    plateDesign: "sc_detroit_lions",
  });
  assert.deepEqual(validateSosLocalValues(values), []);
  const submission = buildSosSubmission(values);
  assert.deepEqual(
    submission
      .filter((item) => item.label === "Plate Sub Type" || item.label === "Plate Background")
      .map(({ label, optionValue, optionLabel }) => ({ label, optionValue, optionLabel })),
    [
      { label: "Plate Sub Type", optionValue: "LION", optionLabel: "Detroit Lions" },
      { label: "Plate Background", optionValue: "PM", optionLabel: "Standard White" },
    ]
  );
  assert.equal(
    validateSosLocalValues({ ...values, plateDesign: "u_michigan" })[0].id,
    "sosPlateDesign"
  );
  assert.equal(
    validateSosLocalValues({ ...values, plateType: "COM", plateDesign: "commercial_standard_white" })[0].id,
    "sosPlateType"
  );
});

test("Calculate sends one bounded backend request and nothing opens locally", async () => {
  const fields = buildSosSubmission(newPlateValues());
  const harness = runnerHarness(() => verifiedResult());

  const response = await harness.runner.calculate(SOS_QUOTE_MODE.newPlate, fields);

  assert.equal(response.success, true);
  assert.equal(response.quote.feeCents, 20500);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].payload.mode, SOS_QUOTE_MODE.newPlate);
  assert.deepEqual(harness.requests[0].payload.fields, fields);
  assert.ok(harness.requests[0].options.signal instanceof AbortSignal);
  assert.equal(harness.runner.isInFlight(), false);
  // The whole point of this change: no tab, window, or content script is
  // touched on the customer-facing machine.
  assert.doesNotMatch(runnerScript, /chrome\.tabs|chromeApi\.tabs|tabs\.create|tabs\.sendMessage/);
  assert.equal(SOS_FEE_MESSAGES.calculate, "SOS_FEE_CALCULATE");
});

test("an incomplete field batch never reaches the backend", async () => {
  const harness = runnerHarness(() => verifiedResult());

  for (const [mode, fields] of [
    ["sideways", buildSosSubmission(newPlateValues())],
    [SOS_QUOTE_MODE.newPlate, []],
    [SOS_QUOTE_MODE.newPlate, [{ label: "x", kind: "select" }]],
    [SOS_QUOTE_MODE.newPlate, "fields"],
  ]) {
    const response = await harness.runner.calculate(mode, fields);
    assert.equal(response.success, false);
    assert.match(response.error, /Complete the required SOS fee fields/i);
  }
  assert.equal(harness.requests.length, 0);
});

// The api-client rejects a malformed quote; the runner relays that as a plain
// failure and never invents a fee of its own.
test("a rejected backend quote fails closed with actionable recourse", async () => {
  const harness = runnerHarness(() => ({
    success: false,
    error:
      "The compliance service returned an incomplete Michigan SOS fee result. Please try again.",
  }));

  const response = await harness.runner.calculate(
    SOS_QUOTE_MODE.newPlate,
    buildSosSubmission(newPlateValues())
  );

  assert.equal(response.success, false);
  assert.equal(response.quote, undefined);
  assert.match(response.error, /incomplete Michigan SOS fee result/i);
  // No handoff path survives, so the failure text has to carry the recourse.
  assert.doesNotMatch(runnerScript, /handoffAvailable|openHandoff/);
  assert.match(runnerScript, /confirm the fee with Michigan SOS before quoting the customer/);
});

test("a malformed backend envelope is rejected rather than half-read", async () => {
  for (const malformed of [
    undefined,
    null,
    {},
    { success: true },
    { success: true, quote: null },
  ]) {
    const harness = runnerHarness(() => malformed);
    const response = await harness.runner.calculate(
      SOS_QUOTE_MODE.newPlate,
      buildSosSubmission(newPlateValues())
    );
    assert.equal(response.success, false);
    assert.equal(response.quote, undefined);
    assert.ok(response.error);
  }
});

test("a transport failure is reported without echoing the backend error", async () => {
  const harness = runnerHarness(() => {
    throw new Error("ECONNRESET while POSTing VIN 1FMDE8AP9RLA12345");
  });

  const response = await harness.runner.calculate(
    SOS_QUOTE_MODE.newPlate,
    buildSosSubmission(newPlateValues())
  );

  assert.equal(response.success, false);
  assert.doesNotMatch(response.error, /ECONNRESET|1FMDE8AP9RLA12345/);
  assert.match(response.error, /Try again in a moment/i);
});

test("cancelling aborts the in-flight quote and reports it as cancelled", async () => {
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const harness = runnerHarness(
    (_payload, { signal }) =>
      new Promise((_resolve, reject) => {
        markStarted();
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      })
  );

  const pending = harness.runner.calculate(
    SOS_QUOTE_MODE.newPlate,
    buildSosSubmission(newPlateValues())
  );
  await started;
  assert.equal(harness.runner.isInFlight(), true);

  assert.deepEqual(harness.runner.cancel(), { success: true });
  const response = await pending;
  assert.equal(response.success, false);
  assert.equal(response.cancelled, true);
  assert.equal(harness.runner.isInFlight(), false);
  assert.equal(harness.requests[0].options.signal.aborted, true);
});

// A late answer for superseded choices is how a customer ends up reading a fee
// for a vehicle configuration that is no longer on screen.
test("a superseded quote resolves as cancelled instead of repainting a stale fee", async () => {
  const pendingResolvers = [];
  const harness = runnerHarness(
    () => new Promise((resolve) => pendingResolvers.push(resolve))
  );

  const first = harness.runner.calculate(
    SOS_QUOTE_MODE.newPlate,
    buildSosSubmission(newPlateValues())
  );
  await Promise.resolve();
  const second = harness.runner.calculate(
    SOS_QUOTE_MODE.newPlate,
    buildSosSubmission(newPlateValues({ msrp: "51000" }))
  );
  await Promise.resolve();

  pendingResolvers[0](verifiedResult());
  pendingResolvers[1](verifiedResult());

  assert.equal((await first).cancelled, true);
  assert.equal((await second).success, true);
});

test("plate transfer submits the vehicle being purchased, not just the plate", async () => {
  // Verified live: the transfer calculator is two-stage. After it searches the
  // plate it asks about the vehicle being purchased, and sending only the plate
  // left that stage unanswered so no total was ever produced.
  const transferValues = {
    mode: SOS_QUOTE_MODE.plateTransfer,
    transferPlateNumber: "ABC 1234",
    transferChangePlate: "no",
    transferAlreadyOwn: "no",
    vehicleType: "Passenger",
    bodyStyle: "4D",
    vehicleUse: "PASS",
    fuelType: "GAS",
    modelYear: "2026",
    msrp: "42500",
    firstTitle: "no",
    recreationPassport: "no",
  };
  assert.deepEqual(validateSosLocalValues(transferValues), []);
  const fields = buildSosSubmission(transferValues);
  const labels = fields.map((f) => f.label);

  assert.equal(fields[0].value, "ABC 1234");
  for (const required of [
    "Do you want to change the plate being transferred?",
    "Select the vehicle type",
    "Select the body style",
    "Select how this vehicle will be used",
    "Select the fuel type",
    "Enter the vehicle model year",
    "Enter the vehicle MSRP",
    "Is the plate being transferred to a vehicle you already own?",
  ]) {
    assert.ok(labels.includes(required), `transfer must submit “${required}”`);
  }
  // The state words these differently on the transfer screen; the new-plate
  // wording would not be found there.
  assert.equal(labels.includes("Select your vehicle type"), false);
  assert.equal(labels.includes("Select how you will use your vehicle"), false);
  assert.equal(validSosSubmissionFields(fields), true);

  const harness = runnerHarness(() => verifiedResult(SOS_QUOTE_MODE.plateTransfer));
  const response = await harness.runner.calculate(SOS_QUOTE_MODE.plateTransfer, fields);
  assert.equal(response.success, true);
  assert.equal(harness.requests[0].payload.mode, SOS_QUOTE_MODE.plateTransfer);
  assert.equal(response.quote.calculationMode, SOS_QUOTE_MODE.plateTransfer);
});

test("a transfer will not be sent without the vehicle being purchased", () => {
  const issues = validateSosLocalValues({
    mode: SOS_QUOTE_MODE.plateTransfer,
    transferPlateNumber: "ABC 1234",
  });
  const ids = issues.map((issue) => issue.id);
  for (const id of ["sosVehicleType", "sosModelYear", "sosMsrp", "sosFirstTitle"]) {
    assert.ok(ids.includes(id), `${id} must be required for a transfer`);
  }
  // Plate options belong to a new plate; a transfer reuses the existing plate.
  assert.equal(ids.includes("sosPlateType"), false);
  assert.equal(ids.includes("sosOwnerBirthdate"), false);
});

test("official quote and print output retain only a verified customer-safe result", () => {
  const quote = createCalculatedQuote(
    {
      calculationMode: SOS_QUOTE_MODE.newPlate,
      feeCents: 12600,
      vehicleDescription: "2026 EV SUV VIN: 1FMDE8AP9RLA12345",
      platePreviewUrl:
        "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.PAS.PM?private=1",
      recreationPassport: true,
      feeBreakdown: [
        { label: "Registration fee", feeCents: 10000 },
        { label: "Plate fee", feeCents: 2600 },
      ],
      officialPageImage: "data:image/jpeg;base64,QUJDRA==",
      calculatedAt: "2026-08-15T12:00:00.000Z",
    },
    SOS_QUOTE_MODE.newPlate
  );
  assert.equal(quote.source, SOS_QUOTE_SOURCE.calculated);
  assert.equal(quote.vehicleDescription, "2026 EV SUV");
  assert.equal(
    quote.platePreviewUrl,
    "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.PAS.PM"
  );
  const html = createSosFeeQuotePrintHTML(quote);
  assert.match(html, /Calculated by SOS/);
  assert.match(html, /through the Compliance Central service/);
  // The customer sheet must not still describe a local browser tab.
  assert.doesNotMatch(html, /background tab/i);
  assert.match(html, /Selected — included in the SOS calculation/);
  assert.match(html, /\$126\.00/);
  assert.doesNotMatch(html, /1FMDE8AP9RLA12345/);
  const evidenceHtml = createSosOfficialEvidencePrintHTML(quote);
  assert.match(evidenceHtml, /Actual official state-site result page/);
  // The capture is a tall state web page; landscape letterboxed it and shrank
  // the text that has to stay readable on paper.
  assert.match(evidenceHtml, /letter portrait/);
  assert.match(evidenceHtml, /data:image\/jpeg;base64,QUJDRA==/);
  assert.equal(
    normalizeSosFeeQuote({
      mode: SOS_QUOTE_MODE.newPlate,
      source: "manual",
      feeCents: 2500,
      calculatedAt: "2026-08-15T12:00:00.000Z",
    }),
    null
  );
  assert.equal(
    sanitizePlatePreviewUrl("https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.QuestionPlate"),
    null
  );
  assert.equal(
    sanitizeVehicleDescription("VIN: 1FMDE8AP9RLA12345 2026 Explorer"),
    "2026 Explorer"
  );
});

test("VIN decode fills the easy local SOS fields immediately and never returns raw VIN", async () => {
  const requested = [];
  const decoded = await lookupVin("5UXWX7C5*BA", {
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            Results: [
              {
                VIN: "5UXWX7C5*BA",
                ModelYear: "2011",
                Make: "BMW",
                Model: "X3",
                VehicleType: "MULTIPURPOSE PASSENGER VEHICLE (MPV)",
                BodyClass: "Sport Utility Vehicle [SUV]/Multipurpose Vehicle [MPV]",
                Doors: "4",
                FuelTypePrimary: "Gasoline",
                FuelTypeSecondary: "",
                ElectrificationLevel: "",
                ErrorText: "6 - Incomplete VIN",
              },
            ],
          };
        },
      };
    },
  });
  const suggestions = makeSosVinSuggestions(decoded, localSosVinFields("Passenger"));
  assert.deepEqual(
    Object.fromEntries(suggestions.map((item) => [item.fieldId, item.value])),
    {
      sosVehicleType: "Passenger",
      sosBodyStyle: "4D",
      sosFuelType: "GAS",
      sosModelYear: "2011",
    }
  );
  assert.equal(vinLookupSummary(decoded), "2011 BMW X3");
  assert.doesNotMatch(JSON.stringify(decoded), /5UXWX7C5\*BA/);
  assert.match(requested[0].url, /DecodeVinValuesExtended\/5UXWX7C5%2ABA/);
  assert.equal(requested[0].options.credentials, "omit");
  assert.equal(normalizeVinLookupInput(" 5ux-wx7c5*ba "), "5UXWX7C5*BA");
});

test("VIN suggestions cover EV, hybrid, plug-in hybrid, diesel, and Gas", () => {
  const fields = localSosVinFields("Passenger");
  const base = {
    year: "2026",
    vehicleType: "MULTIPURPOSE PASSENGER VEHICLE (MPV)",
    bodyClass: "Sport Utility Vehicle",
    doors: "4",
    fuelTypePrimary: "Gasoline",
    fuelTypeSecondary: "",
    electrificationLevel: "",
  };
  const fuel = (decoded) =>
    makeSosVinSuggestions(decoded, fields).find(
      (suggestion) => suggestion.fieldId === "sosFuelType"
    )?.value;
  assert.equal(fuel(base), "GAS");
  assert.equal(fuel({ ...base, fuelTypePrimary: "Diesel" }), "DIESEL");
  assert.equal(fuel({ ...base, fuelTypePrimary: "Electric" }), "ELECTR");
  assert.equal(fuel({ ...base, electrificationLevel: "Hybrid Electric Vehicle (HEV)" }), "HYBEG");
  assert.equal(
    fuel({ ...base, electrificationLevel: "Plug-in Hybrid Electric Vehicle (PHEV)" }),
    "PHEV"
  );
});

test("title/lien helper discards page evidence and is never written to storage", () => {
  const result = sosLienCheckTest.safeTitleResult({
    passed: true,
    titleStatus: "Clear",
    titleBrand: "CLEAN",
    titleType: "Paper",
    lienStatus: "No Active Liens",
    hasLien: false,
    lienHolder: "",
    vehicleBrands: ["Clean"],
    screenshotData: "data:image/png;base64,private",
    rawText: "VIN 1FMDE8AP9RLA12345",
  });
  assert.equal(result.screenshotData, undefined);
  assert.equal(result.rawText, undefined);
  assert.doesNotMatch(JSON.stringify(result), /1FMDE8AP9RLA12345/);
  assert.doesNotMatch(lienScript, /chrome\.storage|screenshotData|rawText/);
});

test("UI, manifest, and package drop every local-tab affordance", () => {
  // `tabs` existed only to drive the visible SOS calculator. Nothing else in
  // the extension touches the tabs API, so the permission goes with it.
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.content_scripts, undefined);
  // The SOS host stays: the side panel still fetches official plate artwork
  // from dsvsesvc.sos.state.mi.us and the CSP still renders it.
  assert.ok(manifest.host_permissions.includes("https://dsvsesvc.sos.state.mi.us/*"));
  assert.ok(manifest.host_permissions.includes("https://vpic.nhtsa.dot.gov/*"));
  assert.match(
    manifest.content_security_policy.extension_pages,
    /https:\/\/dsvsesvc\.sos\.state\.mi\.us/
  );
  assert.ok(manifest.host_permissions.includes("https://compliance-central-api.fly.dev/*"));

  // Nothing may reference the deleted content script or its screenshot library.
  for (const source of [runnerScript, sidepanelScript, packageScript, JSON.stringify(manifest)]) {
    assert.doesNotMatch(source, /sos-fee-quote-content|html2canvas/);
  }
  assert.doesNotMatch(runnerScript, /chrome\.tabs|chromeApi\.tabs|storage\.local|sosFeeActiveTabId/);
  assert.doesNotMatch(sidepanelScript, /chrome\.tabs\.(?:create|update|query)/);
  assert.doesNotMatch(sidepanelScript, /SOS_FEE_OPEN_HANDOFF|sosHandoffAvailable|openSosHandoff/);
  assert.doesNotMatch(sidepanelHtml, /sosHandoffPanel|openSosHandoffBtn|Finish on Michigan SOS/);
  assert.doesNotMatch(sidepanelCss, /\.sos-handoff|is-handoff/);
  assert.doesNotMatch(sidepanelHtml, /Fallback: enter a fee manually|Load official choices/);
  assert.doesNotMatch(sidepanelScript, /SOS_FEE_UPDATE_FIELD|SOS_FEE_START/);
  assert.equal(STORAGE_KEYS.sosFeeActiveTabId, undefined);

  // The rest of the workspace contract is unchanged.
  for (const id of [
    "calculateSosFeeBtn",
    "sosVehicleType",
    "sosFuelType",
    "sosPlateType",
    "sosPlateDesign",
    "sosPlatePreview",
    "lookupSosVinBtn",
    "printSosQuoteBtn",
    "printSosCalculationBtn",
    "downloadSosCalculationPdfBtn",
  ]) {
    assert.match(sidepanelHtml, new RegExp(`id="${id}"`));
  }
  assert.match(sidepanelScript, /type:\s*"SOS_FEE_CALCULATE"/);
  assert.match(sidepanelScript, /type:\s*"SOS_FEE_CANCEL"/);
  assert.match(sidepanelScript, /fields:\s*buildSosSubmission\(values\)/);
  assert.match(sidepanelScript, /applyPendingVinSuggestions\(\)/);
  assert.match(sidepanelHtml, /Auto-fill by vehicle VIN/);
  assert.match(sidepanelHtml, /Trade Title\/Lien stays in the Trade-In section above/);
  assert.doesNotMatch(sidepanelHtml, /Use trade VIN|VIN assist \+ lien check/);
  // Print/PDF still gate on the optional official-page capture.
  assert.match(sidepanelScript, /printSosCalculationBtn\.disabled = !quote\?\.officialPageImage/);
  assert.match(
    sidepanelScript,
    /downloadSosCalculationPdfBtn\.disabled = !quote\?\.officialPageImage/
  );
});

// A failed official-page capture used to invalidate an otherwise correct SOS
// total, so a fully parsed fee degraded to "finish this on Michigan SOS".
test("a verified total is accepted when the evidence capture fails", async () => {
  const withoutImage = verifiedResult();
  withoutImage.quote.officialPageImage = null;
  const harness = runnerHarness(() => withoutImage);

  const response = await harness.runner.calculate(
    SOS_QUOTE_MODE.newPlate,
    buildSosSubmission(newPlateValues())
  );

  assert.equal(response.success, true);
  assert.equal(response.quote.feeCents, 20500);
  assert.equal(response.quote.officialPageImage, null);
  // One request only: a verified fee must not be retried away.
  assert.equal(harness.requests.length, 1);

  // The whole render/print chain still accepts the quote without evidence.
  const quote = createCalculatedQuote(response.quote, SOS_QUOTE_MODE.newPlate);
  assert.equal(quote.feeCents, 20500);
  assert.equal(quote.officialPageImage, null);
  assert.ok(createSosFeeQuotePrintHTML(quote));
  // Only the official-evidence print, which needs the image, degrades.
  assert.equal(createSosOfficialEvidencePrintHTML(quote), "");
});

// Michigan line items such as "Recreation Passport" carry none of the words the
// old parser required, and one unmatched row failed the entire table. The
// exact-sum reconciliation moved to the api-client and remains the guard.
test("a fee breakdown must reconcile exactly to the state total", () => {
  const apiClient = readFileSync(new URL("../lib/api-client.js", import.meta.url), "utf8");
  assert.match(
    apiClient,
    /feeBreakdown\.reduce\(\s*\(sum, row\) => sum \+ row\.feeCents,\s*0\s*\)/
  );
  assert.match(apiClient, /breakdownTotal !== quote\.feeCents/);
  // Any labelled, non-negative integer row is acceptable; only the sum decides.
  assert.doesNotMatch(apiClient, /fee\|registration\|plate/);
});

// Michigan reads a passenger plate's expiration from the owner's birthday. The
// official calculator asks on every flow, not just the commercial one, and
// omitting these left the state form silently unanswered — no total was ever
// produced and the salesperson was pushed onto the SOS site to finish by hand.
test("every new-plate batch answers registered-to and the owner birthdate", () => {
  const submission = buildSosSubmission(newPlateValues());
  const business = submission.find((f) => f.label === "Is this for a business?");
  const birthdate = submission.find((f) => /birthdate/i.test(f.label));
  assert.equal(business?.value, "No");
  assert.equal(birthdate?.value, "03/14/1985");
  assert.equal(validSosSubmissionFields(submission), true);
});

test("a business registration is never asked for a birthdate", () => {
  const values = newPlateValues({ businessRegistration: "yes", ownerBirthdate: "" });
  assert.deepEqual(validateSosLocalValues(values), []);
  const submission = buildSosSubmission(values);
  assert.equal(submission.find((f) => f.label === "Is this for a business?").value, "Yes");
  assert.equal(submission.some((f) => /birthdate/i.test(f.label)), false);
});

test("a person registration requires a real birthdate", () => {
  for (const bad of ["", "3/14/1985", "13/01/1990", "02/31/1990", "03/14/2999"]) {
    const issues = validateSosLocalValues(newPlateValues({ ownerBirthdate: bad }));
    assert.ok(
      issues.some((i) => i.id === "sosOwnerBirthdate"),
      `${bad || "(empty)"} must be rejected`
    );
  }
  // While registered-to is still unanswered, that question owns the error.
  const unanswered = validateSosLocalValues(
    newPlateValues({ businessRegistration: "", ownerBirthdate: "" })
  );
  assert.equal(unanswered.some((i) => i.id === "sosOwnerBirthdate"), false);
});

test("the birthdate field is present and explains why it is asked", () => {
  assert.match(sidepanelHtml, /id="sosOwnerBirthdate"/);
  assert.match(sidepanelHtml, /expire on the owner's birthday/i);
  // Registered-to drives the birthdate, so it can no longer start hidden.
  assert.doesNotMatch(sidepanelHtml, /id="sosBusinessRegistration"[^>]*hidden/);
});

// The registered owner's birthdate is personal data belonging to one deal.
// Leaving it behind would retain a date of birth and price the next customer's
// registration off the wrong expiration date.
test("both Clear controls reset the whole plate workbench", () => {
  // These inputs used to survive Clear, so the next customer inherited the
  // previous deal's model year, MSRP and plate choice.
  for (const fn of ["handleClear", "clearCurrentSosFeeQuote"]) {
    const start = sidepanelScript.indexOf(`function ${fn}(`);
    assert.ok(start > -1, `${fn} must exist`);
    const body = sidepanelScript.slice(start, start + 4200);
    assert.match(body, /resetSosLocalForm\(\)/, `${fn} must reset the workbench`);
  }

  const start = sidepanelScript.indexOf("function resetSosLocalForm()");
  assert.ok(start > -1, "resetSosLocalForm must exist");
  const body = sidepanelScript.slice(start, start + 2000);
  for (const field of [
    "sosModelYear",
    "sosMsrp",
    "sosPurchaseDate",
    "sosTransferPlateNumber",
    "sosOwnerBirthdate",
  ]) {
    assert.match(body, new RegExp(`elements\\.${field}`), `${field} must be cleared`);
  }
  // The owner birthdate is personal data, and its touched flag must reset so
  // the Screening DOB can prefill again for the next customer.
  assert.match(body, /delete elements\.sosOwnerBirthdate\.dataset\.touched/);
  assert.match(body, /prefillSosPurchaseDate\(\)/);
});

test("the birthdate hint uses a styled element", () => {
  assert.match(sidepanelHtml, /<small id="sosOwnerBirthdateHint">/);
  assert.doesNotMatch(sidepanelHtml, /class="sos-hint"/);
  assert.match(sidepanelCss, /\.sos-control small/);
  // Hiding the control for a business relies on this rule existing.
  assert.match(sidepanelCss, /\.sos-control\[hidden\]\s*{\s*display:\s*none/);
});

// A typed "08081985" used to stay raw in the SOS workbench and fail validation,
// because those inputs carry no picker shell and so had no mask.
test("SOS date fields format a typed date and default the purchase date", () => {
  assert.match(sidepanelScript, /function attachDateMask\(input\)/);
  assert.match(sidepanelScript, /attachDateMask\(elements\.sosOwnerBirthdate\)/);
  assert.match(sidepanelScript, /attachDateMask\(elements\.sosPurchaseDate\)/);
  // Masking on blur as well as input tidies a pasted value.
  assert.match(sidepanelScript, /input\.addEventListener\("blur", apply\)/);
  // The mask itself is the picker's, not a second copy of date logic.
  assert.match(sidepanelScript, /maskDateText/);
  assert.match(datePickerScript, /export function maskDateText/);
  // Michigan falls back to today; the quote should say so rather than imply it.
  assert.match(sidepanelScript, /function prefillSosPurchaseDate\(\)/);
  assert.match(sidepanelScript, /prefillSosPurchaseDate\(\)/);
});

// The state calls this "Please enter the date the plate will be purchased".
// Matching on "date you plan to purchase the plate" never found the field, and
// because the question is optional the value was dropped in silence: a future
// purchase date quoted as today, verified live as $179 instead of $349.
test("the purchase date is labelled the way Michigan labels it", () => {
  const fields = buildSosSubmission(newPlateValues({ purchaseDate: "12/01/2026" }));
  const purchase = fields.find((f) => /purchas/i.test(f.label));
  assert.ok(purchase, "a purchase date must be submitted when one is set");
  assert.equal(purchase.value, "12/01/2026");
  // Must be a real substring of the state's own question.
  const stateLabel =
    "Please enter the date the plate will be purchased (if no date is entered, " +
    "the registration fees will be calculated based on today's date).";
  assert.ok(
    stateLabel.toLowerCase().includes(purchase.labelIncludes.toLowerCase()),
    `labelIncludes "${purchase.labelIncludes}" is not in the state's wording`
  );
});

// The panel was redesigned onto a light canvas, but several colours were left
// over from the original dark theme. Gold on white is about 1.5:1, far under
// the 4.5:1 AA minimum, which is why the progress percentage and the purchase
// date note were hard to read.
test("the progress readout and date note are legible on the light canvas", () => {
  const redesign = sidepanelCss.slice(sidepanelCss.indexOf("--design-navy:"));
  // The fill also carried a gold glow and shimmer that the override left behind.
  assert.match(redesign, /\.progress-fill\s*{[^}]*animation:\s*none/);
  assert.match(redesign, /\.progress-fill\s*{[^}]*box-shadow:\s*none/);
  assert.match(redesign, /#progressPercent\s*{[^}]*var\(--design-navy\)/);
  assert.match(redesign, /\.progress-text\s*{[^}]*var\(--design-ink\)/);
  assert.match(redesign, /\.progress-text\s*{[^}]*text-shadow:\s*none/);
  assert.match(redesign, /\.sos-purchase-date > label span\s*{[^}]*var\(--design-warning\)/);
  // Nothing in the readout should still resolve to the gold token.
  assert.doesNotMatch(redesign, /#progressPercent\s*{[^}]*var\(--gold\)/);
});

// Clear form sat ~1200px down a 400px-wide panel, below the co-buyer, trade-in
// and privacy sections, so it was effectively undiscoverable.
test("the screening action row stays reachable without scrolling to the end", () => {
  const rule = sidepanelCss.slice(sidepanelCss.indexOf(".main-actions {"));
  assert.match(rule, /position:\s*sticky/);
  assert.match(rule, /bottom:\s*0/);
  assert.match(rule, /background:\s*var\(--design-card\)/);
  // Run all checks and Clear form must both live in that pinned row.
  const actions = sidepanelHtml.slice(sidepanelHtml.indexOf('class="main-actions"'));
  assert.ok(actions.indexOf('id="runAllChecksBtn"') > -1);
  assert.ok(actions.indexOf('id="clearBtn"') > -1);
});

// The active-tab underline hung 1px below a sticky strip with overflow:visible,
// so it floated over the content scrolling beneath and looked clipped.
test("the active tab underline sits inside the tab strip", () => {
  const rule = sidepanelCss.slice(
    sidepanelCss.indexOf(".workspace-tabs button::after {"),
    sidepanelCss.indexOf(".workspace-tabs button::after {") + 600
  );
  assert.match(rule, /bottom:\s*0;/);
  assert.doesNotMatch(rule, /bottom:\s*-1px/);
  // Rounded both ends; the old 999px/999px/0/0 read upside-down as an underline.
  assert.match(rule, /border-radius:\s*999px;/);
});

// The capture is a full state web page, taller than it is wide, so both the
// print sheet and the PDF are portrait — landscape letterboxed it and shrank
// the text that has to stay readable on paper.
test("official SOS evidence prints portrait", () => {
  const sosSource = readFileSync(
    new URL("../src/sidepanel/sos-fee-quote.js", import.meta.url),
    "utf8"
  );
  // The page size lives in the shared print base, so every sheet — this one
  // included — is letter portrait with the same 0.6in margin.
  assert.match(printBaseCSS(), /@page \{ size: letter portrait; margin: 0\.6in; \}/);
  assert.doesNotMatch(sosSource, /@page/);
  assert.doesNotMatch(sosSource, /size: letter landscape/);
  // Letter portrait content box at 0.6in margins is 9.8in tall; the sheet
  // stops a tenth short so rounding never spills onto a blank second page.
  assert.match(sosSource, /\.page \{ height: 9\.7in/);

  const exportSource = readFileSync(
    new URL("../src/sidepanel/export.js", import.meta.url),
    "utf8"
  );
  assert.match(exportSource, /createPdfContext\("portrait"\)/);
  assert.doesNotMatch(exportSource, /createPdfContext\("landscape"\)/);
});

// The action row sits above the results in the DOM, and position:sticky only
// pins inside its own section, so once results render the Clear control has
// scrolled out of reach. The same handler is offered where the salesperson
// actually is when a screening finishes.
test("a finished screening can be cleared from the results header", () => {
  assert.match(sidepanelHtml, /id="newCustomerBtn"/);
  // It lives in the results evidence header, not the form's action row.
  const results = sidepanelHtml.slice(sidepanelHtml.indexOf('id="resultsSection"'));
  assert.ok(
    results.indexOf('id="newCustomerBtn"') > -1,
    "New customer must live inside the results section"
  );
  // Same handler as Clear form, so the two cannot drift apart.
  assert.match(
    sidepanelScript,
    /elements\.newCustomerBtn\?\.addEventListener\("click", handleClear\)/
  );
  // The heading must be able to wrap, or a third action squeezes the label.
  assert.match(sidepanelCss, /\.evidence-heading \{[^}]*flex-wrap:\s*wrap/);
});

// The scan prompt is a step above the form, not a landing page. At its old size
// it filled roughly half a 700px panel before the first field was reachable.
test("the scan prompt stays compact above the form", () => {
  const hero = sidepanelCss.slice(
    sidepanelCss.indexOf(".first-run-hero {"),
    sidepanelCss.indexOf(".first-run-hero {") + 400
  );
  assert.match(hero, /padding:\s*9px 20px 11px/);
  // The headline must stay well under the old 2rem cap in a 400px panel.
  const heading = sidepanelCss.slice(sidepanelCss.indexOf(".first-run-hero h2 {"));
  assert.match(heading, /font-size:\s*clamp\(1\.02rem, 4\.4vw, 1\.15rem\)/);
  // Trimming the box must not shrink the tap target below the 44px minimum.
  const scan = sidepanelCss.slice(sidepanelCss.indexOf(".first-run-scan-btn {"));
  assert.match(scan, /min-height:\s*44px/);
});

// A pending delivery was announced by a toast that vanished after seven seconds
// and could not be clicked, so the one reminder that must not be missed reached
// only whoever happened to be looking at the panel.
test("the delivery reminder is a control, not a passing notice", () => {
  // It must be a button so it is clickable and keyboard reachable.
  assert.match(sidepanelHtml, /<button[^>]*id="rescreenBanner"/);
  assert.match(sidepanelScript, /elements\.rescreenBanner\?\.addEventListener\("click", openRescreenTarget\)/);
  // Clicking it has to land somewhere useful: the saved records, filtered.
  const open = sidepanelScript.slice(sidepanelScript.indexOf("function openRescreenTarget()"));
  assert.match(open, /historyAgingOnly.*checked = true/s);
  assert.match(open, /activateWorkspace\("history"/);
  // The old fire-and-forget toast must not come back.
  assert.doesNotMatch(sidepanelScript, /re-screen any open deal before delivery/);
});

// Michigan prices a registration from the purchase date, so the same vehicle
// quoted on a different day can carry a different fee — verified live at
// $179.00 for today against $349.00 for a later date.
test("a plate fee quoted on an earlier day counts as stale", () => {
  const now = new Date("2026-08-17T20:00:00Z").getTime();
  assert.equal(isPlateQuoteStale({ calculatedAt: "2026-08-17T09:00:00Z" }, now), false);
  assert.equal(isPlateQuoteStale({ calculatedAt: "2026-08-16T23:59:00Z" }, now), true);
  // Absent or unparseable timestamps must not manufacture a warning.
  assert.equal(isPlateQuoteStale(null, now), false);
  assert.equal(isPlateQuoteStale({ calculatedAt: "not a date" }, now), false);
  // The reminder has to actually consider it.
  assert.match(sidepanelScript, /isPlateQuoteStale\(currentSosFeeQuote\)/);
});

// Found by measuring every visible text/background pair rather than by eye.
// Both sat on white cards well under the 4.5:1 AA minimum, and both are the
// same root cause as the earlier progress-bar fix: colours from the original
// dark panel left behind when the design moved to a light canvas.
test("required marks and the privacy link are legible", () => {
  // 2.19:1 before — the mark that tells a salesperson a field is mandatory.
  assert.match(sidepanelCss, /\.required \{\s*color: #b3261e;/);
  // 1.67:1 before — the link a customer follows to read what data leaves.
  assert.match(sidepanelCss, /\.data-use-note a \{\s*color: #175fa8;/);
});

test("the muted token clears AA on both the cards and the canvas", () => {
  // 4.29:1 on the canvas is under AA, and roughly fifty elements inherit it,
  // so the miss was systemic. #59697d is the smallest darkening that passes
  // against white (5.61) and against the canvas (4.81).
  assert.match(sidepanelCss, /--design-muted: #59697d;/);
  assert.doesNotMatch(sidepanelCss, /--design-muted: #5e7187;/);
});

// Below 520px the calendar becomes a sheet anchored to the viewport, but the JS
// still adds the drop-up class written for the absolutely positioned calendar.
// There `bottom: 100%` means "above the input"; against a fixed element it
// means "above the whole viewport", so whenever the birth date sat low on the
// page the calendar opened at roughly -391px — invisible, and indistinguishable
// from failing to open at all.
test("the birth-date calendar stays on screen when the field sits low", () => {
  const sheet = sidepanelCss.slice(sidepanelCss.indexOf("@media (max-width: 520px)"));
  const block = sheet.slice(0, sheet.indexOf("@media (max-width: 360px)"));
  assert.match(block, /\.date-picker-popover \{[^}]*position: fixed/);
  // The drop-up must be neutralised inside the sheet, at equal specificity.
  assert.match(block, /\.date-picker-popover\.date-picker-drop-up \{[^}]*bottom: 10px/);
});

// The two-column grid was scoped to the buyer card, so the co-buyer — the same
// six fields — stacked full width and read as a different form.
test("the co-buyer form is laid out like the buyer form", () => {
  assert.match(sidepanelCss, /\.typed-buyer-card \.form-row,\s*\n\.cobuyer-section \.form-row \{/);
  assert.match(sidepanelCss, /\.cobuyer-section \.form-row:nth-of-type\(2\)/);
  // Same label wording, so the two sections read as one form.
  assert.match(sidepanelHtml, /<label for="cbMiddleName">Middle Name<\/label>/);
});

// The plate calculator and the trade-in live on different tabs, so the same
// seventeen characters were retyped by hand — the one input here where a typo
// is both easy to make and silent.
test("the plate tab can reuse the trade-in VIN", () => {
  assert.match(sidepanelHtml, /id="useTradeVinBtn"/);
  assert.match(sidepanelScript, /function applyTradeVinToPlateTab\(\)/);
  // Offered only when there is a full VIN that is not already in the field.
  const sync = sidepanelScript.slice(sidepanelScript.indexOf("function syncUseTradeVinButton()"));
  assert.match(sync, /vin\.length === CONFIG_VIN_LENGTH && vin !== current/);
});

// The consent notice must stay verbatim, but it does not need a screen to say
// it: the operative sentence stays visible and the rest is one click away.
test("the consent notice is collapsible without losing a word", () => {
  assert.match(sidepanelHtml, /<details id="dataUseDetails"/);
  assert.match(sidepanelHtml, /<summary><span>Privacy<\/span>/);
  for (const phrase of [
    "OFAC stays on this computer",
    "Submitted customer fields and completed reports",
    "Running a check means you agree",
  ]) {
    assert.ok(sidepanelHtml.includes(phrase), `the disclosure must keep "${phrase}"`);
  }
});

// The quote used to state a total with no way to say what it buys. The state
// prints "Registration Period: 8 months" and "Expiration Date: 14-Mar-2027" on
// the result page — the expiry falls on the owner's birthday.
test("the quote carries how long the plate runs and when it lapses", () => {
  const quote = normalizeSosFeeQuote({
    ...verifiedResult().quote,
    mode: SOS_QUOTE_MODE.newPlate,
    source: SOS_QUOTE_SOURCE.calculated,
    registrationMonths: 8,
    expiresOn: "2027-03-14",
  });
  assert.equal(quote.registrationMonths, 8);
  assert.equal(quote.expiresOn, "2027-03-14");
  assert.match(registrationTermText(quote), /8 months/);
  assert.match(registrationTermText(quote), /expires Mar 14, 2027/);
});

test("an unusable term is dropped rather than shown", () => {
  // A fee that reconciled is still a valid quote, but a wrong expiry date on a
  // customer's paperwork is worse than no date at all.
  for (const bad of [
    { registrationMonths: 0, expiresOn: "2027-13-99" },
    { registrationMonths: 99, expiresOn: "not-a-date" },
    { registrationMonths: null, expiresOn: null },
  ]) {
    const quote = normalizeSosFeeQuote({
      ...verifiedResult().quote,
      mode: SOS_QUOTE_MODE.newPlate,
      source: SOS_QUOTE_SOURCE.calculated,
      ...bad,
    });
    assert.equal(quote.registrationMonths, null);
    assert.equal(registrationTermText(quote), "");
  }
});

// The total and what it buys lead; the itemised add-ons stay below as reference.
test("the total and term lead the result", () => {
  assert.match(sidepanelHtml, /id="sosQuoteHeadline"/);
  assert.match(sidepanelHtml, /id="sosQuoteTotal"/);
  assert.match(sidepanelHtml, /id="sosQuoteTerm"/);
  assert.match(sidepanelScript, /registrationTermText\(quote\)/);
  // The headline must sit above the fee add-ons in the document.
  assert.ok(
    sidepanelHtml.indexOf('id="sosQuoteHeadline"') <
      sidepanelHtml.indexOf("Michigan fee add-ons"),
    "the total and term must come before the fee glossary"
  );
});

// The customer worksheet described the vehicle without the MSRP the fee is
// calculated from, showed no picture of the plate being bought, and stated a
// $15 title fee that omits Michigan's $1 lien recording fee.
test("the customer worksheet states the MSRP, the plate and the real title fee", () => {
  const quote = createCalculatedQuote(
    {
      calculationMode: SOS_QUOTE_MODE.newPlate,
      feeCents: 19500,
      feeBreakdown: [{ label: "MSRP Based Reg Fee", feeCents: 19500 }],
      vehicleDescription: "2025 · Car/Mini-Van/SUV · 4 Door",
      platePreviewUrl: "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.PAS.PM",
      recreationPassport: false,
      registrationMonths: 8,
      expiresOn: "2027-03-14",
      calculatedAt: "2026-08-17T12:00:00.000Z",
    },
    SOS_QUOTE_MODE.newPlate,
    new Date(),
    { msrpCents: 4250000 }
  );
  assert.equal(quote.msrpCents, 4250000);

  const html = createSosFeeQuotePrintHTML(quote, { dealerName: "Bob Maxey Ford of Howell" });
  assert.match(html, /Vehicle base MSRP/);
  assert.match(html, /\$42,500\.00/);
  // The plate the customer is actually getting.
  assert.match(html, /<img src="https:\/\/dsvsesvc\.sos\.state\.mi\.us[^"]*"/);
  // $15 title + $1 lien recording = $16, itemised rather than implied.
  assert.match(html, /Michigan lien recording fee/);
  assert.match(html, /<td>\$16\.00<\/td>/);
  // The SOS breakdown is still itemised above its own total.
  assert.match(html, /MSRP Based Reg Fee/);
  assert.match(html, /8 months/);
  assert.match(html, /Bob Maxey Ford of Howell/);
});

test("an MSRP that is not a sane amount never reaches the sheet", () => {
  for (const bad of [0, -1, 99_999_901, 1.5, null]) {
    const quote = createCalculatedQuote(
      {
        calculationMode: SOS_QUOTE_MODE.newPlate,
        feeCents: 19500,
        feeBreakdown: [{ label: "MSRP Based Reg Fee", feeCents: 19500 }],
        calculatedAt: "2026-08-17T12:00:00.000Z",
      },
      SOS_QUOTE_MODE.newPlate,
      new Date(),
      { msrpCents: bad }
    );
    assert.equal(quote.msrpCents, null);
    assert.doesNotMatch(createSosFeeQuotePrintHTML(quote), /Vehicle base MSRP/);
  }
});

// The glossary annotates the result, so it belongs after it.
test("the fee add-ons sit below the result they annotate", () => {
  assert.ok(
    sidepanelHtml.indexOf('id="sosQuoteHeadline"') <
      sidepanelHtml.indexOf("Michigan fee add-ons"),
    "the total and term must precede the fee glossary"
  );
  assert.ok(
    sidepanelHtml.indexOf('id="sosQuoteStatus"') <
      sidepanelHtml.indexOf("Michigan fee add-ons"),
    "the breakdown summary must precede the fee glossary"
  );
});

// The dealership mark is drawn on a sheet handed to a customer, so only an
// image we ship or inline ourselves may appear on it — never a remote fetch.
test("only our own image can be printed as the dealership logo", () => {
  const inlined = "data:image/webp;base64,UklGRh4AAABXRUJQ";
  assert.equal(sanitizeDealerLogo(inlined), inlined);
  assert.equal(
    sanitizeDealerLogo("chrome-extension://abcdef/assets/dealer-logo.webp"),
    "chrome-extension://abcdef/assets/dealer-logo.webp"
  );
  for (const bad of [
    "https://example.com/logo.png",
    "javascript:alert(1)",
    "chrome-extension://abcdef/../manifest.json",
    "data:text/html;base64,PHNjcmlwdD4=",
    "",
    null,
  ]) {
    assert.equal(sanitizeDealerLogo(bad), "", `${bad} must be refused`);
  }
});

test("the worksheet prints the logo, and reads without one", () => {
  const quote = createCalculatedQuote(
    {
      calculationMode: SOS_QUOTE_MODE.newPlate,
      feeCents: 19500,
      feeBreakdown: [{ label: "MSRP Based Reg Fee", feeCents: 19500 }],
      calculatedAt: "2026-08-17T12:00:00.000Z",
    },
    SOS_QUOTE_MODE.newPlate
  );
  const withLogo = createSosFeeQuotePrintHTML(quote, {
    dealerName: "Bob Maxey Ford of Howell",
    logoUrl: "data:image/webp;base64,UklGRh4AAABXRUJQ",
  });
  assert.match(withLogo, /<img src="data:image\/webp;base64,[^"]+" alt="Bob Maxey Ford of Howell"/);

  // A logo that could not be loaded must never block the quote from printing.
  const without = createSosFeeQuotePrintHTML(quote, { dealerName: "Bob Maxey Ford of Howell" });
  assert.doesNotMatch(without, /<img src="data:/);
  assert.match(without, /Bob Maxey Ford of Howell/);
});

test("the dealership is a per-install setting, not compiled in", () => {
  assert.match(packageScript, /src lib ofac assets/);

  // A publicly listed extension must not hand every installer a worksheet
  // branded for one specific dealership — that misrepresents the store and
  // carries its manufacturer's trade dress.
  assert.doesNotMatch(
    sidepanelScript,
    /const DEALER_NAME\s*=/,
    "the dealership name must come from settings, not a constant"
  );
  assert.doesNotMatch(
    sidepanelScript,
    /assets\/dealer-logo/,
    "no dealership logo may ship inside the package"
  );

  // Both values are read from local storage at print time.
  assert.match(sidepanelScript, /STORAGE_KEYS\.dealershipName/);
  assert.match(sidepanelScript, /STORAGE_KEYS\.dealershipLogo/);

  // An uploaded logo is validated before it is stored or printed.
  assert.match(sidepanelScript, /sanitizeDealerLogo\(dataUrl\)/);
  assert.match(sidepanelScript, /MAX_DEALER_LOGO_BYTES/);

  // A failed storage write must never announce success (or surface as an
  // unhandled rejection): the name save is awaited, and both the save and the
  // logo removal report their own failure instead of pretending it worked.
  assert.match(
    sidepanelScript,
    /await chrome\.storage\.local\.set\(\{ \[STORAGE_KEYS\.dealershipName\]: name \}\)/,
    "the dealership-name write must be awaited so failure is observable"
  );
  assert.match(sidepanelScript, /The dealership name could not be saved\./);
  assert.match(sidepanelScript, /The dealership logo could not be removed\./);
});

test("a worksheet prints correctly with no dealership configured", () => {
  const quote = createCalculatedQuote(
    {
      calculationMode: SOS_QUOTE_MODE.newPlate,
      feeCents: 19500,
      feeBreakdown: [{ label: "MSRP Based Reg Fee", feeCents: 19500 }],
      vehicleDescription: "2025 · Car/Mini-Van/SUV · 4 Door",
      recreationPassport: false,
      calculatedAt: "2026-08-18T12:00:00.000Z",
    },
    SOS_QUOTE_MODE.newPlate,
    new Date(),
    {}
  );
  // Blank name, no logo — the sheet must still render, without an empty header.
  const html = createSosFeeQuotePrintHTML(quote, { dealerName: "", logoUrl: "" });
  assert.ok(html, "a worksheet must print before a dealership is configured");
  assert.doesNotMatch(html, /<img[^>]*class="worksheet-logo"/);
  assert.match(html, /Customer Registration Cost Summary/);
});

// The status was a line of muted grey text at 0.66rem, and its error and busy
// colours were left over from the dark panel — #fecaca at 1.45:1 and #7dd3fc at
// 1.67:1 on a white card — so a failure mid-quote read exactly like the idle
// prompt sitting in the same place.
test("the workspace status reads as the state it is in", () => {
  assert.match(sidepanelHtml, /id="sosWorkspaceStatus"/);
  assert.match(sidepanelHtml, /id="sosWorkspaceStatusText"/);
  assert.match(sidepanelHtml, /class="sos-status-bar"/);
  // The old low-contrast tones must not come back.
  assert.doesNotMatch(sidepanelCss, /\.sos-workspace-status\.is-error \{ color: #fecaca/);
  assert.doesNotMatch(sidepanelCss, /\.sos-workspace-status\.is-busy \{ color: #7dd3fc/);
  // A quote takes ten seconds or more, so the busy state moves.
  assert.match(sidepanelCss, /\.sos-workspace-status\.is-busy \.sos-status-bar \{ display: block/);
  assert.match(sidepanelCss, /@keyframes sosStatusSlide/);
  assert.match(sidepanelCss, /prefers-reduced-motion: reduce/);
  // A failure is the one state that must interrupt rather than wait to be read.
  assert.match(sidepanelScript, /if \(tone === "error"\) host\.setAttribute\("role", "alert"\)/);
});

// Left as a state URL the plate simply did not appear: the print window opens
// before a remote image can load, so the customer got a broken frame.
test("the printed plate is inlined rather than fetched", () => {
  assert.match(sidepanelScript, /function loadPlateImageForPrint\(quote\)/);
  assert.match(sidepanelScript, /plateImageUrl/);
  // The dialog must not open before the images are on the page.
  const print = sidepanelScript.slice(sidepanelScript.indexOf("async function printSosFeeQuote()"));
  assert.match(print.slice(0, 900), /printHtmlDocument\(html, \{ waitForImages: true \}\)/);
  // An inlined plate is accepted by the sheet, a remote one is not smuggled in.
  const quote = createCalculatedQuote(
    {
      calculationMode: SOS_QUOTE_MODE.newPlate,
      feeCents: 19500,
      feeBreakdown: [{ label: "MSRP Based Reg Fee", feeCents: 19500 }],
      calculatedAt: "2026-08-17T12:00:00.000Z",
    },
    SOS_QUOTE_MODE.newPlate
  );
  const html = createSosFeeQuotePrintHTML(quote, {
    plateImageUrl: "data:image/webp;base64,UklGRh4AAABXRUJQ",
  });
  assert.match(html, /alt="Selected Michigan plate design"/);
  assert.doesNotMatch(
    createSosFeeQuotePrintHTML(quote, { plateImageUrl: "https://evil.example/p.png" }),
    /evil\.example/
  );
});

// Re-screening was the entire point of the aging badge, but it took four steps:
// open the record, switch tab, find the button, run. And a single record could
// only be removed by clearing every record — the worker already supported
// removing one entry, nothing exposed it.
test("every history row action carries an id the worker will accept", async () => {
  // This test used to assert that the source contained
  //   data-audit="${sanitizeHTML(item.id || item.reference || "")}"
  // which is exactly the bug: item.id is a numeric timestamp and
  // item.reference is CC-YYYYMMDD-NNNNNN, but the worker only accepts an
  // auditId matching /^(?:run|operation|legacy):/. Delete therefore failed for
  // every record, and the source-text assertion held the defect in place
  // instead of catching it. Render the real markup and check the ids against
  // the real validator instead.
  const { retainAuditHistory, isValidHistoryAuditId } = await import(
    "../lib/history-retention.js"
  );
  const { populateHistoryModal } = await import("../src/sidepanel/history.js");

  const stored = retainAuditHistory([
    {
      id: Date.now(),
      reference: "CC-20260818-113802",
      runId: "abc123def456",
      timestamp: Date.now(),
      decision: "APPROVED",
      runType: "full",
      customerName: "Marcus Delaney",
      checks: { ofac: "clear", repeatOffender: "eligible", title: "clear" },
    },
    {
      id: Date.now() - 1000,
      reference: "CC-20260817-090000",
      operationId: "op789",
      timestamp: Date.now() - 86_400_000,
      decision: "REVIEW",
      runType: "individual",
      runLabel: "OFAC only",
      customerName: "Dana Whitfield",
      checks: { ofac: "potential_match" },
    },
  ]);

  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: { local: { get: async () => ({ complianceHistory: stored }) } },
  };

  let html = "";
  try {
    await populateHistoryModal({
      set innerHTML(value) {
        html = value;
      },
      get innerHTML() {
        return html;
      },
    });
  } finally {
    globalThis.chrome = previousChrome;
  }

  const emitted = [...html.matchAll(/data-audit="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(emitted.length > 0, "history rows should carry audit ids");

  // Every id the UI emits must be one the worker's validator accepts, and must
  // name a record that actually exists.
  const known = new Set(stored.map((entry) => entry.auditId));
  for (const id of emitted) {
    assert.ok(
      isValidHistoryAuditId(id),
      `REMOVE_HISTORY_ENTRY would reject "${id}"`
    );
    assert.ok(known.has(id), `"${id}" does not match a stored record`);
  }

  // Positional addressing is what let a background save re-sort storage under
  // a rendered row and resolve a click to a different customer.
  assert.doesNotMatch(html, /data-index=/);

  assert.match(html, /history-rescreen-btn/);
  assert.match(html, /history-delete-btn/);
  // Re-screen only applies to a full run; a partial check has nothing to re-run.
  assert.equal((html.match(/history-rescreen-btn/g) || []).length, 1);

  assert.match(sidepanelScript, /type: "REMOVE_HISTORY_ENTRY"/);
  // The click handler must resolve the record by id, not by list position.
  assert.match(sidepanelScript, /record\?\.auditId === auditId/);
  assert.match(sidepanelScript, /Delete this one saved record\?/);
  assert.match(sidepanelScript, /Other records are kept/);
});
