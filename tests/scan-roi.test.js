import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildLiveDecodePlan,
  buildDecodeCrops,
  focusPdf417Band,
  mapGuideToVideoPixels,
  padCropHorizontally,
  selectDecodeCrop,
} from "../docs/lib/scan-roi.js";

function contains(outer, inner) {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

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
  assert.equal(
    padCropHorizontally({ x: 250, y: 40, width: 100, height: 80 }, 0.1, 210),
    null
  );
});

test("ROI mapping rejects invalid and fully out-of-frame guides", () => {
  assert.equal(
    mapGuideToVideoPixels({
      videoWidth: 1920,
      videoHeight: 1080,
      viewportWidth: 390,
      viewportHeight: 260,
      guideLeft: 500,
      guideTop: 120,
      guideWidth: 100,
      guideHeight: 100,
    }),
    null
  );
  assert.equal(
    mapGuideToVideoPixels({
      videoWidth: Number.NaN,
      videoHeight: 1080,
      viewportWidth: 390,
      viewportHeight: 260,
      guideLeft: 20,
      guideTop: 120,
      guideWidth: 350,
      guideHeight: 100,
    }),
    null
  );
});

test("buildDecodeCrops leads with the full guide, then bottom/top-skip bands", () => {
  const guide = { x: 100, y: 100, width: 800, height: 300 };
  const crops = buildDecodeCrops(guide, 0, 1000);
  assert.ok(crops.length >= 3);
  // First crop is the full guide (horizontally padded).
  assert.equal(crops[0].height, guide.height);
  assert.ok(crops[0].width > guide.width);
  assert.ok(crops[0].x < guide.x);
  // Later crops are shorter PDF417-focused bands.
  assert.ok(crops.slice(1).every((c) => c.height < guide.height));

  const laterAttempt = buildDecodeCrops(guide, 2, 1000);
  assert.equal(laterAttempt[0].height, guide.height);
  assert.ok(laterAttempt[0].width > crops[0].width);
});

test("live crop selection returns to the full guide every other attempt", () => {
  const crops = [
    { id: "full" },
    { id: "bottom" },
    { id: "top-skip" },
  ];
  assert.equal(selectDecodeCrop(crops, 1).id, "full");
  assert.equal(selectDecodeCrop(crops, 2).id, "bottom");
  assert.equal(selectDecodeCrop(crops, 3).id, "full");
  assert.equal(selectDecodeCrop(crops, 4).id, "top-skip");
  assert.equal(selectDecodeCrop(crops, 5).id, "full");
  assert.equal(selectDecodeCrop(crops, 6).id, "bottom");
  assert.equal(selectDecodeCrop([], 1), null);
});

test("live plan searches the guide and forgiving off-center windows predictably", () => {
  const guide = { x: 300, y: 360, width: 1320, height: 360 };
  const visible = { x: 100, y: 0, width: 1720, height: 1080 };
  const plans = Array.from({ length: 12 }, (_, index) =>
    buildLiveDecodePlan(guide, visible, index + 1, 1920, 1080)
  );

  assert.deepEqual(
    plans.map((plan) => plan?.label),
    [
      "guide",
      "expanded",
      "guide",
      "upper",
      "guide",
      "lower",
      "guide",
      "visible",
      "guide",
      "tilt-left",
      "guide",
      "tilt-right",
    ]
  );
  assert.deepEqual(
    plans.map((plan) => plan?.angle),
    [0, 0, 0, 0, 0, 0, 0, 0, 0, -6, 0, 6]
  );

  const upperBarcode = { x: 400, y: 140, width: 1120, height: 180 };
  const lowerBarcode = { x: 400, y: 760, width: 1120, height: 180 };
  assert.ok(contains(plans[3].crop, upperBarcode));
  assert.ok(contains(plans[5].crop, lowerBarcode));
  assert.ok(contains(plans[7].crop, upperBarcode));
  assert.ok(contains(plans[7].crop, lowerBarcode));

  for (const [index, plan] of plans.entries()) {
    assert.ok(plan && !Array.isArray(plan), `attempt ${index + 1} returns one plan`);
    assert.ok(plan.crop.width > 0 && plan.crop.height > 0);
    assert.ok(plan.crop.x >= 0 && plan.crop.y >= 0);
    assert.ok(plan.crop.x + plan.crop.width <= 1920);
    assert.ok(plan.crop.y + plan.crop.height <= 1080);
    if (index % 2 === 0) {
      assert.equal(plan.label, "guide");
      assert.equal(plan.angle, 0);
    }
  }
});

test("live plan clamps every search window to the camera frame", () => {
  const guide = { x: 900, y: 700, width: 400, height: 300 };
  const visible = { x: -50, y: -60, width: 1200, height: 1000 };

  for (let attempt = 1; attempt <= 24; attempt++) {
    const plan = buildLiveDecodePlan(guide, visible, attempt, 1000, 800);
    assert.ok(plan, `attempt ${attempt} should have a bounded plan`);
    assert.ok(plan.crop.width > 0 && plan.crop.height > 0);
    assert.ok(plan.crop.x >= 0 && plan.crop.y >= 0);
    assert.ok(plan.crop.x + plan.crop.width <= 1000);
    assert.ok(plan.crop.y + plan.crop.height <= 800);
  }
});

test("live plan rejects unusable crop inputs", () => {
  const valid = { x: 10, y: 10, width: 100, height: 60 };
  assert.equal(buildLiveDecodePlan(null, valid, 1, 200, 100), null);
  assert.equal(buildLiveDecodePlan(valid, null, 1, 200, 100), null);
  assert.equal(buildLiveDecodePlan(valid, valid, 1, 0, 100), null);
  assert.equal(buildLiveDecodePlan(valid, valid, 1, 200, Number.NaN), null);
  assert.equal(
    buildLiveDecodePlan({ ...valid, width: 0 }, valid, 1, 200, 100),
    null
  );
});

test("live camera loop uses the forgiving plan and applies its deskew angle", async () => {
  const scannerSource = await readFile(
    new URL("../docs/scan.js", import.meta.url),
    "utf8"
  );
  assert.match(scannerSource, /const visible = visibleVideoCrop\(video\)/);
  assert.match(scannerSource, /const plan = buildLiveDecodePlan\(/);
  assert.match(
    scannerSource,
    /rotateCanvas\(canvas, rotatedCanvas, plan\.angle\)/
  );
});
