/**
 * Local zxing-wasm (ZXing-C++) reader, vendored under docs/lib/zxing-wasm.
 * Loads the WASM from the same origin so GitHub Pages works offline-ish.
 */

import {
  prepareZXingModule,
  readBarcodes,
  readBarcodesFromImageData,
} from "./zxing-wasm/reader.js?v=20260717-10";

let readyPromise = null;

export const MAX_PDF417_SOURCE_BYTES = 15 * 1024 * 1024;
export const MAX_PDF417_IMAGE_PIXELS = 8_000_000;

const WASM_URL = new URL(
  "./zxing-wasm/zxing_reader.wasm?v=20260717-10",
  import.meta.url
).href;

const PDF417_OPTIONS = {
  formats: ["PDF417"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
  textMode: "Plain",
};

/**
 * Options for prepareZXingModule. fireImmediately must be true — without it the
 * library only stores overrides and returns undefined (not a Promise).
 * @param {string} wasmUrl
 */
export function buildPrepareOptions(wasmUrl) {
  return {
    overrides: {
      locateFile: (path, prefix) => {
        if (String(path).endsWith(".wasm")) return wasmUrl;
        return `${prefix || ""}${path}`;
      },
    },
    fireImmediately: true,
  };
}

/**
 * Ensure the WASM module is compiled. Safe to call repeatedly.
 * Never throws — returns false when the reader cannot load.
 * @returns {Promise<boolean>} true when the reader is usable
 */
export function ensureWasmReader(
  prepareOptions = buildPrepareOptions(WASM_URL)
) {
  if (!readyPromise) {
    try {
      const prepared = prepareZXingModule(prepareOptions);
      readyPromise = Promise.resolve(prepared)
        .then(() => true)
        .catch((err) => {
          console.warn("zxing-wasm failed to load", err);
          readyPromise = null;
          return false;
        });
    } catch (err) {
      console.warn("zxing-wasm failed to start", err);
      // A transient fetch/compile failure must not poison every later retry.
      readyPromise = null;
      return Promise.resolve(false);
    }
  }
  return readyPromise;
}

function collectPdf417Texts(results, texts, seen) {
  for (const result of results || []) {
    const text = result && typeof result.text === "string" ? result.text : "";
    if (!text || seen.has(text)) continue;
    const format = String(result.format || "").toLowerCase();
    if (format && format !== "pdf417" && format !== "compactpdf417") continue;
    seen.add(text);
    texts.push(text);
  }
}

/**
 * Decode PDF417 from an ImageData ROI. Tries a couple of binarizers when the
 * first pass misses — glare on Michigan cards is common.
 * @param {ImageData} imageData
 * @returns {Promise<string[]>}
 */
export async function decodePdf417Wasm(imageData) {
  if (!imageData || !imageData.width || !imageData.height) return [];
  const pixels = imageData.width * imageData.height;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels <= 0 ||
    pixels > MAX_PDF417_IMAGE_PIXELS ||
    !imageData.data ||
    imageData.data.length < pixels * 4
  ) {
    return [];
  }
  const ok = await ensureWasmReader();
  if (!ok) return [];

  const texts = [];
  const seen = new Set();
  const binarizers = ["LocalAverage", "GlobalHistogram"];

  for (const binarizer of binarizers) {
    try {
      const results = await readBarcodesFromImageData(imageData, {
        ...PDF417_OPTIONS,
        binarizer,
      });
      collectPdf417Texts(results, texts, seen);
      if (texts.length) break;
    } catch {
      // try next binarizer
    }
  }
  return texts;
}

/**
 * Decode the original uploaded image before any canvas resize/crop. This is the
 * most faithful photo path and is independent of the live-camera scheduler.
 * @param {Blob|File|ArrayBuffer|Uint8Array} source
 * @param {object} [prepareOptions] optional module options (used by Node tests)
 * @returns {Promise<string[]>}
 */
export async function decodePdf417File(source, prepareOptions) {
  if (!source) return [];
  const byteLength = Number(
    typeof source.size === "number" ? source.size : source.byteLength
  );
  if (
    !Number.isFinite(byteLength) ||
    byteLength <= 0 ||
    byteLength > MAX_PDF417_SOURCE_BYTES
  ) {
    return [];
  }
  const ok = await ensureWasmReader(prepareOptions);
  if (!ok) return [];

  const texts = [];
  const seen = new Set();
  for (const binarizer of ["LocalAverage", "GlobalHistogram"]) {
    try {
      const results = await readBarcodes(source, {
        ...PDF417_OPTIONS,
        binarizer,
      });
      collectPdf417Texts(results, texts, seen);
      if (texts.length) break;
    } catch {
      // The canvas-based photo fallback can still try after this returns [].
    }
  }
  return texts;
}
