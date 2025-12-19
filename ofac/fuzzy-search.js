/**
 * Fuzzy Search Utilities for OFAC Name Matching
 * Implements Jaro-Winkler similarity algorithm for name comparison
 *
 * MATCHES: TechSavvyJoe/OFAC-Search/utils/fuzzy-search.js
 */

/**
 * Calculate Jaro similarity between two strings
 * @param {string} s1 - First string
 * @param {string} s2 - Second string
 * @returns {number} - Similarity score between 0 and 1
 */
function jaroSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const str1 = s1.toLowerCase();
  const str2 = s2.toLowerCase();

  const len1 = str1.length;
  const len2 = str2.length;

  // Maximum distance for matching characters
  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matching characters
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

  // Count transpositions
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

/**
 * Calculate Jaro-Winkler similarity between two strings
 * Gives higher scores to strings that match from the beginning
 * @param {string} s1 - First string
 * @param {string} s2 - Second string
 * @param {number} p - Scaling factor (default 0.1, max 0.25)
 * @returns {number} - Similarity score between 0 and 1
 */
export function jaroWinkler(s1, s2, p = 0.1) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const jaroScore = jaroSimilarity(s1, s2);

  // Calculate common prefix (up to 4 characters)
  const str1 = s1.toLowerCase();
  const str2 = s2.toLowerCase();
  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(str1.length, str2.length));

  for (let i = 0; i < maxPrefix; i++) {
    if (str1[i] === str2[i]) {
      prefix++;
    } else {
      break;
    }
  }

  return jaroScore + prefix * p * (1 - jaroScore);
}

/**
 * Normalize a name for comparison
 * Removes special characters, extra spaces, and converts to lowercase
 * @param {string} name - Name to normalize
 * @returns {string} - Normalized name
 */
export function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate similarity between two full names
 * Handles first/middle/last name variations
 * Weighted: Last name 50%, First name 35%, Middle name 15%
 *
 * @param {Object} searchName - Object with firstName, middleName, lastName
 * @param {Object} sdnName - Object with firstName, middleName, lastName
 * @returns {number} - Combined similarity score (0-100)
 */
export function calculateNameSimilarity(searchName, sdnName) {
  const normalizedSearch = {
    first: normalizeName(searchName.firstName),
    middle: normalizeName(searchName.middleName),
    last: normalizeName(searchName.lastName),
  };

  const normalizedSDN = {
    first: normalizeName(sdnName.firstName),
    middle: normalizeName(sdnName.middleName),
    last: normalizeName(sdnName.lastName),
  };

  // Calculate individual name part scores
  let lastScore = 0;
  let firstScore = 0;
  let middleScore = 0;

  // Last name is most important
  if (normalizedSearch.last && normalizedSDN.last) {
    lastScore = jaroWinkler(normalizedSearch.last, normalizedSDN.last);
  }

  // First name
  if (normalizedSearch.first && normalizedSDN.first) {
    firstScore = jaroWinkler(normalizedSearch.first, normalizedSDN.first);
  }

  // Middle name (if provided)
  if (normalizedSearch.middle && normalizedSDN.middle) {
    middleScore = jaroWinkler(normalizedSearch.middle, normalizedSDN.middle);
  } else if (!normalizedSearch.middle || !normalizedSDN.middle) {
    // If either doesn't have middle name, don't penalize
    middleScore = null;
  }

  // Calculate weighted average
  // Last name: 50%, First name: 35%, Middle name: 15%
  let totalWeight = 0;
  let weightedScore = 0;

  if (normalizedSearch.last) {
    weightedScore += lastScore * 0.5;
    totalWeight += 0.5;
  }

  if (normalizedSearch.first) {
    weightedScore += firstScore * 0.35;
    totalWeight += 0.35;
  }

  if (middleScore !== null && normalizedSearch.middle) {
    weightedScore += middleScore * 0.15;
    totalWeight += 0.15;
  }

  // Normalize to 0-100 scale
  const finalScore = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;

  return Math.round(finalScore);
}

/**
 * Check if a name matches against an SDN entry (including aliases)
 * @param {Object} searchName - {firstName, middleName, lastName}
 * @param {Object} sdnEntry - SDN entry with name and aliases
 * @param {number} threshold - Minimum score to consider a match (default 85)
 * @returns {Object} - {isMatch, score, matchedName}
 */
export function checkNameMatch(searchName, sdnEntry, threshold = 85) {
  // Check primary name
  const primaryScore = calculateNameSimilarity(searchName, {
    firstName: sdnEntry.firstName,
    middleName: sdnEntry.middleName,
    lastName: sdnEntry.lastName,
  });

  let bestScore = primaryScore;
  let matchedName = sdnEntry.fullName;

  // Check aliases
  if (sdnEntry.aliases && sdnEntry.aliases.length > 0) {
    for (const alias of sdnEntry.aliases) {
      // Parse alias into name parts
      const aliasParts = alias.split(/\s+/);
      let aliasName;

      if (aliasParts.length === 1) {
        aliasName = { firstName: "", middleName: "", lastName: aliasParts[0] };
      } else if (aliasParts.length === 2) {
        aliasName = {
          firstName: aliasParts[0],
          middleName: "",
          lastName: aliasParts[1],
        };
      } else {
        aliasName = {
          firstName: aliasParts[0],
          middleName: aliasParts.slice(1, -1).join(" "),
          lastName: aliasParts[aliasParts.length - 1],
        };
      }

      const aliasScore = calculateNameSimilarity(searchName, aliasName);
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
  };
}

/**
 * Search all SDN entries for matches
 * @param {Object} searchName - {firstName, middleName, lastName}
 * @param {Array} sdnEntries - Array of SDN entries
 * @param {number} threshold - Minimum score (default 85)
 * @returns {Array} - Array of matches sorted by score
 */
export function searchSDNEntries(searchName, sdnEntries, threshold = 85) {
  const matches = [];

  for (const entry of sdnEntries) {
    const result = checkNameMatch(searchName, entry, threshold);

    if (result.isMatch) {
      matches.push({
        entry,
        score: result.score,
        matchedName: result.matchedName,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches;
}
