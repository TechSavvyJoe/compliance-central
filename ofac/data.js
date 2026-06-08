/**
 * OFAC SDN Data Fetcher and Parser
 *
 * Downloads the publicly mirrored OFAC SDN list from OpenSanctions
 * (Treasury.gov blocks direct browser/extension requests).
 */

const SDN_CSV_URL =
  "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv";

// Cap the SDN download so a slow/hung CDN can't freeze screening indefinitely.
const SDN_FETCH_TIMEOUT_MS = 60000;

async function fetchSDNCSV() {
  let response;
  try {
    response = await fetch(SDN_CSV_URL, {
      method: "GET",
      headers: { Accept: "text/csv, text/plain, */*" },
      signal: AbortSignal.timeout(SDN_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === "TimeoutError") {
      throw new Error("SDN download timed out. Check your internet connection.");
    }
    if (err?.name === "AbortError") {
      throw new Error("SDN download was cancelled.");
    }
    if (err instanceof TypeError) {
      // fetch network failure (DNS, offline, CORS, connection refused)
      throw new Error("Could not reach the OFAC data source. Check your internet connection.");
    }
    throw err;
  }

  if (!response.ok) {
    throw new Error(`SDN download failed: HTTP ${response.status}`);
  }

  return response.text();
}

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

function parseName(nameStr) {
  if (!nameStr) return { firstName: "", middleName: "", lastName: "" };

  // OpenSanctions format: usually "LAST NAME, First Middle" or just "Name"
  const parts = nameStr.split(",");

  if (parts.length > 1) {
    const lastName = parts[0].trim();
    const firstMiddle = parts.slice(1).join(",").trim();
    const nameParts = firstMiddle.split(/\s+/);

    if (nameParts.length === 1) {
      return { firstName: nameParts[0], middleName: "", lastName };
    }
    return {
      firstName: nameParts[0],
      middleName: nameParts.slice(1).join(" "),
      lastName,
    };
  }

  const nameParts = nameStr.split(/\s+/);
  if (nameParts.length === 1) {
    return { firstName: "", middleName: "", lastName: nameParts[0] };
  }
  if (nameParts.length === 2) {
    return { firstName: nameParts[0], middleName: "", lastName: nameParts[1] };
  }
  return {
    firstName: nameParts[0],
    middleName: nameParts.slice(1, -1).join(" "),
    lastName: nameParts[nameParts.length - 1],
  };
}

function parseSDNCSV(csvText) {
  const lines = csvText.split("\n");
  const entries = [];

  // OpenSanctions simple CSV schema:
  // id,schema,name,aliases,birth_date,countries,addresses,identifiers,sanctions,dataset
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const fields = parseCSVLine(line);
      if (fields.length < 3) continue;

      const uid = fields[0] || "";
      const schema = fields[1] || "";
      const name = fields[2] || "";
      const aliases = fields[3] || "";
      const birthDate = fields[4] || "";
      const countries = fields[5] || "";
      const sanctions = fields[8] || "";

      const { firstName, middleName, lastName } = parseName(name);

      let type = "Entity";
      const schemaLower = schema.toLowerCase();
      if (schemaLower.includes("person")) type = "Individual";
      else if (schemaLower.includes("vessel")) type = "Vessel";
      else if (schemaLower.includes("aircraft")) type = "Aircraft";

      const programs = sanctions
        ? sanctions.split(";").map((s) => s.trim()).filter(Boolean)
        : [];

      const countryList = countries ? countries.split(";")[0].trim() : "";

      entries.push({
        uid,
        firstName,
        middleName,
        lastName,
        fullName: name,
        type,
        program: programs.join("; "),
        country: countryList,
        birthDate,
        aliases: aliases
          ? aliases.split(";").map((a) => a.trim()).filter(Boolean)
          : [],
      });
    } catch (err) {
      console.warn("Error parsing SDN line", i, err);
    }
  }

  return entries;
}

export async function downloadAndParseSDN() {
  const csvText = await fetchSDNCSV();
  const entries = parseSDNCSV(csvText);

  return {
    entries,
    count: entries.length,
    downloadedAt: new Date().toISOString(),
    publishDate: new Date().toISOString(),
  };
}

export function needsUpdate(lastUpdate) {
  if (!lastUpdate) return true;
  const hoursSince = (Date.now() - new Date(lastUpdate).getTime()) / 3600000;
  return hoursSince >= 24;
}
