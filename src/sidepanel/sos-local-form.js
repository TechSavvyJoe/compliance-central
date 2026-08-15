/**
 * Local, session-only Michigan SOS fee form.
 *
 * These values mirror the public calculator choices used by a franchised
 * new/used vehicle dealership. They make the side panel immediate; the
 * content-script adapter still verifies every semantic label and option
 * against the live SOS calculator when Calculate is clicked.
 */

import { SOS_QUOTE_MODE } from "./sos-fee-quote.js";

const SOS_PLATE_IMAGE_ROOT =
  "https://www.michigan.gov/sos/-/media/Project/Websites/sos/Vehicle/License-plate-images";

export const SOS_PLATE_DESIGNS = Object.freeze({
  pureMichigan: Object.freeze({
    value: "pure_michigan",
    label: "Pure Michigan",
    sosLabel: "Standard White",
    imageUrl: `${SOS_PLATE_IMAGE_ROOT}/Standard_PureMichigan.jpg?mw=768&rev=7d34d742a2654b28a629235f959fa5e8&hash=0B2EA17F2FF650FC8464D07C074FA926`,
  }),
  mackinacBridge: Object.freeze({
    value: "mackinac_bridge",
    label: "Mackinac Bridge",
    sosLabel: "Mackinac Bridge",
    imageUrl: `${SOS_PLATE_IMAGE_ROOT}/Standard_MacBridge.jpg?mw=768&rev=a9a336275c954f098a45fa080180d621&hash=B11CBC4C18A16DE56BB94F218BA8164C`,
  }),
  waterWinterWonderland: Object.freeze({
    value: "water_winter_wonderland",
    label: "Water-Winter Wonderland",
    sosLabel: "Water-Winter Wonderland",
    imageUrl: `${SOS_PLATE_IMAGE_ROOT}/Standard_WaterWinterWonderland.png?mw=768&rev=4ec3441ac8154aee98632aadf2f31559&hash=9E5344E36B1789CBF14E14A664EDE4F5`,
  }),
  waterWonderland: Object.freeze({
    value: "water_wonderland",
    label: "Water Wonderland",
    sosLabel: "Water Wonderland",
    imageUrl: `${SOS_PLATE_IMAGE_ROOT}/Standard_WaterWonderland.png?mw=768&rev=5d1d477b24fe41079f081b68961d4015&hash=185FEA739A4F41E0A5DB594CF4013A86`,
  }),
});

export const SOS_FUEL_OPTIONS = Object.freeze([
  ["GAS", "Gas"],
  ["DIESEL", "Diesel"],
  ["ELECTR", "Electric"],
  ["HYBEG", "Electric & Gas Hybrid"],
  ["PHEV", "Plug in Hybrid Electric"],
  ["HYBED", "Electric & Diesel Hybrid"],
  ["FLEX", "Flexible"],
  ["ALC", "Alcohol"],
  ["BUTANE", "Butane"],
  ["NATCG", "Compressed Natural Gas"],
  ["CONV", "Convertible"],
  ["ETH", "Ethanol"],
  ["FEV", "Fuel Cell Electric"],
  ["GASOIL", "Gas & Oil Mix"],
  ["NATG", "Liquid Natural Gas"],
  ["METHA", "Methanol"],
  ["OTHER", "Other"],
  ["PROPAN", "Propane"],
  ["UNKN", "Unknown"],
]);

export const SOS_VEHICLE_OPTIONS = Object.freeze([
  ["Passenger", "Car / Mini-Van / SUV"],
  ["Pickup", "Pick-Up Truck"],
  ["UtilityTruck", "Utility Truck"],
  ["Van", "Van"],
  ["StakeTruck", "Stake Truck"],
]);

const PASSENGER_BODY_OPTIONS = Object.freeze([
  ["4D", "4 Door"],
  ["2D", "2 Door"],
  ["CN", "Convertible"],
  ["SW", "Station Wagon"],
  ["RD", "Roadster"],
  ["LS", "Low Speed"],
  ["MT", "Motor Home"],
]);

const TRUCK_BODY_OPTIONS = Object.freeze([
  ["PU", "Pickup"],
  ["VA", "Van"],
  ["UT", "Utility"],
  ["ST", "Stake"],
  ["PN", "Panel"],
  ["IN", "Incomplete"],
  ["DM", "Dump"],
  ["WR", "Wrecker"],
  ["AM", "Ambulance"],
  ["HR", "Hearse"],
  ["MX", "Mixer"],
  ["SW", "Station Wagon"],
  ["TN", "Tank"],
  ["TT", "Tractor"],
]);

const PASSENGER_USE_OPTIONS = Object.freeze([
  ["PASS", "Regular / Non-Commercial"],
  ["COM", "Regular / Commercial"],
  ["TRANS", "Transport Passenger for Hire"],
  ["CHAR", "Charitable Corporation"],
  ["HIS", "Historical / Authentic"],
]);

const TRUCK_USE_OPTIONS = Object.freeze([
  ["PASS", "Regular / Non-Commercial"],
  ["COM", "Regular / Commercial"],
  ["GVW", "Standard GVW"],
  ["FARM", "Farm"],
  ["TRANS", "Transport Passenger for Hire"],
  ["COMT", "Commercial — Tow Mobile Home"],
  ["CARN", "Carnival / Moving Company"],
  ["CHAR", "Charitable Corporation"],
  ["HIS", "Historical / Authentic"],
  ["LOG", "Log"],
  ["MILK", "Milk"],
]);

const PASSENGER_PLATE_OPTIONS = Object.freeze([
  ["PAS", "Standard"],
  ["LCY", "Legacy"],
  ["SC", "Special Cause"],
  ["U", "University Fundraising"],
  ["VT", "Veteran"],
  ["ARO", "Amateur Radio Operator"],
  ["GLD", "Gold Star Family"],
  ["PSO", "Public Service Organization"],
  ["RFL", "Rental Fleet"],
  ["CONSUL", "Honorary Consul"],
]);

const COMMERCIAL_PLATE_OPTIONS = Object.freeze([
  ["COM", "Commercial"],
  ["PAS", "Standard"],
  ["FLT", "Fleet"],
  ["RFL", "Rental Fleet"],
  ["LCY", "Legacy"],
  ["SC", "Special Cause"],
  ["U", "University Fundraising"],
]);

export function bodyOptionsForVehicle(vehicleType) {
  return vehicleType === "Passenger" ? PASSENGER_BODY_OPTIONS : TRUCK_BODY_OPTIONS;
}

export function useOptionsForVehicle(vehicleType) {
  return vehicleType === "Passenger" ? PASSENGER_USE_OPTIONS : TRUCK_USE_OPTIONS;
}

export function plateOptionsForUse(vehicleUse) {
  return ["COM", "GVW", "COMT", "CARN", "LOG", "MILK"].includes(vehicleUse)
    ? COMMERCIAL_PLATE_OPTIONS
    : PASSENGER_PLATE_OPTIONS;
}

export function isCommercialUse(vehicleUse) {
  return ["COM", "GVW", "COMT", "CARN", "LOG", "MILK", "TRANS"].includes(
    vehicleUse
  );
}

export function plateDesignByValue(value) {
  return Object.values(SOS_PLATE_DESIGNS).find((design) => design.value === value) || null;
}

export function localSosVinFields(vehicleType = "Passenger") {
  return [
    {
      id: "sosVehicleType",
      label: "Select your vehicle type",
      disabled: false,
      options: SOS_VEHICLE_OPTIONS.map(([value, label]) => ({ value, label })),
    },
    {
      id: "sosBodyStyle",
      label: "Select the body style",
      disabled: false,
      options: bodyOptionsForVehicle(vehicleType).map(([value, label]) => ({ value, label })),
    },
    {
      id: "sosFuelType",
      label: "Select your fuel type",
      disabled: false,
      options: SOS_FUEL_OPTIONS.map(([value, label]) => ({ value, label })),
    },
    {
      id: "sosModelYear",
      label: "Enter the vehicle model year",
      disabled: false,
    },
  ];
}

function selectedLabel(options, value) {
  return options.find(([optionValue]) => optionValue === value)?.[1] || "";
}

function field(label, kind, values = {}) {
  return { label, kind, ...values };
}

export function buildSosSubmission(values) {
  const mode = values?.mode;
  if (mode === SOS_QUOTE_MODE.plateTransfer) {
    return [
      field("Enter the plate number being transferred", "text", {
        value: String(values.transferPlateNumber || "").trim().toUpperCase(),
      }),
    ];
  }

  const bodyOptions = bodyOptionsForVehicle(values.vehicleType);
  const useOptions = useOptionsForVehicle(values.vehicleType);
  const plateOptions = plateOptionsForUse(values.vehicleUse);
  const plateDesign = plateDesignByValue(values.plateDesign);
  const submission = [
    field("Select your vehicle type", "select", {
      optionValue: values.vehicleType,
      optionLabel: selectedLabel(SOS_VEHICLE_OPTIONS, values.vehicleType),
    }),
    field("Select the body style", "select", {
      optionValue: values.bodyStyle,
      optionLabel: selectedLabel(bodyOptions, values.bodyStyle),
    }),
    field("Select how you will use your vehicle", "select", {
      optionValue: values.vehicleUse,
      optionLabel: selectedLabel(useOptions, values.vehicleUse),
    }),
    field("Select your fuel type", "select", {
      optionValue: values.fuelType,
      optionLabel: selectedLabel(SOS_FUEL_OPTIONS, values.fuelType),
    }),
    field("Enter the vehicle model year", "text", { value: values.modelYear }),
    field("Is this vehicle being titled for the first time (no previous owner)?", "radio", {
      value: values.firstTitle === "yes" ? "Yes" : "No",
    }),
    field("Enter the vehicle MSRP", "text", { value: values.msrp }),
    field("Plate Type", "select", {
      optionValue: values.plateType,
      optionLabel: selectedLabel(plateOptions, values.plateType),
    }),
  ];

  if (values.plateType === "PAS" && plateDesign) {
    submission.push(
      field("Plate Background", "select", { optionLabel: plateDesign.sosLabel })
    );
  }
  if (isCommercialUse(values.vehicleUse)) {
    submission.push(
      field("Is this for a business?", "radio", {
        value: values.businessRegistration === "yes" ? "Yes" : "No",
      })
    );
  }
  submission.push(
    field("Would you like to personalize your plate?", "radio", {
      value: "No",
      optional: true,
      labelIncludes: "personalize your plate",
    }),
    field("Would you like to add a recreation passport?", "radio", {
      value: values.recreationPassport === "yes" ? "Yes" : "No",
      optional: true,
      labelIncludes: "recreation passport",
    })
  );
  if (String(values.purchaseDate || "").trim()) {
    submission.push(
      field("Enter the date you plan to purchase the plate", "text", {
        value: values.purchaseDate,
        optional: true,
        labelIncludes: "date you plan to purchase the plate",
      })
    );
  }
  return submission;
}

export function validateSosLocalValues(values, now = new Date()) {
  if (values?.mode === SOS_QUOTE_MODE.plateTransfer) {
    return /^[A-Z0-9 -]{1,10}$/i.test(String(values.transferPlateNumber || "").trim())
      ? []
      : [{ id: "sosTransferPlateNumber", message: "Enter the plate being transferred." }];
  }

  const errors = [];
  const required = [
    ["sosVehicleType", values?.vehicleType, "Select a vehicle type."],
    ["sosBodyStyle", values?.bodyStyle, "Select a body style."],
    ["sosVehicleUse", values?.vehicleUse, "Select how the vehicle will be used."],
    ["sosFuelType", values?.fuelType, "Select a fuel type."],
    ["sosFirstTitle", values?.firstTitle, "Choose new or used."],
    ["sosPlateType", values?.plateType, "Select a plate type."],
  ];
  required.forEach(([id, value, message]) => {
    if (!value) errors.push({ id, message });
  });

  const year = Number(values?.modelYear);
  if (!/^\d{4}$/.test(String(values?.modelYear || "")) || year < 1900 || year > now.getFullYear() + 2) {
    errors.push({ id: "sosModelYear", message: "Enter a valid four-digit model year." });
  }
  const msrp = String(values?.msrp || "").replace(/[$,\s]/g, "");
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(msrp) || Number(msrp) <= 0) {
    errors.push({ id: "sosMsrp", message: "Enter the vehicle MSRP." });
  }
  if (values?.plateType === "PAS" && !plateDesignByValue(values?.plateDesign)) {
    errors.push({ id: "sosPlateDesign", message: "Select a plate design." });
  }
  if (isCommercialUse(values?.vehicleUse) && !values?.businessRegistration) {
    errors.push({ id: "sosBusinessRegistration", message: "Choose whether this registration is for a business." });
  }
  const purchaseDate = String(values?.purchaseDate || "").trim();
  if (purchaseDate) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(purchaseDate);
    const parsed = match
      ? new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]))
      : null;
    const validDate =
      parsed &&
      parsed.getFullYear() === Number(match[3]) &&
      parsed.getMonth() === Number(match[1]) - 1 &&
      parsed.getDate() === Number(match[2]);
    if (!validDate) {
      errors.push({ id: "sosPurchaseDate", message: "Use MM/DD/YYYY for the plate purchase date." });
    }
  }
  return errors;
}
