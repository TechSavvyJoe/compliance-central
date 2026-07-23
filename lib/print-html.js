/**
 * Reliable print helpers for Chrome MV3 side panels.
 *
 * window.open() + print() from the side panel often opens a report tab but
 * never shows the system print dialog. Prefer a dedicated print-runner tab that
 * calls print() in-document, then fall back to a same-document iframe / popup.
 */

export const PRINT_TIMEOUT_MS = 5 * 60 * 1000;
export const PRINT_PAYLOAD_TTL_MS = PRINT_TIMEOUT_MS;
export const PRINT_STORAGE_PREFIX = "ccPrint:";

/**
 * @param {string} html
 * @returns {boolean}
 */
export function htmlContainsImages(html) {
  return typeof html === "string" && /<img\b/i.test(html);
}

/**
 * @returns {string}
 */
export function createPrintJobId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${PRINT_STORAGE_PREFIX}${crypto.randomUUID()}`;
  }
  return `${PRINT_STORAGE_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createPrintPayload(html, waitForImages, now = Date.now()) {
  return {
    html,
    waitForImages: Boolean(waitForImages),
    createdAt: now,
    expiresAt: now + PRINT_PAYLOAD_TTL_MS,
  };
}

export function isConsumablePrintPayload(payload, now = Date.now()) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      typeof payload.html === "string" &&
      payload.html.length > 0 &&
      Number.isFinite(payload.createdAt) &&
      Number.isFinite(payload.expiresAt) &&
      payload.createdAt <= now &&
      payload.expiresAt > now &&
      payload.expiresAt - payload.createdAt <= PRINT_PAYLOAD_TTL_MS
  );
}

/**
 * Read-once print payload consumption. Removal is attempted even when reading
 * or validation fails so sensitive report HTML cannot linger after a request.
 */
export async function consumePrintPayload(storage, id, now = Date.now()) {
  let payload = null;
  try {
    const bag = await storage.get(id);
    payload = bag?.[id] || null;
  } finally {
    try {
      await storage.remove(id);
    } catch {
      // Best effort: the caller still rejects malformed/expired payloads.
    }
  }
  return isConsumablePrintPayload(payload, now) ? payload : null;
}

/**
 * Remove expired print jobs left behind by a closed side panel or tab.
 */
export async function removeExpiredPrintPayloads(storage, now = Date.now()) {
  const bag = await storage.get(null);
  const expired = Object.entries(bag || {})
    .filter(
      ([key, value]) =>
        key.startsWith(PRINT_STORAGE_PREFIX) &&
        !isConsumablePrintPayload(value, now)
    )
    .map(([key]) => key);
  if (expired.length > 0) {
    await storage.remove(expired);
  }
  return expired;
}

/**
 * @param {Document} doc
 * @returns {Promise<void>}
 */
export function waitForDocumentImages(doc) {
  const images = [...doc.querySelectorAll("img")];
  if (images.length === 0) return Promise.resolve();

  return Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          setTimeout(done, 3000);
        })
    )
  ).then(() => undefined);
}

/**
 * Run after the next two animation frames so layout/paint settle before print().
 * @param {() => void} fn
 */
export function afterNextPaint(fn) {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(fn, 50);
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(fn);
  });
}

/**
 * @param {Window} win
 * @param {Document} doc
 * @param {boolean} waitForImages
 * @param {() => void} triggerPrint
 */
export async function schedulePrint(win, doc, waitForImages, triggerPrint) {
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    if (waitForImages) await waitForDocumentImages(doc);
    afterNextPaint(triggerPrint);
  };

  if (doc.readyState === "complete") {
    await start();
    return;
  }

  await new Promise((resolve) => {
    const go = () => {
      start().then(resolve);
    };
    win.addEventListener("load", go, { once: true });
    // readyState can flip to complete between the check and the listener.
    if (doc.readyState === "complete") go();
  });
}
