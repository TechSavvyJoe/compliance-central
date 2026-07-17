import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDecodeCrops,
  buildPhotoDecodeCrops,
  focusPdf417Band,
  mapGuideToVideoPixels,
  padCropHorizontally,
} from "../docs/lib/scan-roi.js";

test("mapGuideToVideoPixels maps cover-fit overlay back to source pixels", () => {
  const crop = mapGuideToVideoPixels({
    videoWidth: 1920,
    videoHeight: 1080,
    viewportWidth: 390,
    viewportHeight: 260,
    guideLeft: 20,
    guideTop: 120,
    guideWidth: 350,
    guideHeight: 100,
    padding: 0,
  });
  assert.ok(crop);
  assert.ok(crop.width > 100);
  assert.ok(crop.height > 40);
  assert.ok(crop.x >= 0);
  assert.ok(crop.y >= 0);
  assert.ok(crop.x + crop.width <= 1920);
  assert.ok(crop.y + crop.height <= 1080);
});

test("focusPdf417Band drops the top 1D strip from the yellow guide", () => {
  const guide = { x: 10, y: 100, width: 400, height: 200 };
  const band = focusPdf417Band(guide, { topSkip: 0.28 });
  assert.equal(band.x, 10);
  assert.equal(band.width, 400);
  assert.equal(band.y, 100 + Math.round(200 * 0.28));
  assert.equal(band.height, 200 - Math.round(200 * 0.28));

  const low = focusPdf417Band(guide, { bottomKeep: 0.5 });
  assert.equal(low.height, 100);
  assert.equal(low.y, 200);
});

test("horizontal crop padding preserves bounds and quiet zones", () => {
  assert.deepEqual(
    padCropHorizontally({ x: 100, y: 40, width: 200, height: 80 }, 0.1, 500),
    { x: 80, y: 40, width: 240, height: 80 }
  );
  assert.deepEqual(
    padCropHorizontally({ x: 5, y: 40, width: 200, height: 80 }, 0.1, 210),
    { x: 0, y: 40, width: 210, height: 80 }
  );
});

test("buildDecodeCrops uses bottom 50/60/70 percent and never the full guide", () => {
  const guide = { x: 100, y: 100, width: 800, height: 300 };
  const crops = buildDecodeCrops(guide, 0, 1000);
  assert.equal(crops.length, 3);
  assert.ok(crops.every((c) => c.height < guide.height));
  assert.deepEqual(crops.map((c) => c.height), [150, 180, 210]);
  assert.deepEqual(crops.map((c) => c.y), [250, 220, 190]);
  assert.ok(crops.every((c) => c.x < guide.x && c.width > guide.width));

  const laterAttempt = buildDecodeCrops(guide, 2, 1000);
  assert.ok(laterAttempt.every((c) => c.width > crops[0].width));
  assert.ok(laterAttempt.every((c) => c.height !== guide.height));
});

test("buildPhotoDecodeCrops prefers bottom bands and includes full frame", () => {
  const full = { x: 0, y: 0, width: 1200, height: 800 };
  const crops = buildPhotoDecodeCrops(full, 1200);
  assert.ok(crops.length > 3);
  assert.deepEqual(crops[crops.length - 1], full);
  assert.ok(crops.some((c) => c.height === Math.round(800 * 0.45)));
});
