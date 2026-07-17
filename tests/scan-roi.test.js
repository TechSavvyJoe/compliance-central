import test from "node:test";
import assert from "node:assert/strict";
import { mapGuideToVideoPixels } from "../docs/lib/scan-roi.js";

test("maps a guide through horizontal object-fit cover cropping", () => {
  const crop = mapGuideToVideoPixels({
    videoWidth: 1920,
    videoHeight: 1080,
    viewportWidth: 450,
    viewportHeight: 300,
    guideLeft: 27,
    guideTop: 84,
    guideWidth: 396,
    guideHeight: 132,
  });

  assert.deepEqual(crop, {
    x: 247,
    y: 302,
    width: 1426,
    height: 475,
  });
});

test("clamps padded guide crops to source bounds", () => {
  const crop = mapGuideToVideoPixels({
    videoWidth: 1280,
    videoHeight: 720,
    viewportWidth: 360,
    viewportHeight: 240,
    guideLeft: 0,
    guideTop: 0,
    guideWidth: 360,
    guideHeight: 240,
    padding: 0.2,
  });

  assert.deepEqual(crop, {
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
});
