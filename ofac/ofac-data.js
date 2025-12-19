/**
 * OFAC SDN Data Fetcher and Parser
 * Downloads and parses the official OFAC SDN list
 * Uses OpenSanctions mirror which is publicly accessible
 * (Treasury.gov blocks direct browser/extension requests)
 *
 * MATCHES: TechSavvyJoe/OFAC-Search/utils/ofac-data.js
 */

// OpenSanctions mirror of OFAC SDN data - publicly accessible
const SDN_CSV_URL =
  "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv";

/**
 * Fetch the SDN CSV from OpenSanctions
 * @returns {Promise<string>} - Raw CSV text
 */
async function fetchSDNCSV() {
  const response = await fetch(SDN_CSV_URL, {
    method: "GET",
    headers: {
      Accept: "text/csv, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const csvText = await response.text();
  return csvText;
}

/**
 * Parse a CSV line handling quoted fields
 * @param {string} line - CSV line
 * @returns {string[]} - Array of field values
 */
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

/**
 * Parse a name string into first, middle, last components
 * @param {string} nameStr - Name string from CSV
 * @returns {Object} - {firstName, middleName, lastName}
 */
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
    } else {
      return {
        firstName: nameParts[0],
        middleName: nameParts.slice(1).join(" "),
        lastName,
      };
    }
  }

  // No comma - try to split by space
  const nameParts = nameStr.split(/\s+/);
  if (nameParts.length === 1) {
    return { firstName: "", middleName: "", lastName: nameParts[0] };
  } else if (nameParts.length === 2) {
    return { firstName: nameParts[0], middleName: "", lastName: nameParts[1] };
  } else {
    return {
      firstName: nameParts[0],
      middleName: nameParts.slice(1, -1).join(" "),
      lastName: nameParts[nameParts.length - 1],
    };
  }
}

/**
 * Parse the SDN CSV text into entries
 * OpenSanctions simple CSV format:
 * id,schema,name,aliases,birth_date,countries,addresses,identifiers,sanctions,dataset
 *
 * @param {string} csvText - Raw CSV text
 * @returns {Array} - Array of parsed SDN entries
 */
function parseSDNCSV(csvText) {
  const lines = csvText.split("\n");
  const entries = [];

  // Skip header line
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
      const addresses = fields[6] || "";
      const identifiers = fields[7] || "";
      const sanctions = fields[8] || "";

      // Parse the name
      const { firstName, middleName, lastName } = parseName(name);

      // Determine type from schema
      let type = "Entity";
      if (schema.toLowerCase().includes("person")) {
        type = "Individual";
      } else if (schema.toLowerCase().includes("vessel")) {
        type = "Vessel";
      } else if (schema.toLowerCase().includes("aircraft")) {
        type = "Aircraft";
      }

      // Parse programs from sanctions field
      const programs = sanctions
        ? sanctions
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      // Parse country
      const countryList = countries ? countries.split(";")[0].trim() : "";

      const entry = {
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
          ? aliases
              .split(";")
              .map((a) => a.trim())
              .filter(Boolean)
          : [],
      };

      entries.push(entry);
    } catch (err) {
      console.warn("Error parsing line:", i, err);
    }
  }

  return entries;
}

/**
 * Download and parse the SDN list
 * @returns {Promise<Object>} - {entries, count, downloadedAt, publishDate}
 */
export async function downloadAndParseSDN() {
  const csvText = await fetchSDNCSV();
  const entries = parseSDNCSV(csvText);

  return {
    entries,
    count: entries.length,
    downloadedAt: new Date().toISOString(),
    publishDate: new Date().toISOString(), // OpenSanctions doesn't provide this in CSV
  };
}

/**
 * Check if data needs to be updated (more than 24 hours old)
 * @param {string} lastUpdate - ISO date string of last update
 * @returns {boolean}
 */
export function needsUpdate(lastUpdate) {
  if (!lastUpdate) return true;

  const lastDate = new Date(lastUpdate);
  const now = new Date();
  const hoursSinceUpdate = (now - lastDate) / (1000 * 60 * 60);

  return hoursSinceUpdate >= 24;
}
