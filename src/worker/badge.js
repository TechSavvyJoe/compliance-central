/**
 * Toolbar badge updates.
 */

const BADGE_COLORS = {
  eligible: "#2e7d32",
  ineligible: "#c62828",
  unknown: "#f57c00",
};

const BADGE_TEXTS = {
  eligible: "✓",
  ineligible: "!",
  unknown: "?",
};

export async function setBadgeForStatus(status) {
  const text = BADGE_TEXTS[status] ?? BADGE_TEXTS.unknown;
  const color = BADGE_COLORS[status] ?? BADGE_COLORS.unknown;
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

export async function clearBadge() {
  await chrome.action.setBadgeText({ text: "" });
}
