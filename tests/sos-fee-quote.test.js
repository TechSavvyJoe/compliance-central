import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  // The field prefills to today, so "today if blank" no longer described the
  // behaviour; the note now says what the date actually does.
  assert.match(sidepanelHtml, /Plate purchase date <span>Changes the fee · defaults to today<\/span>/);
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
  // Run All Checks and Clear form must both live in that pinned row.
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
  assert.match(sosSource, /@page \{ size: letter portrait/);
  assert.doesNotMatch(sosSource, /size: letter landscape/);
  // Letter portrait content box at .3in margins is 10.4in tall.
  assert.match(sosSource, /\.page \{ height: 10\.4in/);

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
