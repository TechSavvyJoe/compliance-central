/**
 * Module worker: preprocess ImageData variants and decode PDF417 with zxing-wasm.
 * Keeps the scan UI responsive while trying many free-pipeline passes.
 */

import { buildDecodeVariants } from "./scan-preprocess.js?v=20260717-7";
import { decodePdf417Wasm, ensureWasmReader } from "./zxing-wasm-loader.js?v=20260717-7";

let wasmReady = false;

async function decodeBuffer(width, height, buffer, opts = {}) {
  const data = new Uint8ClampedArray(buffer);
  const image = { width, height, data };
  const variants = buildDecodeVariants(image, {
    scales: opts.scales || [1, 0.85, 1.15],
    pipelines: opts.pipelines,
  });

  const texts = [];
  const seen = new Set();

  if (!wasmReady) {
    wasmReady = await ensureWasmReader();
  }

  for (const variant of variants) {
    const img = variant.image;
    if (!img) continue;
    try {
      const found = await decodePdf417Wasm(img);
      for (const text of found || []) {
        if (!text || seen.has(text)) continue;
        seen.add(text);
        texts.push(text);
      }
    } catch {
      // try next variant
    }
    if (texts.length) break;
  }

  return texts;
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type === "ping") {
    self.postMessage({ type: "pong", id: msg.id });
    return;
  }
  if (msg.type === "warmup") {
    wasmReady = await ensureWasmReader();
    self.postMessage({ type: "ready", id: msg.id, ok: wasmReady });
    return;
  }
  if (msg.type !== "decode") return;

  try {
    const texts = await decodeBuffer(msg.width, msg.height, msg.buffer, msg.opts || {});
    self.postMessage({ type: "result", id: msg.id, texts });
  } catch (error) {
    self.postMessage({
      type: "result",
      id: msg.id,
      texts: [],
      error: error && error.message ? error.message : "decode-failed",
    });
  }
};
