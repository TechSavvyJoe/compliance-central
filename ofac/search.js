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
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function parseAlias(alias) {
  const parts = alias.split(/\s+/);
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

  let bestScore = primaryScore;
  let matchedName = sdnEntry.fullName;

  if (sdnEntry.aliases?.length) {
    for (const alias of sdnEntry.aliases) {
      const aliasScore = calculateNameSimilarity(searchName, parseAlias(alias));
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

  matches.sort((a, b) => b.score - a.score);
  return matches;
}
