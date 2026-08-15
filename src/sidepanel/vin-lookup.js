/**
 * Optional, explicit NHTSA vPIC VIN helper for the SOS fee workspace.
 *
 * vPIC is authoritative vehicle-specification data, not an SOS fee source.
 * A VIN is sent to vPIC only after the salesperson clicks Look up VIN. The
 * raw VIN is intentionally discarded from the returned object and never
 * written to Chrome storage or passed to SOS.
 */

const VPIC_ENDPOINT = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended";
const VIN_CHARACTERS = /^[A-HJ-NPR-Z0-9*]{8,17}$/;

export function normalizeVinLookupInput(value) {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  return VIN_CHARACTERS.test(normalized) ? normalized : null;
}

function clean(value, max = 120) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function hasPartialDecode(result) {
  return /incomplete|partial/i.test(String(result?.ErrorText || ""));
}

/**
 * Fetch a single official NHTSA decode. The raw VIN stays inside this function
 * and the request URL; callers receive only the decoded fields needed to make
 * SOS suggestions.
 */
export async function lookupVin(value, { fetchImpl = fetch } = {}) {
  const vin = normalizeVinLookupInput(value);
  if (!vin) {
    throw new Error("Enter at least 8 valid VIN characters. A full 17-character VIN is most reliable.");
  }

  let response;
  try {
    // `encodeURIComponent` deliberately leaves `*` unchanged. Encode it for
    // the path anyway so partial-VIN wildcards are transmitted unambiguously.
    const encodedVin = encodeURIComponent(vin).replace(/\*/g, "%2A");
    response = await fetchImpl(`${VPIC_ENDPOINT}/${encodedVin}?format=json`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new Error("The NHTSA VIN lookup could not be reached. Try again or enter vehicle details manually.");
  }
  if (!response.ok) {
    throw new Error("The NHTSA VIN lookup is unavailable right now. Enter vehicle details manually.");
  }

  const payload = await response.json().catch(() => null);
  const result = payload?.Results?.[0];
  if (!result || typeof result !== "object") {
    throw new Error("The NHTSA VIN lookup did not return vehicle details. Enter them manually.");
  }

  const year = clean(result.ModelYear, 4);
  const make = clean(result.Make, 40);
  const model = clean(result.Model, 60);
  const useful = [year, make, model].filter(Boolean);
  if (!useful.length) {
    throw new Error("The NHTSA VIN lookup could not identify this vehicle. Enter SOS choices manually.");
  }

  return {
    // Do not return result.VIN, VehicleDescriptor, or any raw lookup input.
    year: /^\d{4}$/.test(year) ? year : "",
    make,
    model,
    vehicleType: clean(result.VehicleType, 80),
    bodyClass: clean(result.BodyClass, 120),
    doors: clean(result.Doors, 8),
    fuelTypePrimary: clean(result.FuelTypePrimary, 80),
    fuelTypeSecondary: clean(result.FuelTypeSecondary, 80),
    electrificationLevel: clean(result.ElectrificationLevel, 100),
    partial: hasPartialDecode(result),
  };
}

function normal(value) {
  return clean(value, 180).toLowerCase();
}

function findField(fields, label) {
  return fields.find((field) => field.label === label && !field.disabled) || null;
}

function optionValue(field, labels) {
  if (!field?.options) return null;
  const wanted = labels.map(normal);
  const option = field.options.find((candidate) => wanted.includes(normal(candidate.label)));
  return option?.value ?? null;
}

function vehicleTypeCandidate(decoded) {
  const vehicleType = normal(decoded.vehicleType);
  const body = normal(decoded.bodyClass);
  if (/motorcycle/.test(vehicleType)) return ["Motorcycle"];
  if (/trailer/.test(vehicleType)) return ["Trailer", "Trailer Coach"];
  if (/bus/.test(vehicleType)) return ["Bus"];
  if (/truck/.test(vehicleType)) {
    if (/pickup/.test(body)) return ["Pick-Up Truck"];
    if (/stake/.test(body)) return ["Stake Truck"];
    if (/van/.test(body)) return ["Van", "Utility Truck"];
    return ["Utility Truck", "Pick-Up Truck"];
  }
  if (/passenger|multipurpose|mpv|low speed/.test(vehicleType)) {
    return ["Car/Mini-Van/SUV"];
  }
  return [];
}

function bodyStyleCandidates(decoded) {
  const body = normal(decoded.bodyClass);
  if (/convertible/.test(body)) return ["Convertible"];
  if (/roadster/.test(body)) return ["Roadster"];
  if (/station wagon/.test(body)) return ["Station Wagon"];
  if (decoded.doors === "2") return ["2 Door"];
  if (decoded.doors === "4") return ["4 Door"];
  return [];
}

function fuelCandidates(decoded) {
  const electrification = normal(decoded.electrificationLevel);
  const primary = normal(decoded.fuelTypePrimary);
  const secondary = normal(decoded.fuelTypeSecondary);
  if (/plug.?in|phev/.test(electrification)) return ["Plug in Hybrid Electric"];
  if (/hybrid|hev/.test(electrification)) {
    return /diesel/.test(primary)
      ? ["Electric & Diesel Hybrid"]
      : ["Electric & Gas Hybrid"];
  }
  if (/electric|bev/.test(electrification) || /^electric/.test(primary)) return ["Electric"];
  if (/diesel/.test(primary)) return ["Diesel"];
  if (/compressed natural gas|natural gas/.test(primary)) return ["Compressed Natural Gas"];
  if (/propane/.test(primary)) return ["Propane"];
  if (/methanol/.test(primary)) return ["Methanol"];
  if (/ethanol/.test(primary)) return ["Ethanol"];
  if (/flexible/.test(primary) || /ethanol/.test(secondary)) return ["Flexible"];
  if (/gasoline|gas/.test(primary)) return ["Gas"];
  return [];
}

/**
 * Match only decoded values that exactly exist in the live SOS option schema.
 * Anything ambiguous stays for the salesperson to select in the sidebar.
 */
export function makeSosVinSuggestions(decoded, fields) {
  const suggestions = [];
  const vehicleType = findField(fields, "Select your vehicle type");
  const vehicleTypeValue = optionValue(vehicleType, vehicleTypeCandidate(decoded));
  if (vehicleTypeValue != null) {
    suggestions.push({ fieldId: vehicleType.id, value: vehicleTypeValue });
  }

  const bodyStyle = findField(fields, "Select the body style");
  const bodyStyleValue = optionValue(bodyStyle, bodyStyleCandidates(decoded));
  if (bodyStyleValue != null) {
    suggestions.push({ fieldId: bodyStyle.id, value: bodyStyleValue });
  }

  const fuel = findField(fields, "Select your fuel type");
  const fuelValue = optionValue(fuel, fuelCandidates(decoded));
  if (fuelValue != null) suggestions.push({ fieldId: fuel.id, value: fuelValue });

  const year = findField(fields, "Enter the vehicle model year");
  if (year && decoded.year) suggestions.push({ fieldId: year.id, value: decoded.year });

  return suggestions;
}

export function vinLookupSummary(decoded) {
  return [decoded.year, decoded.make, decoded.model].filter(Boolean).join(" ");
}
