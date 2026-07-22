/**
 * Map an overlay rectangle on an object-fit: cover video back to source pixels.
 * This keeps decoding aligned with the yellow guide on every screen shape.
 */
export function mapGuideToVideoPixels({
  videoWidth,
  videoHeight,
  viewportWidth,
  viewportHeight,
  guideLeft,
  guideTop,
  guideWidth,
  guideHeight,
  padding = 0,
}) {
  if (
    !Number.isFinite(videoWidth) || videoWidth <= 0 ||
    !Number.isFinite(videoHeight) || videoHeight <= 0 ||
    !Number.isFinite(viewportWidth) || viewportWidth <= 0 ||
    !Number.isFinite(viewportHeight) || viewportHeight <= 0 ||
    !Number.isFinite(guideLeft) ||
    !Number.isFinite(guideTop) ||
    !Number.isFinite(guideWidth) || guideWidth <= 0 ||
    !Number.isFinite(guideHeight) || guideHeight <= 0
  ) {
    return null;
  }

  const scale = Math.max(viewportWidth / videoWidth, viewportHeight / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (viewportHeight - renderedHeight) / 2;

  let x = (guideLeft - offsetX) / scale;
  let y = (guideTop - offsetY) / scale;
  let width = guideWidth / scale;
  let height = guideHeight / scale;
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const padX = width * safePadding;
  const padY = height * safePadding;
  x -= padX;
  y -= padY;
  width += padX * 2;
  height += padY * 2;

  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(videoWidth, Math.ceil(x + width));
  const bottom = Math.min(videoHeight, Math.ceil(y + height));
  if (right <= left || bottom <= top) return null;

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Focus on the dense PDF417 band and drop the thin 1D barcode that sits above
 * it on Michigan (and most AAMVA) cards.
 *
 * @param {{ x: number, y: number, width: number, height: number }} crop
 * @param {{ topSkip?: number, bottomKeep?: number }} [opts]
 *   topSkip — fraction of guide height to discard from the top (default 0.28)
 *   bottomKeep — optional alternate: keep only this fraction from the bottom
 */
export function focusPdf417Band(crop, opts = {}) {
  if (!crop || !crop.width || !crop.height) return null;
  const topSkip = Number.isFinite(opts.topSkip) ? opts.topSkip : 0.28;
  const bottomKeep = Number.isFinite(opts.bottomKeep) ? opts.bottomKeep : null;

  let y = crop.y;
  let height = crop.height;

  if (bottomKeep != null) {
    const keep = Math.max(0.35, Math.min(1, bottomKeep));
    const nextHeight = Math.max(1, Math.round(crop.height * keep));
    y = crop.y + (crop.height - nextHeight);
    height = nextHeight;
  } else {
    const skip = Math.max(0, Math.min(0.55, topSkip));
    const cut = Math.round(crop.height * skip);
    y = crop.y + cut;
    height = Math.max(1, crop.height - cut);
  }

  return {
    x: crop.x,
    y: Math.round(y),
    width: crop.width,
    height: Math.round(height),
  };
}

/**
 * Expand a crop sideways to preserve PDF417 quiet zones when the guide is
 * framed tightly. The source width keeps the result inside the camera image.
 */
export function padCropHorizontally(crop, padding = 0, sourceWidth = Infinity) {
  if (
    !crop ||
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y) ||
    !Number.isFinite(crop.width) || crop.width <= 0 ||
    !Number.isFinite(crop.height) || crop.height <= 0 ||
    (!(Number.isFinite(sourceWidth) && sourceWidth > 0) && sourceWidth !== Infinity)
  ) {
    return null;
  }
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const pad = crop.width * safePadding;
  const x = Math.max(0, Math.floor(crop.x - pad));
  const right = Math.min(sourceWidth, Math.ceil(crop.x + crop.width + pad));
  if (right <= x) return null;
  return {
    x,
    y: Math.round(crop.y),
    width: right - x,
    height: Math.max(1, Math.round(crop.height)),
  };
}

/**
 * Build decode ROIs for the yellow guide.
 *
 * Lead with the FULL guide (the pre-wasm path that historically worked), then
 * add bottom-band crops so a thin 1D strip above the PDF417 can be skipped when
 * both symbols sit in the frame. Bottom-only crops alone caused partial AAMVA
 * reads when the PDF417 was centered in a tall guide.
 */
export function buildDecodeCrops(guideCrop, attempt = 0, sourceWidth = Infinity) {
  if (!guideCrop) return [];
  const horizontalPads = [0.03, 0.08, 0.14];
  const pad = horizontalPads[Math.abs(attempt) % horizontalPads.length];
  const crops = [
    guideCrop,
    focusPdf417Band(guideCrop, { bottomKeep: 0.72 }),
    focusPdf417Band(guideCrop, { topSkip: 0.18 }),
  ]
    .filter(Boolean)
    .map((crop) => padCropHorizontally(crop, pad, sourceWidth))
    .filter(Boolean);

  // De-dupe identical rectangles
  const seen = new Set();
  return crops.filter((c) => {
    const key = `${c.x},${c.y},${c.width},${c.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Keep the full guide as the primary live ROI on every other attempt. Focused
 * variants are useful when the neighboring 1D strip intrudes, but must never
 * starve a correctly centered PDF417 symbol.
 */
export function selectDecodeCrop(crops, attempt = 1) {
  if (!Array.isArray(crops) || crops.length === 0) return null;
  if (crops.length === 1) return crops[0];
  const n = Math.max(1, Math.abs(Math.trunc(attempt)) || 1);
  if (n % 2 === 1) return crops[0];
  const alternateIndex = (Math.floor(n / 2) - 1) % (crops.length - 1);
  return crops[alternateIndex + 1];
}

function clampCrop(crop, sourceWidth, sourceHeight) {
  if (
    !crop ||
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y) ||
    !Number.isFinite(crop.width) || crop.width <= 0 ||
    !Number.isFinite(crop.height) || crop.height <= 0 ||
    !Number.isFinite(sourceWidth) || sourceWidth <= 0 ||
    !Number.isFinite(sourceHeight) || sourceHeight <= 0
  ) {
    return null;
  }

  const left = Math.max(0, Math.floor(crop.x));
  const top = Math.max(0, Math.floor(crop.y));
  const right = Math.min(sourceWidth, Math.ceil(crop.x + crop.width));
  const bottom = Math.min(sourceHeight, Math.ceil(crop.y + crop.height));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function expandCrop(crop, fraction, bounds, sourceWidth, sourceHeight) {
  const safeFraction = Number.isFinite(fraction) ? Math.max(0, fraction) : 0;
  const padX = crop.width * safeFraction;
  const padY = crop.height * safeFraction;
  const expanded = {
    x: crop.x - padX,
    y: crop.y - padY,
    width: crop.width + padX * 2,
    height: crop.height + padY * 2,
  };
  const bounded = {
    x: Math.max(expanded.x, bounds.x),
    y: Math.max(expanded.y, bounds.y),
    width: Math.min(expanded.x + expanded.width, bounds.x + bounds.width) -
      Math.max(expanded.x, bounds.x),
    height: Math.min(expanded.y + expanded.height, bounds.y + bounds.height) -
      Math.max(expanded.y, bounds.y),
  };
  return clampCrop(bounded, sourceWidth, sourceHeight);
}

/**
 * Select one bounded live-search window per decode attempt.
 *
 * Odd attempts always return to the on-screen guide so a normally framed
 * barcode gets the lowest-latency path. Even attempts progressively search a
 * larger, upper, lower, and full-visible window, with two low-cadence deskew
 * passes for the mild angles that PDF417 readers commonly miss.
 */
export function buildLiveDecodePlan(
  guideCrop,
  visibleCrop,
  attempt = 1,
  sourceWidth,
  sourceHeight
) {
  const guide = clampCrop(guideCrop, sourceWidth, sourceHeight);
  const visible = clampCrop(visibleCrop, sourceWidth, sourceHeight);
  if (!guide || !visible) return null;

  const n = Math.max(1, Math.abs(Math.trunc(attempt)) || 1);
  const step = (n - 1) % 12;
  if (step % 2 === 0) return { crop: guide, angle: 0, label: "guide" };

  if (step === 1) {
    return {
      crop: expandCrop(guide, 0.14, visible, sourceWidth, sourceHeight),
      angle: 0,
      label: "expanded",
    };
  }

  if (step === 3 || step === 5) {
    const shifted = {
      x: guide.x,
      y: step === 3
        ? visible.y
        : visible.y + visible.height - guide.height,
      width: guide.width,
      height: guide.height,
    };
    return {
      crop: clampCrop(shifted, sourceWidth, sourceHeight),
      angle: 0,
      label: step === 3 ? "upper" : "lower",
    };
  }

  if (step === 7) return { crop: visible, angle: 0, label: "visible" };

  return {
    crop: expandCrop(guide, 0.08, visible, sourceWidth, sourceHeight),
    angle: step === 9 ? -6 : 6,
    label: step === 9 ? "tilt-left" : "tilt-right",
  };
}
