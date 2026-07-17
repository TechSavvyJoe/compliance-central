/**
 * Lightweight ImageData preprocessing for free PDF417 decode.
 * No OpenCV — pure typed-array ops that run in Node tests and browsers.
 *
 * Accepts either a real ImageData or a plain { width, height, data } buffer.
 */

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function asBuffer(image) {
  if (!image || !image.width || !image.height || !image.data) return null;
  return {
    width: image.width | 0,
    height: image.height | 0,
    data: image.data,
  };
}

/** Clone an image buffer (RGBA). */
export function cloneImageData(image) {
  const src = asBuffer(image);
  if (!src) return null;
  return {
    width: src.width,
    height: src.height,
    data: new Uint8ClampedArray(src.data),
  };
}

/** Convert to grayscale in-place (R=G=B=luma, A preserved). */
export function toGrayscale(image) {
  const src = asBuffer(image);
  if (!src) return null;
  const out = cloneImageData(src);
  const { data } = out;
  for (let i = 0; i < data.length; i += 4) {
    const y = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    data[i] = y;
    data[i + 1] = y;
    data[i + 2] = y;
  }
  return out;
}

/**
 * Percentile contrast stretch on luma. Low/high are 0–100.
 * Helps washed-out phone photos of glossy Michigan cards.
 */
export function contrastStretch(image, lowPct = 2, highPct = 98) {
  const gray = toGrayscale(image);
  if (!gray) return null;
  const { data } = gray;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) hist[data[i]]++;

  const total = (data.length / 4) | 0;
  const lowTarget = Math.max(0, Math.floor((total * lowPct) / 100));
  const highTarget = Math.min(total - 1, Math.floor((total * highPct) / 100));
  let low = 0;
  let high = 255;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= lowTarget) {
      low = v;
      break;
    }
  }
  seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= highTarget) {
      high = v;
      break;
    }
  }
  if (high <= low) return gray;

  const scale = 255 / (high - low);
  for (let i = 0; i < data.length; i += 4) {
    const y = clampByte(Math.round((data[i] - low) * scale));
    data[i] = y;
    data[i + 1] = y;
    data[i + 2] = y;
  }
  return gray;
}

/** Simple box blur used by unsharp mask (radius 1). */
function boxBlurGray(src) {
  const { width, height, data } = src;
  const out = new Uint8ClampedArray(data.length);
  out.set(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += data[((y + dy) * width + (x + dx)) * 4];
        }
      }
      const yv = (sum / 9) | 0;
      const i = (y * width + x) * 4;
      out[i] = yv;
      out[i + 1] = yv;
      out[i + 2] = yv;
      out[i + 3] = data[i + 3];
    }
  }
  return { width, height, data: out };
}

/**
 * Unsharp mask on grayscale. Amount ~1.0–1.8 sharpens PDF417 module edges.
 */
export function unsharpMask(image, amount = 1.35) {
  const gray = toGrayscale(image);
  if (!gray) return null;
  const blur = boxBlurGray(gray);
  const { data } = gray;
  const b = blur.data;
  for (let i = 0; i < data.length; i += 4) {
    const y = clampByte(Math.round(data[i] + amount * (data[i] - b[i])));
    data[i] = y;
    data[i + 1] = y;
    data[i + 2] = y;
  }
  return gray;
}

/** Invert luma (useful when the barcode is light-on-dark in a crop). */
export function invertLuma(image) {
  const gray = toGrayscale(image);
  if (!gray) return null;
  const { data } = gray;
  for (let i = 0; i < data.length; i += 4) {
    const y = 255 - data[i];
    data[i] = y;
    data[i + 1] = y;
    data[i + 2] = y;
  }
  return gray;
}

/**
 * Local adaptive threshold. blockSize must be odd (>= 3).
 * Writes black/white modules that zxing often prefers under glare.
 */
export function adaptiveThreshold(image, blockSize = 15, bias = 8) {
  const gray = toGrayscale(image);
  if (!gray) return null;
  const size = Math.max(3, blockSize | 0);
  const odd = size % 2 === 0 ? size + 1 : size;
  const half = (odd / 2) | 0;
  const { width, height, data } = gray;
  const out = new Uint8ClampedArray(data.length);
  out.set(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      const y0 = Math.max(0, y - half);
      const y1 = Math.min(height - 1, y + half);
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width - 1, x + half);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          sum += data[(yy * width + xx) * 4];
          count++;
        }
      }
      const mean = sum / count;
      const i = (y * width + x) * 4;
      const yv = data[i] < mean - bias ? 0 : 255;
      out[i] = yv;
      out[i + 1] = yv;
      out[i + 2] = yv;
      out[i + 3] = data[i + 3];
    }
  }
  return { width, height, data: out };
}

/**
 * Nearest-neighbor scale. scale > 1 enlarges; < 1 shrinks.
 */
export function scaleImageData(image, scale) {
  const src = asBuffer(image);
  if (!src || !(scale > 0)) return null;
  if (Math.abs(scale - 1) < 0.001) return cloneImageData(src);
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, ((y / height) * src.height) | 0);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, ((x / width) * src.width) | 0);
      const si = (sy * src.width + sx) * 4;
      const di = (y * width + x) * 4;
      data[di] = src.data[si];
      data[di + 1] = src.data[si + 1];
      data[di + 2] = src.data[si + 2];
      data[di + 3] = src.data[si + 3];
    }
  }
  return { width, height, data };
}

/**
 * Named preprocess pipelines tried against each ROI before zxing-wasm.
 * Order is tuned for glossy Michigan DL backs on iPhone photos.
 */
export const PREPROCESS_PIPELINES = [
  "raw",
  "stretch",
  "stretch-unsharp",
  "adaptive-15",
  "adaptive-21",
  "invert-stretch",
];

/**
 * Apply a named pipeline. Returns a new buffer (never mutates input).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image
 * @param {string} name
 */
export function applyPreprocess(image, name) {
  switch (name) {
    case "raw":
      return cloneImageData(image);
    case "stretch":
      return contrastStretch(image);
    case "stretch-unsharp": {
      const stretched = contrastStretch(image);
      return stretched ? unsharpMask(stretched, 1.35) : null;
    }
    case "adaptive-15": {
      const stretched = contrastStretch(image);
      return stretched ? adaptiveThreshold(stretched, 15, 7) : null;
    }
    case "adaptive-21": {
      const stretched = contrastStretch(image);
      return stretched ? adaptiveThreshold(stretched, 21, 10) : null;
    }
    case "invert-stretch": {
      const inv = invertLuma(image);
      return inv ? contrastStretch(inv) : null;
    }
    default:
      return cloneImageData(image);
  }
}

/**
 * Build the list of ImageData variants to decode for one ROI.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image
 * @param {{ scales?: number[], pipelines?: string[] }} [opts]
 */
export function buildDecodeVariants(image, opts = {}) {
  const src = asBuffer(image);
  if (!src) return [];
  const scales = opts.scales || [1, 0.85, 1.2];
  const pipelines = opts.pipelines || PREPROCESS_PIPELINES;
  const variants = [];
  const seen = new Set();

  for (const scale of scales) {
    const scaled = scaleImageData(src, scale);
    if (!scaled) continue;
    for (const name of pipelines) {
      // Skip expensive adaptive passes on down/upscales except primary scale.
      if (scale !== 1 && String(name).startsWith("adaptive")) continue;
      const processed = applyPreprocess(scaled, name);
      if (!processed) continue;
      const key = `${processed.width}x${processed.height}:${name}:${scale}`;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ name, scale, image: processed });
    }
  }
  return variants;
}
