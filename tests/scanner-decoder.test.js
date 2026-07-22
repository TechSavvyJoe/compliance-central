import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

import { acceptLicenseScan } from "../docs/lib/aamva.js";
import {
  decodePdf417File,
  decodePdf417Wasm,
  ensureWasmReader,
  MAX_PDF417_IMAGE_PIXELS,
  MAX_PDF417_SOURCE_BYTES,
} from "../docs/lib/zxing-wasm-loader.js";
import { ZXING_WASM_SHA256 } from "../docs/lib/zxing-wasm/reader.js";

const WASM_URL = new URL(
  "../docs/lib/zxing-wasm/zxing_reader.wasm",
  import.meta.url
);
// Generated once with zxing-wasm 3.1.1's PDF417 writer from synthetic data;
// contains no real customer or license information.
const FIXTURE_URL = new URL(
  "./fixtures/synthetic-mi-license-pdf417.base64",
  import.meta.url
);
const DEMO_ART_URLS = [
  new URL("../docs/images/mi-id-front-demo.webp", import.meta.url),
  new URL("../docs/images/mi-id-back-demo.webp", import.meta.url),
];

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

// This deliberately tiny PNG reader supports the fixture's 8-bit grayscale,
// non-interlaced encoding. It keeps the live ImageData regression dependency
// free while letting the test reposition and rotate the real barcode pixels.
function decodeGrayscalePng(png) {
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "fixture must remain a PNG"
  );

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const compressed = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  assert.equal(bitDepth, 8, "fixture must use 8-bit samples");
  assert.equal(colorType, 0, "fixture must remain grayscale");
  assert.equal(interlace, 0, "fixture must remain non-interlaced");
  assert.ok(width > 0 && height > 0 && compressed.length > 0);

  const filtered = inflateSync(Buffer.concat(compressed));
  const gray = new Uint8Array(width * height);
  let input = 0;

  for (let y = 0; y < height; y++) {
    const filter = filtered[input++];
    for (let x = 0; x < width; x++) {
      const source = filtered[input++];
      const index = y * width + x;
      const left = x > 0 ? gray[index - 1] : 0;
      const above = y > 0 ? gray[index - width] : 0;
      const upperLeft = x > 0 && y > 0 ? gray[index - width - 1] : 0;
      let value;
      if (filter === 0) value = source;
      else if (filter === 1) value = source + left;
      else if (filter === 2) value = source + above;
      else if (filter === 3) value = source + Math.floor((left + above) / 2);
      else if (filter === 4) {
        value = source + paethPredictor(left, above, upperLeft);
      } else {
        assert.fail(`unsupported PNG row filter ${filter}`);
      }
      gray[index] = value & 0xff;
    }
  }

  assert.equal(input, filtered.length);
  return { width, height, gray };
}

function placeOffCenterAndRotateClockwise(source) {
  const width = 1000;
  const height = 1200;
  const offsetX = 80;
  const offsetY = 330;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const targetX = offsetX + source.height - 1 - y;
      const targetY = offsetY + x;
      const target = (targetY * width + targetX) * 4;
      const gray = source.gray[y * source.width + x];
      data[target] = gray;
      data[target + 1] = gray;
      data[target + 2] = gray;
    }
  }

  return {
    width,
    height,
    data,
    barcodeBounds: {
      x: offsetX,
      y: offsetY,
      width: source.height,
      height: source.width,
    },
  };
}

function placeOffCenter(source) {
  const width = 1400;
  const height = 900;
  const offsetX = 320;
  const offsetY = 300;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const target = ((offsetY + y) * width + offsetX + x) * 4;
      const gray = source.gray[y * source.width + x];
      data[target] = gray;
      data[target + 1] = gray;
      data[target + 2] = gray;
    }
  }
  return { width, height, data };
}

// Mirrors the scanner's canvas rotation with a deterministic nearest-neighbor
// compositor. The generous white canvas prevents the tilted barcode clipping.
function rotateImage(image, degrees) {
  const { width, height } = image;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const relativeX = x - centerX;
      const relativeY = y - centerY;
      const sourceX = Math.round(
        cosine * relativeX + sine * relativeY + centerX
      );
      const sourceY = Math.round(
        -sine * relativeX + cosine * relativeY + centerY
      );
      if (
        sourceX < 0 ||
        sourceY < 0 ||
        sourceX >= width ||
        sourceY >= height
      ) {
        continue;
      }
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = image.data[sourceIndex];
      data[targetIndex + 1] = image.data[sourceIndex + 1];
      data[targetIndex + 2] = image.data[sourceIndex + 2];
    }
  }

  return { width, height, data };
}

test("vendored WASM decodes a synthetic Michigan license photo end to end", async () => {
  const wasm = await readFile(WASM_URL);
  assert.equal(
    createHash("sha256").update(wasm).digest("hex"),
    ZXING_WASM_SHA256,
    "reader.js and zxing_reader.wasm must be the same published build"
  );

  const encoded = await readFile(FIXTURE_URL, "utf8");
  const png = Buffer.from(encoded.replace(/\s/g, ""), "base64");
  const decodedPayloads = await decodePdf417File(png, {
    overrides: { wasmBinary: wasm },
    fireImmediately: true,
  });

  const decoded = decodedPayloads[0];
  assert.ok(decoded, "synthetic uploaded PNG should produce a PDF417 result");
  assert.match(decoded, /ANSI\s*636032/);

  const person = acceptLicenseScan(decoded);
  assert.ok(person, "decoded bytes should pass the production AAMVA gate");
  assert.deepEqual(
    {
      firstName: person.firstName,
      middleName: person.middleName,
      lastName: person.lastName,
      dob: person.dob,
      dlnPid: person.dlnPid,
      isMichigan: person.isMichigan,
    },
    {
      firstName: "PAT",
      middleName: "ALEX",
      lastName: "SAMPLE",
      dob: "08/08/1985",
      dlnPid: "S 123 456 789 012",
      isMichigan: true,
    }
  );
});

test("fictional scanner guidance art does not contain a decodable PDF417", async () => {
  const wasm = await readFile(WASM_URL);
  for (const assetUrl of DEMO_ART_URLS) {
    const image = await readFile(assetUrl);
    const decodedPayloads = await decodePdf417File(image, {
      overrides: { wasmBinary: wasm },
      fireImmediately: true,
    });
    assert.deepEqual(
      decodedPayloads,
      [],
      `${assetUrl.pathname.split("/").pop()} must remain non-scannable training art`
    );
  }
});

test("live ImageData decoder accepts a padded, off-center, rotated barcode", async () => {
  const wasm = await readFile(WASM_URL);
  assert.equal(
    await ensureWasmReader({
      overrides: { wasmBinary: wasm },
      fireImmediately: true,
    }),
    true
  );

  const encoded = await readFile(FIXTURE_URL, "utf8");
  const source = decodeGrayscalePng(
    Buffer.from(encoded.replace(/\s/g, ""), "base64")
  );
  const image = placeOffCenterAndRotateClockwise(source);

  assert.ok(image.barcodeBounds.x > 0, "barcode should not be left-aligned");
  assert.ok(image.barcodeBounds.y > 0, "barcode should not be top-aligned");
  assert.ok(
    image.barcodeBounds.x + image.barcodeBounds.width < image.width,
    "barcode should have right-side framing slack"
  );
  assert.ok(
    image.barcodeBounds.y + image.barcodeBounds.height < image.height,
    "barcode should have bottom framing slack"
  );

  const decodedPayloads = await decodePdf417Wasm(image);
  assert.ok(decodedPayloads[0], "loosely framed live pixels should decode");
  assert.match(decodedPayloads[0], /ANSI\s*636032/);

  const person = acceptLicenseScan(decodedPayloads[0]);
  assert.equal(person?.dlnPid, "S 123 456 789 012");
  assert.equal(person?.isMichigan, true);
});

test("live tilt correction recovers off-center barcodes at plus or minus six degrees", async () => {
  const wasm = await readFile(WASM_URL);
  assert.equal(
    await ensureWasmReader({
      overrides: { wasmBinary: wasm },
      fireImmediately: true,
    }),
    true
  );
  const encoded = await readFile(FIXTURE_URL, "utf8");
  const source = decodeGrayscalePng(
    Buffer.from(encoded.replace(/\s/g, ""), "base64")
  );
  const framed = placeOffCenter(source);

  for (const tilt of [-6, 6]) {
    const cameraFrame = rotateImage(framed, tilt);
    const correctedFrame = rotateImage(cameraFrame, -tilt);
    const decodedPayloads = await decodePdf417Wasm(correctedFrame);
    assert.ok(decodedPayloads[0], `${tilt} degree tilt should decode`);
    const person = acceptLicenseScan(decodedPayloads[0]);
    assert.equal(person?.dlnPid, "S 123 456 789 012");
  }
});

test("decoder rejects oversized or malformed sources before WASM allocation", async () => {
  assert.deepEqual(
    await decodePdf417File({ byteLength: MAX_PDF417_SOURCE_BYTES + 1 }),
    []
  );
  assert.deepEqual(
    await decodePdf417Wasm({
      width: MAX_PDF417_IMAGE_PIXELS + 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    }),
    []
  );
  assert.deepEqual(
    await decodePdf417Wasm({
      width: 10,
      height: 10,
      data: new Uint8ClampedArray(4),
    }),
    []
  );
});
