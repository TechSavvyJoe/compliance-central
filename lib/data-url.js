/**
 * Allowlist image data URLs used in print/PDF HTML.
 * Rejects anything that could break out of an src="..." attribute.
 */

const IMAGE_DATA_URL =
  /^data:image\/(png|jpe?g|webp)(?:;charset=[\w-]+)?;base64,[A-Za-z0-9+/]+=*$/i;

/**
 * Normalize screenshot bytes/strings to a safe image data URL, or null.
 * @param {string|null|undefined} data
 * @returns {string|null}
 */
export function ensureDataUrl(data) {
  if (!data || typeof data !== "string") return null;
  const trimmed = data.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("data:")) {
    return IMAGE_DATA_URL.test(trimmed) ? trimmed : null;
  }

  // Raw base64 PNG/JPEG payload from the backend.
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && trimmed.length >= 8) {
    return `data:image/png;base64,${trimmed}`;
  }

  return null;
}
