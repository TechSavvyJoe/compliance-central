/**
 * Main-thread client for the free PDF417 decode worker, with same-thread fallback.
 */

import { buildDecodeVariants } from "./scan-preprocess.js?v=20260717-7";
import { decodePdf417Wasm, ensureWasmReader } from "./zxing-wasm-loader.js?v=20260717-7";

let worker = null;
let workerFailed = false;
let seq = 0;
const pending = new Map();

function workerUrl() {
  return new URL("./scan-decode-worker.js?v=20260717-7", import.meta.url);
}

function settle(id, payload) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  entry.resolve(payload);
}

function attachWorker(w) {
  w.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === "result" || msg.type === "ready" || msg.type === "pong") {
      settle(msg.id, msg);
    }
  };
  w.onerror = () => {
    workerFailed = true;
    for (const [id] of pending) {
      settle(id, { type: "result", id, texts: [], error: "worker-error" });
    }
    try { w.terminate(); } catch {}
    worker = null;
  };
}

function ensureWorker() {
  if (workerFailed) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") {
    workerFailed = true;
    return null;
  }
  try {
    worker = new Worker(workerUrl(), { type: "module" });
    attachWorker(worker);
    return worker;
  } catch {
    workerFailed = true;
    worker = null;
    return null;
  }
}

function post(type, extra = {}) {
  const w = ensureWorker();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    try {
      const message = { type, id, ...extra };
      if (extra.buffer) {
        w.postMessage(message, [extra.buffer]);
      } else {
        w.postMessage(message);
      }
    } catch {
      pending.delete(id);
      resolve(null);
    }
  });
}

/** Warm the worker + WASM without blocking the UI. */
export function warmupDecodeWorker() {
  return post("warmup").then((msg) => Boolean(msg && msg.ok));
}

async function decodeOnMainThread(imageData, opts = {}) {
  await ensureWasmReader();
  const variants = buildDecodeVariants(imageData, {
    scales: opts.scales || [1, 0.85, 1.15],
    pipelines: opts.pipelines,
  });
  const texts = [];
  const seen = new Set();
  for (const variant of variants) {
    try {
      const found = await decodePdf417Wasm(variant.image);
      for (const text of found || []) {
        if (!text || seen.has(text)) continue;
        seen.add(text);
        texts.push(text);
      }
    } catch {
      // continue
    }
    if (texts.length) break;
  }
  return texts;
}

/**
 * Decode PDF417 from ImageData using the worker when available.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData
 * @param {object} [opts]
 * @returns {Promise<string[]>}
 */
export async function decodeImageDataFree(imageData, opts = {}) {
  if (!imageData || !imageData.width || !imageData.height) return [];

  // Keep a non-transferred copy for main-thread fallback.
  const fallback = new Uint8ClampedArray(imageData.data);
  const transfer = new Uint8ClampedArray(imageData.data);
  const response = await post("decode", {
    width: imageData.width,
    height: imageData.height,
    buffer: transfer.buffer,
    opts,
  });

  if (response && Array.isArray(response.texts) && !response.error) {
    return response.texts;
  }
  if (response && Array.isArray(response.texts) && response.texts.length) {
    return response.texts;
  }

  // Worker unavailable or failed — same pipeline on the main thread.
  return decodeOnMainThread(
    { width: imageData.width, height: imageData.height, data: fallback },
    opts
  );
}
