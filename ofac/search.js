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

  const matchDistance = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);

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
  const charMap = {
    ø: "o",
    Ø: "O",
    æ: "ae",
    Æ: "AE",
    ß: "ss",
    ł: "l",
    Ł: "L",
    œ: "oe",
    Œ: "OE",
  };
  const mapped = String(name).replace(
    /[øØæÆßłŁœŒ]/g,
    (character) => charMap[character] || character
  );

  return mapped
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const FULL_NAME_RESCUE_THRESHOLD = 95;

// Minimum stand-alone similarity a surname must reach before the weighted
// component score can qualify as a match.
//
// This deliberately uses plain Jaro, NOT Jaro-Winkler. Winkler's prefix bonus
// inflates exactly the pairs that produced false positives — a surname that is
// a truncation or extension of another shares its whole prefix, so Gallant/Gallo
// scored 0.87 and Smith/Smithson 0.93. No Jaro-Winkler threshold can work here:
// Smith/Smithson (must not match) outscores Qaddafi/Gaddafi (must match). Plain
// Jaro separates them, because it weighs the unmatched tail instead of
// rewarding the shared head:
//
//   reject  Gallant/Gallo 0.79 · Gallant/Gallagher 0.76 · Smith/Smithson 0.88
//   accept  Gallant/Gallent 0.91 · Muhammad/Mohammad 0.92 · Qaddafi/Gaddafi 0.91
//           Abdulla/Abdullah 0.96 · Yusuf/Yousuf 0.94 · Hussein/Hussain 0.91
//
// Scores are 0-1 here, not 0-100.
const SURNAME_FLOOR = 0.9;

// Below this length an edit-distance score is dominated by a single character
// (Kim/Kym scores 0.78, Li/Lee 0.61), so the floor would suppress real hits on
// short surnames. Screening must fail toward flagging, so short surnames keep
// the previous, more sensitive behaviour and are never rejected by the floor.
const SURNAME_FLOOR_MIN_LENGTH = 4;

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


// The full-name path exists to rescue records whose components we could not
// parse — an alias held in one field, a comma-reversed order, a compound
// surname, a trailing suffix. It must not become a way around a decided surname
// mismatch: "John Smith" against "John Smithson" scores 95 as one string
// because they share a long prefix, the same false positive the surname floor
// rejects component-wise.
//
// The candidate is therefore checked token-by-token rather than parsed into
// first/last, because which token carries the surname is exactly what this path
// cannot assume. If ANY token is a plausible rendering of the searched surname
// the rescue proceeds; only a candidate containing nothing like it is refused.
function qualifyingFullNameScore(searchName, candidateName, threshold) {
  // Both sides are tokenised: a searched surname can itself be compound
  // ("Gonzalez Pizana"), and the candidate may carry it across fields with a
  // suffix attached. A single shared surname token is enough to proceed.
  const searchTokens = normalizeName(searchName?.lastName)
    .split(/\s+/)
    .filter((token) => token.length >= SURNAME_FLOOR_MIN_LENGTH);
  if (searchTokens.length > 0) {
    const candidateTokens = comparableFullName(candidateName)
      .split(/\s+/)
      .filter(Boolean);
    // Only a token that actually resembles the searched surname may carry the
    // rescue. An earlier version also let any SHORT candidate token through,
    // which meant a short FIRST name — "Min", "Wei", "Ali" — silently exempted
    // the whole record: Min Park matched Min Parker at 96. The short-name
    // allowance belongs to the searched surname, and is already applied when
    // searchTokens is built.
    const carriesSurname =
      candidateTokens.length === 0 ||
      candidateTokens.some((token) =>
        searchTokens.some(
          (searchToken) => jaroSimilarity(searchToken, token) >= SURNAME_FLOOR
        )
      );
    if (!carriesSurname) return 0;
  }
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

  // A surname is the load-bearing part of an identity match. Weighting alone let
  // a clearly different surname ride in on a strong first name — last 0.80 with
  // first 1.00 scored 88 and cleared an 85 threshold — which produced obvious
  // false positives and trained reviewers to dismiss hits. A real SDN match
  // effectively always shares the surname, so when both sides supply one it must
  // stand on its own before any component score counts. This tightens only the
  // wrong-surname case: entries with no comparable surname still fall through to
  // the alias and full-name paths below, which are unchanged.
  if (
    sNorm.last &&
    dNorm.last &&
    Math.min(sNorm.last.length, dNorm.last.length) >= SURNAME_FLOOR_MIN_LENGTH &&
    jaroSimilarity(sNorm.last, dNorm.last) < SURNAME_FLOOR
  ) {
    return 0;
  }

  let totalWeight = 0;
  let weightedScore = 0;

  if (sNorm.last && dNorm.last) {
    weightedScore += lastScore * 0.5;
    totalWeight += 0.5;
  }
  if (sNorm.first && dNorm.first) {
    weightedScore += firstScore * 0.35;
    totalWeight += 0.35;
  }
  if (hasMiddle && sNorm.middle && dNorm.middle) {
    weightedScore += middleScore * 0.15;
    totalWeight += 0.15;
  }

  // If the target had none of the components we searched for (e.g. searching
  // first+last against a target with only an alias or completely malformed),
  // totalWeight is 0. Fall back to 0.
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

  const CONFIDENCE_WEIGHT = { high: 3, medium: 2, low: 1 };
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (CONFIDENCE_WEIGHT[b.confidence] || 0) - (CONFIDENCE_WEIGHT[a.confidence] || 0);
  });
  return matches;
}
