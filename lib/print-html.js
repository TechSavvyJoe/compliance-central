/**
 * Reliable print helpers for Chrome MV3 side panels.
 *
 * window.open() + print() from the side panel often opens a report tab but
 * never shows the system print dialog. Prefer a dedicated print-runner tab that
 * calls print() in-document, then fall back to a same-document iframe / popup.
 */

export const PRINT_TIMEOUT_MS = 5 * 60 * 1000;
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
