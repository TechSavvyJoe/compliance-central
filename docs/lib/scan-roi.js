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
