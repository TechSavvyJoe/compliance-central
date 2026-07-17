/**
 * Local zxing-wasm (ZXing-C++) reader, vendored under docs/lib/zxing-wasm.
 * Loads the WASM from the same origin so GitHub Pages works offline-ish.
 */

import {
  prepareZXingModule,
  readBarcodesFromImageData,
} from "./zxing-wasm/reader.js?v=20260717-8";

let readyPromise = null;

const WASM_URL = new URL(
  "./zxing-wasm/zxing_reader.wasm?v=20260717-8",
  import.meta.url
).href;

const PDF417_OPTIONS = {
  formats: ["PDF417"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
  textMode: "Plain",
  binarizer: "LocalAverage",
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
export function ensureWasmReader() {
  if (!readyPromise) {
    try {
      const prepared = prepareZXingModule(buildPrepareOptions(WASM_URL));
      readyPromise = Promise.resolve(prepared)
        .then(() => true)
        .catch((err) => {
          console.warn("zxing-wasm failed to load", err);
          readyPromise = null;
          return false;
        });
    } catch (err) {
      console.warn("zxing-wasm failed to start", err);
      readyPromise = Promise.resolve(false);
    }
  }
  return readyPromise;
}

/**
 * Decode PDF417 from an ImageData ROI. Tries a couple of binarizers when the
 * first pass misses — glare on Michigan cards is common.
 * @param {ImageData} imageData
 * @returns {Promise<string[]>}
 */
export async function decodePdf417Wasm(imageData) {
  if (!imageData || !imageData.width || !imageData.height) return [];
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
      for (const result of results || []) {
        const text = result && typeof result.text === "string" ? result.text : "";
        if (!text || seen.has(text)) continue;
        const format = String(result.format || "").toLowerCase();
        if (format && format !== "pdf417") continue;
        seen.add(text);
        texts.push(text);
      }
    } catch {
      // try next binarizer
    }
  }
  return texts;
}
