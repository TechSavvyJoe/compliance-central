import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { STORAGE_KEYS } from "../lib/storage-keys.js";
import {
  SOS_CALCULATOR_URLS,
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
  closeInterruptedSosFeeSession,
  createSosFeeRunner,
  validSosSubmissionFields,
} from "../src/worker/sos-fee-runner.js";
import { __test as sosLienCheckTest } from "../src/worker/sos-lien-check.js";

const contentScript = readFileSync(
  new URL("../sos-fee-quote-content.js", import.meta.url),
  "utf8"
);
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

function runnerHarness({ responses = [], active = false } = {}) {
  const state = {};
  const created = [];
  const removed = [];
  const updated = [];
  const messages = [];
  const queue = [...responses];
  const chromeApi = {
    storage: {
      session: {
        async set(values) {
          Object.assign(state, values);
        },
        async get(key) {
          return { [key]: state[key] };
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
        },
      },
    },
    tabs: {
      async create(options) {
        created.push(options);
        return { id: 401, active };
      },
      async remove(tabId) {
        removed.push(tabId);
      },
      async update(tabId, options) {
        updated.push({ tabId, options });
        return { id: tabId, ...options };
      },
      async sendMessage(tabId, message) {
        messages.push({ tabId, message });
        return queue.shift() || { success: false, keepOpen: true };
      },
    },
  };
  return {
    state,
    created,
    removed,
    updated,
    messages,
    runner: createSosFeeRunner(chromeApi, { sleep: async () => {} }),
  };
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
  assert.match(sidepanelHtml, /Plate purchase date <span>Important · today if blank<\/span>/);
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

test("background runner creates one inactive tab only on Calculate and closes on success", async () => {
  const fields = buildSosSubmission(newPlateValues());
  const harness = runnerHarness({ responses: [verifiedResult()] });
  const response = await harness.runner.calculate(SOS_QUOTE_MODE.newPlate, fields);
  assert.equal(response.success, true);
  assert.deepEqual(harness.created, [
    { url: SOS_CALCULATOR_URLS[SOS_QUOTE_MODE.newPlate], active: false },
  ]);
  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].message.type, SOS_FEE_MESSAGES.applyAndCalculate);
  assert.deepEqual(harness.messages[0].message.data.fields, fields);
  assert.deepEqual(harness.removed, [401]);
  assert.equal(harness.state[STORAGE_KEYS.sosFeeActiveTabId], undefined);
});

test("three failed attempts stay in sidebar until explicit prefilled handoff", async () => {
  const fields = buildSosSubmission(newPlateValues());
  const harness = runnerHarness({
    responses: [
      { success: false, keepOpen: true },
      { success: false, keepOpen: true },
      { success: false, keepOpen: true },
    ],
  });
  const response = await harness.runner.calculate(SOS_QUOTE_MODE.newPlate, fields);
  assert.equal(response.success, false);
  assert.equal(response.handoffAvailable, true);
  assert.equal(response.attempts, 3);
  assert.match(response.error, /completed choices remain/i);
  assert.equal(harness.messages.length, 3);
  assert.deepEqual(harness.removed, []);
  assert.equal(harness.state[STORAGE_KEYS.sosFeeActiveTabId], 401);

  const handoff = await harness.runner.openHandoff(SOS_QUOTE_MODE.newPlate);
  assert.equal(handoff.success, true);
  assert.deepEqual(harness.updated, [{ tabId: 401, options: { active: true } }]);
  assert.deepEqual(harness.removed, []);
  assert.equal(harness.state[STORAGE_KEYS.sosFeeActiveTabId], undefined);
});

test("runner fails closed if Chrome tries to foreground the automatic calculator", async () => {
  const harness = runnerHarness({ active: true });
  const response = await harness.runner.calculate(
    SOS_QUOTE_MODE.newPlate,
    buildSosSubmission(newPlateValues())
  );
  assert.equal(response.success, false);
  assert.match(response.error, /background/i);
  assert.deepEqual(harness.removed, [401]);
  assert.equal(harness.messages.length, 0);
});

test("interrupted session closes only its recorded extension-owned tab", async () => {
  const state = { [STORAGE_KEYS.sosFeeActiveTabId]: 812 };
  const removed = [];
  await closeInterruptedSosFeeSession({
    storage: {
      session: {
        async get(key) {
          return { [key]: state[key] };
        },
        async remove(key) {
          delete state[key];
        },
      },
    },
    tabs: {
      async remove(tabId) {
        removed.push(tabId);
      },
    },
  });
  assert.deepEqual(removed, [812]);
  assert.equal(state[STORAGE_KEYS.sosFeeActiveTabId], undefined);
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
  assert.match(html, /protected background browser tab/);
  assert.match(html, /Selected — included in the SOS calculation/);
  assert.match(html, /\$126\.00/);
  assert.doesNotMatch(html, /1FMDE8AP9RLA12345/);
  const evidenceHtml = createSosOfficialEvidencePrintHTML(quote);
  assert.match(evidenceHtml, /Actual official state-site result page/);
  assert.match(evidenceHtml, /letter landscape/);
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

test("UI and adapters enforce local edits, explicit handoff, and session-only data", () => {
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.host_permissions.includes("https://dsvsesvc.sos.state.mi.us/*"));
  assert.ok(manifest.host_permissions.includes("https://vpic.nhtsa.dot.gov/*"));
  assert.match(runnerScript, /active:\s*false/);
  assert.doesNotMatch(sidepanelScript, /chrome\.tabs\.(?:create|update|query)/);
  assert.doesNotMatch(sidepanelHtml, /Fallback: enter a fee manually|Load official choices/);
  assert.doesNotMatch(sidepanelScript, /SOS_FEE_UPDATE_FIELD|SOS_FEE_START/);
  for (const id of [
    "calculateSosFeeBtn",
    "sosVehicleType",
    "sosFuelType",
    "sosPlateType",
    "sosPlateDesign",
    "sosPlatePreview",
    "lookupSosVinBtn",
    "sosHandoffPanel",
    "openSosHandoffBtn",
    "printSosQuoteBtn",
    "printSosCalculationBtn",
    "downloadSosCalculationPdfBtn",
  ]) {
    assert.match(sidepanelHtml, new RegExp(`id="${id}"`));
  }
  assert.match(sidepanelScript, /type:\s*"SOS_FEE_CALCULATE"/);
  assert.match(sidepanelScript, /fields:\s*buildSosSubmission\(values\)/);
  assert.match(sidepanelScript, /applyPendingVinSuggestions\(\)/);
  assert.match(sidepanelHtml, /Auto-fill by vehicle VIN/);
  assert.match(sidepanelHtml, /Trade Title\/Lien stays in the Trade-In section above/);
  assert.doesNotMatch(sidepanelHtml, /Use trade VIN|VIN assist \+ lien check/);
  assert.doesNotMatch(contentScript, /document\.cookie|chrome\.storage|localStorage|sessionStorage|window\.print/);
  assert.doesNotMatch(runnerScript, /storage\.local/);
  assert.match(contentScript, /SOS_APPLY_AND_CALCULATE/);
  assert.match(contentScript, /window\.html2canvas/);
  assert.equal(
    manifest.content_scripts[0].js[0],
    "lib/html2canvas.min.js"
  );
  assert.match(contentScript, /plate number\|\\bVIN\\b\|customer\|name/);
});
