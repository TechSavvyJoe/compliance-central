import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { STORAGE_KEYS } from "../lib/storage-keys.js";
import {
  SOS_CALCULATOR_URLS,
  SOS_QUOTE_MODE,
  SOS_QUOTE_SOURCE,
  createCalculatedQuote,
  createManualQuote,
  createSosFeeQuotePrintHTML,
  dollarsToCents,
  normalizeSosFeeQuote,
  sanitizePlatePreviewUrl,
  sanitizeVehicleDescription,
} from "../src/sidepanel/sos-fee-quote.js";
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
const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8")
);

function officialCalculator(mode = SOS_QUOTE_MODE.newPlate, fields = []) {
  return {
    calculationMode: mode,
    fields,
    platePreviewUrl: "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.PAS.WA.jpg",
  };
}

function runnerHarness({ discovery, update, calculation, active = false } = {}) {
  const state = {};
  const created = [];
  const removed = [];
  const messages = [];
  const chromeApi = {
    storage: {
      session: {
        async set(values) {
          Object.assign(state, values);
        },
        async get(key) {
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map((item) => [item, state[item]]));
          }
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
      async sendMessage(tabId, message) {
        messages.push({ tabId, message });
        if (message.type === SOS_FEE_MESSAGES.discover) return discovery;
        if (message.type === SOS_FEE_MESSAGES.applyField) return update;
        if (message.type === SOS_FEE_MESSAGES.calculateInTab) return calculation;
        return { success: false };
      },
    },
  };
  return {
    state,
    created,
    removed,
    messages,
    runner: createSosFeeRunner(chromeApi, { sleep: async () => {} }),
  };
}

test("background SOS runner keeps the official tab inactive, returns sidebar data, and closes it", async () => {
  const fields = [
    {
      id: "Dd-i",
      label: "Select your vehicle type",
      kind: "select",
      value: "UtilityTruck",
      options: [{ value: "UtilityTruck", label: "Utility Truck" }],
    },
    {
      id: "Dd-l",
      label: "Select your fuel type",
      kind: "select",
      value: "DIESEL",
      options: [{ value: "DIESEL", label: "Diesel" }],
    },
    {
      id: "Dd-k",
      label: "Select how you will use your vehicle",
      kind: "select",
      value: "COM",
      options: [{ value: "COM", label: "Regular/Commercial" }],
    },
  ];
  const calculator = officialCalculator(SOS_QUOTE_MODE.newPlate, fields);
  const harness = runnerHarness({
    discovery: { success: true, calculator },
    update: { success: true, calculator },
    calculation: {
      success: true,
      quote: {
        calculationMode: SOS_QUOTE_MODE.newPlate,
        feeCents: 20500,
        vehicleDescription: "2025 · Utility Truck · Regular/Commercial",
        platePreviewUrl: calculator.platePreviewUrl,
        recreationPassport: false,
        calculatedAt: "2026-08-14T12:00:00.000Z",
      },
    },
  });

  const start = await harness.runner.start(SOS_QUOTE_MODE.newPlate);
  assert.equal(start.success, true);
  assert.deepEqual(harness.created, [
    { url: SOS_CALCULATOR_URLS[SOS_QUOTE_MODE.newPlate], active: false },
  ]);
  assert.equal(harness.state[STORAGE_KEYS.sosFeeActiveTabId], 401);
  assert.equal(start.calculator.fields[0].options[0].label, "Utility Truck");
  assert.equal(
    start.calculator.fields.find((field) => field.id === "Dd-k").options[0].label,
    "Regular/Commercial"
  );

  const update = await harness.runner.updateField(SOS_QUOTE_MODE.newPlate, {
    fieldId: "Dd-l",
    value: "DIESEL",
  });
  assert.equal(update.success, true);
  assert.equal(harness.messages.at(-1).message.type, SOS_FEE_MESSAGES.applyField);

  const result = await harness.runner.calculate(SOS_QUOTE_MODE.newPlate);
  assert.equal(result.success, true);
  assert.equal(result.quote.feeCents, 20500);
  assert.equal(result.quote.platePreviewUrl, calculator.platePreviewUrl);
  assert.deepEqual(harness.removed, [401]);
  assert.equal(harness.state[STORAGE_KEYS.sosFeeActiveTabId], undefined);
});

test("SOS runner keeps validation inside the sidebar and closes unrecoverable failures", async () => {
  const calculator = officialCalculator(SOS_QUOTE_MODE.plateTransfer);
  const validationHarness = runnerHarness({
    discovery: { success: true, calculator },
    update: { success: true, calculator },
    calculation: {
      success: false,
      keepOpen: true,
      error: "Michigan SOS needs more information before it can calculate this fee.",
      calculator,
    },
  });
  await validationHarness.runner.start(SOS_QUOTE_MODE.plateTransfer);
  const validation = await validationHarness.runner.calculate(SOS_QUOTE_MODE.plateTransfer);
  assert.equal(validation.success, false);
  assert.equal(validation.keepOpen, true);
  assert.deepEqual(validationHarness.removed, []);
  await validationHarness.runner.close();
  assert.deepEqual(validationHarness.removed, [401]);

  const failureHarness = runnerHarness({
    discovery: { success: false, error: "Unexpected SOS page" },
  });
  const failure = await failureHarness.runner.start(SOS_QUOTE_MODE.newPlate);
  assert.equal(failure.success, false);
  assert.match(failure.error, /No SOS page was shown/i);
  assert.deepEqual(failureHarness.removed, [401]);
});

test("SOS runner fails closed if Chrome tries to foreground its calculator tab", async () => {
  const harness = runnerHarness({
    discovery: { success: true, calculator: officialCalculator() },
    active: true,
  });
  const response = await harness.runner.start(SOS_QUOTE_MODE.newPlate);
  assert.equal(response.success, false);
  assert.match(response.error, /background/i);
  assert.deepEqual(harness.removed, [401]);
  assert.equal(harness.messages.length, 0);
});

test("an interrupted session closes only the extension-owned background SOS tab", async () => {
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

test("official quote model carries only the verified result and a safe plate image", () => {
  const quote = createCalculatedQuote(
    {
      calculationMode: SOS_QUOTE_MODE.newPlate,
      feeCents: 12600,
      vehicleDescription: "2026 EV SUV VIN: 1FMDE8AP9RLA12345",
      platePreviewUrl:
        "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.PAS.WA.jpg?private=1",
      recreationPassport: true,
      calculatedAt: "2026-08-14T12:00:00.000Z",
    },
    SOS_QUOTE_MODE.newPlate
  );
  assert.equal(quote.source, SOS_QUOTE_SOURCE.calculated);
  assert.equal(quote.vehicleDescription, "2026 EV SUV");
  assert.equal(
    quote.platePreviewUrl,
    "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.PAS.WA.jpg"
  );
  assert.equal(quote.recreationPassport, true);
  assert.equal(
    createCalculatedQuote({ calculationMode: SOS_QUOTE_MODE.plateTransfer, feeCents: 2500 }, SOS_QUOTE_MODE.newPlate),
    null
  );
  assert.equal(dollarsToCents("1,234.50"), 123450);
  assert.equal(dollarsToCents("-20"), null);
  assert.equal(sanitizeVehicleDescription("VIN: 1FMDE8AP9RLA12345 2026 Explorer"), "2026 Explorer");
  assert.equal(
    sanitizeVehicleDescription("2026 Explorer VIN: 5UXWX7C5*BA"),
    "2026 Explorer"
  );
  assert.equal(
    sanitizePlatePreviewUrl("https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.QuestionPlate"),
    null
  );
  assert.equal(
    normalizeSosFeeQuote({
      mode: SOS_QUOTE_MODE.newPlate,
      source: SOS_QUOTE_SOURCE.calculated,
      feeCents: 2500,
      calculatedAt: "not a timestamp",
    }),
    null
  );
});

test("customer output makes manual fallback visibly unverified and never prints a VIN", () => {
  const calculated = createCalculatedQuote(
    {
      calculationMode: SOS_QUOTE_MODE.newPlate,
      feeCents: 12600,
      vehicleDescription: "2026 Explorer VIN: 1FMDE8AP9RLA12345",
      recreationPassport: true,
      calculatedAt: "2026-08-14T12:00:00.000Z",
    },
    SOS_QUOTE_MODE.newPlate
  );
  const html = createSosFeeQuotePrintHTML(calculated);
  assert.match(html, /Calculated by SOS/);
  assert.match(html, /protected background browser tab/);
  assert.match(html, /Selected — included in the SOS calculation/);
  assert.match(html, /\$126\.00/);
  assert.doesNotMatch(html, /1FMDE8AP9RLA12345/);

  const manual = createManualQuote(
    { mode: SOS_QUOTE_MODE.plateTransfer, amount: "15.00", vehicleDescription: "" },
    new Date("2026-08-14T12:00:00.000Z")
  );
  const manualHtml = createSosFeeQuotePrintHTML(manual);
  assert.match(manualHtml, /Salesperson-entered — unverified/);
  assert.match(manualHtml, /not verified by the Michigan SOS calculator/i);
});

test("optional NHTSA VIN lookup accepts partial VINs but never returns the raw VIN", async () => {
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
  assert.equal(decoded.partial, true);
  assert.equal(vinLookupSummary(decoded), "2011 BMW X3");
  assert.doesNotMatch(JSON.stringify(decoded), /5UXWX7C5\*BA/);
  assert.match(requested[0].url, /DecodeVinValuesExtended\/5UXWX7C5%2ABA/);
  assert.equal(requested[0].options.credentials, "omit");
  assert.equal(normalizeVinLookupInput(" 5ux-wx7c5*ba "), "5UXWX7C5*BA");
  assert.equal(normalizeVinLookupInput("ABCDEFG"), null);
});

test("VIN suggestions use only live SOS options and cover EV, hybrid, plug-in hybrid, diesel, and Gas", () => {
  const fields = [
    {
      id: "vehicle",
      label: "Select your vehicle type",
      disabled: false,
      options: [
        { value: "Passenger", label: "Car/Mini-Van/SUV" },
        { value: "Pickup", label: "Pick-Up Truck" },
        { value: "UtilityTruck", label: "Utility Truck" },
      ],
    },
    {
      id: "body",
      label: "Select the body style",
      disabled: false,
      options: [
        { value: "2D", label: "2 Door" },
        { value: "4D", label: "4 Door" },
      ],
    },
    {
      id: "fuel",
      label: "Select your fuel type",
      disabled: false,
      options: [
        { value: "GAS", label: "Gas" },
        { value: "DIESEL", label: "Diesel" },
        { value: "ELECTR", label: "Electric" },
        { value: "HEV", label: "Electric & Gas Hybrid" },
        { value: "PHEV", label: "Plug in Hybrid Electric" },
      ],
    },
    { id: "year", label: "Enter the vehicle model year", disabled: false },
  ];
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
    makeSosVinSuggestions(decoded, fields).find((suggestion) => suggestion.fieldId === "fuel")
      ?.value;
  assert.equal(fuel(base), "GAS");
  assert.equal(fuel({ ...base, fuelTypePrimary: "Diesel" }), "DIESEL");
  assert.equal(fuel({ ...base, fuelTypePrimary: "Electric" }), "ELECTR");
  assert.equal(fuel({ ...base, electrificationLevel: "Hybrid Electric Vehicle (HEV)" }), "HEV");
  assert.equal(
    fuel({ ...base, electrificationLevel: "Plug-in Hybrid Electric Vehicle (PHEV)" }),
    "PHEV"
  );
  const commercial = makeSosVinSuggestions(
    { ...base, vehicleType: "TRUCK", bodyClass: "Pickup", doors: "2" },
    fields
  );
  assert.deepEqual(
    commercial.find((suggestion) => suggestion.fieldId === "vehicle"),
    { fieldId: "vehicle", value: "Pickup" }
  );
  assert.equal(
    makeSosVinSuggestions({ ...base, fuelTypePrimary: "Hydrogen" }, fields).some(
      (suggestion) => suggestion.fieldId === "fuel"
    ),
    false
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

test("extension UI and adapters enforce sidebar-only, session-only behavior", () => {
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.host_permissions.includes("https://dsvsesvc.sos.state.mi.us/*"));
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://dsvsesvc.sos.state.mi.us/TAP/_/*",
  ]);
  assert.ok(manifest.host_permissions.includes("https://vpic.nhtsa.dot.gov/*"));
  assert.match(manifest.content_security_policy.extension_pages, /dsvsesvc\.sos\.state\.mi\.us/);
  assert.match(runnerScript, /active:\s*false/);
  assert.doesNotMatch(sidepanelScript, /chrome\.tabs\.(?:create|update|query)/);
  assert.doesNotMatch(sidepanelHtml, /Open public SOS calculator|Capture official fee|Print official SOS page/);
  for (const id of [
    "startSosFeeWorkspaceBtn",
    "calculateSosFeeBtn",
    "sosOfficialFields",
    "sosPlatePreview",
    "lookupSosVinBtn",
    "checkSosLienBtn",
    "printSosQuoteBtn",
  ]) {
    assert.match(sidepanelHtml, new RegExp(`id="${id}"`));
  }
  assert.match(sidepanelHtml, /Commercial use, fuel, plate type, and plate design/i);
  assert.match(sidepanelHtml, /no SOS sign-in or visible SOS page/i);
  assert.match(sidepanelHtml, /electric, hybrid, plug-in hybrid, diesel/i);
  assert.match(sidepanelHtml, /aria-labelledby="sosQuoteTitle"/);
  assert.match(sidepanelHtml, /<label class="visually-hidden" for="sosVinLookupInput">VIN or partial VIN<\/label>/);
  assert.match(sidepanelHtml, /id="sosLienStatus" class="sos-lien-status" role="status" aria-live="polite"/);
  assert.doesNotMatch(contentScript, /document\.cookie|chrome\.storage|localStorage|sessionStorage|window\.print/);
  assert.doesNotMatch(runnerScript, /storage\.local/);
  assert.doesNotMatch(sidepanelScript, /SOS_CAPTURE_FEE_QUOTE|SOS_PRINT_CURRENT_PAGE/);
  assert.match(contentScript, /SOS_DISCOVER_CALCULATOR/);
  assert.match(contentScript, /SOS_CALCULATE_IN_TAB/);
});
