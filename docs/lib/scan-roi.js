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
    !videoWidth ||
    !videoHeight ||
    !viewportWidth ||
    !viewportHeight ||
    !guideWidth ||
    !guideHeight
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
  const padX = width * padding;
  const padY = height * padding;
  x -= padX;
  y -= padY;
  width += padX * 2;
  height += padY * 2;

  x = Math.max(0, x);
  y = Math.max(0, y);
  width = Math.min(videoWidth - x, width);
  height = Math.min(videoHeight - y, height);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
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
  if (!crop || !crop.width || !crop.height) return null;
  const pad = Math.max(0, crop.width * padding);
  const x = Math.max(0, crop.x - pad);
  const right = Math.min(sourceWidth, crop.x + crop.width + pad);
  return {
    x: Math.round(x),
    y: Math.round(crop.y),
    width: Math.max(1, Math.round(right - x)),
    height: Math.max(1, Math.round(crop.height)),
  };
}

/**
 * Build PDF417-only decode ROIs from the bottom of the yellow guide. Michigan
 * cards commonly put a thin 1D barcode immediately above the PDF417 symbol.
 * Never send the full guide to the decoder: that recreates the interference
 * this crop is intended to remove.
 */
export function buildDecodeCrops(guideCrop, attempt = 0, sourceWidth = Infinity) {
  if (!guideCrop) return [];
  const horizontalPads = [0.03, 0.08, 0.14];
  const pad = horizontalPads[Math.abs(attempt) % horizontalPads.length];
  const crops = [0.5, 0.6, 0.7]
    .map((bottomKeep) => focusPdf417Band(guideCrop, { bottomKeep }))
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
