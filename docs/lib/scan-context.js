/**
 * Pure helpers for whether the license-scan page can use the camera.
 * getUserMedia is often denied in iframes, in-app browsers, and tiny popups.
 */

/**
 * @param {{ self?: unknown, top?: unknown, opener?: unknown, outerWidth?: number, outerHeight?: number }} win
 * @returns {{ embedded: boolean, tinyPopup: boolean, constrained: boolean }}
 */
export function classifyBrowseContext(win = {}) {
  let embedded = false;
  try {
    embedded = Boolean(win.top && win.self && win.top !== win.self);
  } catch {
    // Cross-origin parent — treat as embedded (camera usually blocked).
    embedded = true;
  }

  const width = Number(win.outerWidth) || 0;
  const height = Number(win.outerHeight) || 0;
  const tinyPopup = Boolean(
    win.opener &&
      ((width > 0 && width < 520) || (height > 0 && height < 640))
  );

  return {
    embedded,
    tinyPopup,
    constrained: embedded || tinyPopup,
  };
}
