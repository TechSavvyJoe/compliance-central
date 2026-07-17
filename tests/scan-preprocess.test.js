import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptiveThreshold,
  applyPreprocess,
  buildDecodeVariants,
  contrastStretch,
  invertLuma,
  scaleImageData,
  toGrayscale,
  unsharpMask,
} from "../docs/lib/scan-preprocess.js";
import {
  buildPhotoDecodeCrops,
  focusPdf417Band,
} from "../docs/lib/scan-roi.js";
import {
  acceptLicenseScan,
  evaluateDetection,
} from "../docs/lib/aamva.js";

function solidImage(width, height, r, g, b) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** Low-contrast gray ramp so stretch/threshold have something to do. */
function rampImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = 40 + Math.round((x / Math.max(1, width - 1)) * 80);
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const MI_DL =
  "@\n\u001e\rANSI 636032100002DL00410234\nDLDAQS123456789012\nDCSGALLANT\nDDEN\nDACJOSEPH\nDDFN\nDADJOHN\nDDGN\nDCUJR\nDBB08081985\nDAJMI\n\r";

test("toGrayscale collapses RGB to luma", () => {
  const img = solidImage(2, 2, 255, 0, 0);
  const gray = toGrayscale(img);
  assert.equal(gray.data[0], gray.data[1]);
  assert.equal(gray.data[1], gray.data[2]);
  assert.ok(gray.data[0] > 50);
});

test("contrastStretch expands a low-contrast ramp toward 0–255", () => {
  const img = rampImage(32, 8);
  const stretched = contrastStretch(img, 2, 98);
  let min = 255;
  let max = 0;
  for (let i = 0; i < stretched.data.length; i += 4) {
    min = Math.min(min, stretched.data[i]);
    max = Math.max(max, stretched.data[i]);
  }
  assert.ok(max - min > 150);
});

test("unsharpMask and adaptiveThreshold return same dimensions", () => {
  const img = rampImage(24, 12);
  const sharp = unsharpMask(img, 1.2);
  const thr = adaptiveThreshold(img, 9, 5);
  assert.equal(sharp.width, 24);
  assert.equal(thr.height, 12);
  assert.equal(thr.data.length, img.data.length);
});

test("invertLuma flips black and white", () => {
  const img = solidImage(1, 1, 0, 0, 0);
  const inv = invertLuma(img);
  assert.equal(inv.data[0], 255);
});

test("scaleImageData resizes nearest-neighbor", () => {
  const img = solidImage(10, 4, 10, 20, 30);
  const up = scaleImageData(img, 2);
  assert.equal(up.width, 20);
  assert.equal(up.height, 8);
});

test("buildDecodeVariants produces named pipelines without adaptive on rescales", () => {
  const img = rampImage(16, 8);
  const variants = buildDecodeVariants(img, {
    scales: [1, 0.85],
    pipelines: ["raw", "stretch", "adaptive-15"],
  });
  assert.ok(variants.length >= 3);
  assert.ok(variants.some((v) => v.name === "raw" && v.scale === 1));
  assert.ok(!variants.some((v) => v.name === "adaptive-15" && v.scale !== 1));
  assert.ok(applyPreprocess(img, "stretch-unsharp"));
});

test("buildPhotoDecodeCrops keeps bottom PDF417 bands and full-frame fallback", () => {
  const full = { x: 0, y: 0, width: 1000, height: 600 };
  const crops = buildPhotoDecodeCrops(full, 1000);
  assert.ok(crops.length >= 5);
  assert.ok(crops.some((c) => c.width === 1000 && c.height === 600));
  assert.ok(crops.every((c) => c.y >= 0 && c.y + c.height <= 600));
  // Bottom-heavy bands should sit below the top 1D strip region.
  const bottoms = crops.filter((c) => c.height < 600);
  assert.ok(bottoms.every((c) => c.y > 50));
});

test("focusPdf417Band with bottomKeep excludes upper 1D strip", () => {
  const guide = { x: 0, y: 0, width: 800, height: 200 };
  const band = focusPdf417Band(guide, { bottomKeep: 0.55 });
  assert.equal(band.height, 110);
  assert.equal(band.y, 90);
});

test("AAMVA acceptance requires complete Michigan identity fields", () => {
  const person = acceptLicenseScan(MI_DL);
  assert.ok(person);
  assert.equal(person.isMichigan, true);
  assert.equal(person.jurisdiction, "MI");
  assert.equal(person.dlnPid, "S123456789012");

  const ok = evaluateDetection(MI_DL);
  assert.equal(ok.ok, true);

  const partial = evaluateDetection(
    "@\n\u001e\rANSI 636032100002DL00410234\nDLDAQS123456789012\n"
  );
  assert.equal(partial.ok, false);
  assert.equal(partial.reason, "incomplete");
});
