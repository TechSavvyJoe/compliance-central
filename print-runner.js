/**
 * Extension print host page.
 *
 * Chrome side panels often open a report tab via window.open() / iframe.print()
 * without ever showing the system print dialog. This page lives in its own tab,
 * reads HTML from chrome.storage.session, then calls print() in-document.
 */

import {
  consumePrintPayload,
  PRINT_TIMEOUT_MS,
  removeExpiredPrintPayloads,
  schedulePrint,
} from "./lib/print-html.js";

const params = new URLSearchParams(location.search);
const id = params.get("id") || "";

function fail(message) {
  document.body.textContent = message;
}

async function loadPayload() {
  if (!id || !chrome?.storage?.session) return null;
  try {
    return await consumePrintPayload(chrome.storage.session, id);
  } catch {
    return null;
  }
}

async function main() {
  const payload = await loadPayload();
  try {
    await removeExpiredPrintPayloads(chrome.storage.session);
  } catch {
    // Current payload has already been consumed; stale-job cleanup is best effort.
  }
  if (!payload || typeof payload.html !== "string" || !payload.html) {
    fail("Nothing to print. Close this tab and try Print again from Compliance Central.");
    return;
  }

  const waitForImages = Boolean(payload.waitForImages);
  document.open();
  document.write(payload.html);
  document.close();

  let closed = false;
  const closeSoon = () => {
    if (closed) return;
    closed = true;
    setTimeout(() => {
      try {
        window.close();
      } catch {
        // ignore
      }
    }, 250);
  };

  window.addEventListener("afterprint", closeSoon, { once: true });
  setTimeout(closeSoon, PRINT_TIMEOUT_MS);

  await schedulePrint(window, document, waitForImages, () => {
    try {
      window.focus();
      window.print();
    } catch {
      fail("Could not open the print dialog. Use File → Print (⌘P / Ctrl+P).");
    }
  });
}

main().catch(() => {
  fail("Could not prepare the print document. Close this tab and try again.");
});
