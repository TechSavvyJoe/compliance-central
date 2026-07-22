/**
 * Fuzzy Search for OFAC Name Matching
 *
 * Jaro-Winkler weighted by name part: last 50%, first 35%, middle 15%.
 * Threshold default 85.
 */

function jaroSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const str1 = s1.toLowerCase();
  const str2 = s2.toLowerCase();
  const len1 = str1.length;
  const len2 = str2.length;

  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || str1[i] !== str2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (str1[i] !== str2[k]) transpositions++;
    k++;
  }

  return (
    (matches / len1 +
      matches / len2 +
      (matches - transpositions / 2) / matches) /
    3
  );
}

export function jaroWinkler(s1, s2, p = 0.1) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const jaroScore = jaroSimilarity(s1, s2);

  const str1 = s1.toLowerCase();
  const str2 = s2.toLowerCase();
  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(str1.length, str2.length));

  for (let i = 0; i < maxPrefix; i++) {
    if (str1[i] === str2[i]) prefix++;
    else break;
  }

  return jaroScore + prefix * p * (1 - jaroScore);
}

export function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const FULL_NAME_RESCUE_THRESHOLD = 95;

function comparableFullName(name) {
  return normalizeName(name)
    .split(" ")
    .filter((part) => part && !NAME_SUFFIXES.has(part))
    .join(" ");
}

function searchFullName(searchName) {
  return comparableFullName(
    [searchName.firstName, searchName.middleName, searchName.lastName]
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * Return the natural-order spelling plus a comma-reversed alternative.
 * OFAC's official XML normally separates given and family names, but some
 * aliases are published in a single field as forms such as "GARBAYA, AHMED".
 * Screening both forms avoids a false negative without changing the
 * human-review-only outcome.
 */
function fullNameVariants(name) {
  if (!name || typeof name !== "string") return [];

  const variants = [comparableFullName(name)];
  const commaParts = name.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length === 2) {
    variants.push(comparableFullName(`${commaParts[1]} ${commaParts[0]}`));
  }
  return [...new Set(variants.filter(Boolean))];
}

function fullNameSimilarity(searchName, candidateName) {
  const search = searchFullName(searchName);
  if (!search) return 0;

  let bestScore = 0;
  for (const candidate of fullNameVariants(candidateName)) {
    bestScore = Math.max(bestScore, jaroWinkler(search, candidate));
  }
  return Math.round(bestScore * 100);
}

function qualifyingFullNameScore(searchName, candidateName, threshold) {
  const score = fullNameSimilarity(searchName, candidateName);
  return score >= Math.max(threshold, FULL_NAME_RESCUE_THRESHOLD) ? score : 0;
}

export function calculateNameSimilarity(searchName, sdnName) {
  const sNorm = {
    first: normalizeName(searchName.firstName),
    middle: normalizeName(searchName.middleName),
    last: normalizeName(searchName.lastName),
  };

  const dNorm = {
    first: normalizeName(sdnName.firstName),
    middle: normalizeName(sdnName.middleName),
    last: normalizeName(sdnName.lastName),
  };

  let lastScore = 0;
  let firstScore = 0;
  let middleScore = 0;
  let hasMiddle = true;

  if (sNorm.last && dNorm.last) {
    lastScore = jaroWinkler(sNorm.last, dNorm.last);
  }
  if (sNorm.first && dNorm.first) {
    firstScore = jaroWinkler(sNorm.first, dNorm.first);
  }
  if (sNorm.middle && dNorm.middle) {
    middleScore = jaroWinkler(sNorm.middle, dNorm.middle);
  } else if (!sNorm.middle || !dNorm.middle) {
    hasMiddle = false;
  }

  let totalWeight = 0;
  let weightedScore = 0;

  if (sNorm.last) {
    weightedScore += lastScore * 0.5;
    totalWeight += 0.5;
  }
  if (sNorm.first) {
    weightedScore += firstScore * 0.35;
    totalWeight += 0.35;
  }
  if (hasMiddle && sNorm.middle) {
    weightedScore += middleScore * 0.15;
    totalWeight += 0.15;
  }

  const finalScore =
    totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;
  return Math.round(finalScore);
}

// Pull plausible birth years (1900–2100) out of OFAC's free-form date strings.
// The official XML may publish a full date, a bare year, an approximate range,
// or several values, so scan for every plausible year.
function extractYears(value) {
  const years = [];
  const re = /(\d{4})/g;
  let m;
  while ((m = re.exec(String(value || "")))) {
    const y = Number(m[1]);
    if (y >= 1900 && y <= 2100) years.push(y);
  }
  return years;
}

/**
 * Confidence that a name match is the SAME person, judged by birth year.
 * DISPLAY-ONLY — a name match always requires human review regardless; this
 * never auto-clears a hit, it only helps the reviewer prioritize.
 *   high   — birth years match (within ±1, tolerating data-entry slips)
 *   medium — DOB missing on either side; cannot disambiguate
 *   low    — birth years clearly differ; likely a false positive
 */
export function dobConfidence(searchDob, sdnBirthDate) {
  const searchYears = extractYears(searchDob);
  const sdnYears = extractYears(sdnBirthDate);
  if (searchYears.length === 0 || sdnYears.length === 0) return "medium";
  const sy = searchYears[0];
  return sdnYears.some((y) => Math.abs(y - sy) <= 1) ? "high" : "low";
}

function parseAlias(alias) {
  const parts = comparableFullName(alias).split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: "", middleName: "", lastName: parts[0] };
  }
  if (parts.length === 2) {
    return { firstName: parts[0], middleName: "", lastName: parts[1] };
  }
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

export function checkNameMatch(searchName, sdnEntry, threshold = 85) {
  const primaryScore = calculateNameSimilarity(searchName, {
    firstName: sdnEntry.firstName,
    middleName: sdnEntry.middleName,
    lastName: sdnEntry.lastName,
  });

  const primaryName =
    sdnEntry.fullName ||
    [sdnEntry.firstName, sdnEntry.middleName, sdnEntry.lastName]
      .filter(Boolean)
      .join(" ");
  let bestScore = Math.max(
    primaryScore,
    qualifyingFullNameScore(searchName, primaryName, threshold)
  );
  let matchedName = primaryName;

  if (sdnEntry.aliases?.length) {
    for (const alias of sdnEntry.aliases) {
      const aliasScore = Math.max(
        calculateNameSimilarity(searchName, parseAlias(alias)),
        qualifyingFullNameScore(searchName, alias, threshold)
      );
      if (aliasScore > bestScore) {
        bestScore = aliasScore;
        matchedName = alias;
      }
    }
  }

  return {
    isMatch: bestScore >= threshold,
    score: bestScore,
    matchedName,
    // searchName.dob is optional; when absent, confidence is "medium".
    confidence: dobConfidence(searchName.dob, sdnEntry.birthDate),
    sdnBirthDate: sdnEntry.birthDate || "",
  };
}

export function searchSDNEntries(searchName, sdnEntries, threshold = 85) {
  const matches = [];

  for (const entry of sdnEntries) {
    const result = checkNameMatch(searchName, entry, threshold);
    if (result.isMatch) {
      matches.push({
        entry,
        score: result.score,
        matchedName: result.matchedName,
        confidence: result.confidence,
        sdnBirthDate: result.sdnBirthDate,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}
