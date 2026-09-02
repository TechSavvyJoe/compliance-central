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

/* ------------------------------------------------------------------ *
 * Printed-document design system
 *
 * Every page this product puts on paper — the deal jacket, the per-check
 * records, the plate-fee worksheet, the SOS evidence sheet — is drawn from
 * this one set of values, so a dealership's file reads as one firm's
 * paperwork rather than four unrelated templates.
 *
 * Eight colours, three faces, six type sizes, three rule weights, one radius,
 * one six-step spacing scale, one page margin. Anything a printed surface
 * needs that is not here is a bug in the surface, not a missing token.
 * ------------------------------------------------------------------ */

/**
 * The brand palette the panel is drawn in, plus the two status hues a
 * compliance record cannot do without (a pass and a denial must not be
 * distinguishable only by the word). One navy, one ink, one slate, one line:
 * the smallest text on paper is set in slate, which carries 7.3:1 on white,
 * so nothing here needs to be read at less than AA.
 */
export const PRINT_COLORS = Object.freeze({
  navy: "#0d2b4a",
  gold: "#ffcb05",
  ink: "#101c2b",
  slate: "#46586b",
  line: "#d5dee8",
  paper: "#ffffff",
  // 6.6:1 on white, and deliberately matched in weight to `alert` so neither
  // outcome shouts louder than the other.
  ok: "#0f6b3d",
  // The app's own strong danger tone, so a printed denial and an on-screen
  // error are the same red.
  alert: "#b3261e",
});

/** `#0d2b4a` -> `[13, 43, 74]`, so jsPDF draws from the same palette as CSS. */
export function printRgb(hex) {
  const value = String(hex).replace("#", "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
}

/**
 * The three faces the panel is set in, shipped inside the extension. The
 * print runner is an extension page, so it can reach them; the document HTML
 * only ever names the families, and each stack below ends in a system face
 * for the about:blank and iframe fallbacks, which cannot.
 */
export const PRINT_FONT_FACES = Object.freeze([
  Object.freeze({
    family: "Archivo",
    file: "assets/fonts/archivo-latin-variable.woff2",
    weight: "400 800",
  }),
  Object.freeze({
    family: "Bricolage Grotesque",
    file: "assets/fonts/bricolage-grotesque-latin-variable.woff2",
    weight: "600 800",
  }),
  Object.freeze({
    family: "JetBrains Mono",
    file: "assets/fonts/jetbrains-mono-latin-variable.woff2",
    weight: "400 600",
  }),
]);

/** Body copy, labels, tables. */
export const PRINT_FONT_STACK =
  '"Archivo", "Helvetica Neue", Helvetica, Arial, sans-serif';
/** The masthead and the verdict word: the two things a page is remembered by. */
export const PRINT_DISPLAY_STACK =
  '"Bricolage Grotesque", "Archivo", Helvetica, sans-serif';
/** VINs, licence numbers, and anything else that is read one character at a time. */
export const PRINT_MONO_STACK = '"JetBrains Mono", ui-monospace, Menlo, monospace';

/**
 * The @font-face rules for the shipped faces, with each file's URL resolved
 * by the host page — chrome.runtime.getURL in the print runner. Injected into
 * the printed document after it is written, since document.write() discards
 * any stylesheet the runner page carried.
 *
 * @param {(path: string) => string} resolveUrl
 * @returns {string}
 */
export function printFontFaceCSS(resolveUrl) {
  return PRINT_FONT_FACES.map(
    (face) =>
      `@font-face { font-family: "${face.family}"; src: url("${resolveUrl(face.file)}") format("woff2"); font-style: normal; font-weight: ${face.weight}; font-display: block; }`
  ).join("\n");
}

/**
 * Shared foundation: tokens, reset, the one type scale, the masthead, the one
 * table style, the status boxes, and the print-fidelity rules. Included by
 * every printed document; each document then adds only what is unique to it.
 */
export function printBaseCSS() {
  const c = PRINT_COLORS;
  return `
    :root {
      --navy: ${c.navy}; --gold: ${c.gold}; --ink: ${c.ink}; --slate: ${c.slate};
      --line: ${c.line}; --paper: ${c.paper}; --ok: ${c.ok}; --alert: ${c.alert};
      --font-body: ${PRINT_FONT_STACK};
      --font-display: ${PRINT_DISPLAY_STACK};
      --font-mono: ${PRINT_MONO_STACK};
      /* Six type sizes. Nothing on paper is set smaller than 7.5pt, and
         nothing that small is set in anything lighter than slate. */
      --t-micro: 7.5pt; --t-small: 8.5pt; --t-body: 9.5pt;
      --t-verdict: 13pt; --t-masthead: 16pt; --t-hero: 21pt;
      /* Three rule weights, each with one job: a hairline between rows, the
         gold masthead accent, and the heavy rule under a heading or total. */
      --rule: 0.75pt; --rule-accent: 1.5pt; --rule-heavy: 2.25pt; --radius: 2pt;
      /* Six-step spacing scale. */
      --s1: 3pt; --s2: 5pt; --s3: 8pt; --s4: 13pt; --s5: 18pt; --s6: 26pt;
    }
    /* One margin for every sheet, so a stacked deal file lines up. */
    @page { size: letter portrait; margin: 0.6in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; }
    body {
      background: var(--paper); color: var(--ink);
      font-family: var(--font-body);
      /* Physical units throughout: what is measured in points prints at the
         same size whatever DPI the driver reports. */
      font-size: var(--t-body); line-height: 1.45;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    p { margin: 0 0 var(--s2); }
    p:last-child { margin-bottom: 0; }
    ul { margin: var(--s2) 0 0 var(--s4); }
    li { margin: 0 0 var(--s1); overflow-wrap: anywhere; }
    strong { font-weight: 700; }
    img { max-width: 100%; }
    /* A reference — VIN, licence number, plate — reads one glyph at a time. */
    .ref {
      font-family: var(--font-mono); font-size: 9pt; font-weight: 500;
      letter-spacing: .02em; font-variant-numeric: tabular-nums;
    }

    /* --- Masthead: identical on every document --------------------- */
    .main-title {
      position: relative; margin: 0 0 var(--s4); padding-bottom: var(--s2);
      color: var(--navy); font-family: var(--font-display);
      font-size: var(--t-masthead); font-weight: 700; line-height: 1.15;
      letter-spacing: -0.015em;
      border-bottom: var(--rule-heavy) solid var(--navy);
      break-after: avoid; page-break-after: avoid;
    }
    /* The single gold accent: a hairline under the masthead rule. */
    .main-title::after {
      content: ""; position: absolute; right: 0; bottom: -3.75pt; left: 0;
      height: var(--rule-accent); background: var(--gold);
    }
    /* Same rule and accent as .main-title, split into two elements, for a
       masthead whose title sits beside something else — a dealership logo. */
    .masthead-rule { height: var(--rule-heavy); margin: var(--s2) 0 0; background: var(--navy); }
    .masthead-accent { height: var(--rule-accent); margin: 0 0 var(--s4); background: var(--gold); }
    .doc-sub { margin: 0 0 var(--s4); color: var(--slate); font-size: var(--t-small); }
    .doc-sub em { font-style: italic; }
    /* The one place a printed page shouts: the not-a-government-document
       notice that keeps these records honest. */
    .app-notice {
      margin: 0 0 var(--s2); color: var(--alert);
      font-size: var(--t-micro); font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    }
    /* Running head: who / what / when in the same three cells on every sheet,
       so a stack of them can be flipped through from the same spot. */
    .page-header {
      /* Equal sides around an auto centre keep the running head centred on
         the page, and on one line, whatever the sides carry. */
      display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: var(--s4); align-items: start;
      padding-bottom: var(--s2); margin-bottom: var(--s4);
      border-bottom: var(--rule) solid var(--line);
      color: var(--slate); font-size: var(--t-micro); line-height: 1.5;
    }
    .page-header > div { min-width: 0; overflow-wrap: anywhere; }
    .page-header strong { color: var(--ink); font-weight: 600; }
    .page-header .center {
      text-align: center; white-space: nowrap; color: var(--navy); font-weight: 700;
      letter-spacing: .08em; text-transform: uppercase;
    }
    .page-header .ref { font-size: 8pt; }
    .page-header .end { text-align: right; }

    /* --- One heading scale ---------------------------------------- */
    h2, h3, .section-title, .brands-title, .check-summary-title, .results-header {
      margin: var(--s5) 0 var(--s2);
      color: var(--navy); font-size: var(--t-small); font-weight: 700;
      letter-spacing: .1em; text-transform: uppercase;
      break-after: avoid; page-break-after: avoid;
    }
    .section-subtitle { margin: calc(-1 * var(--s1)) 0 var(--s4); color: var(--slate); font-size: var(--t-small); }

    /* --- One table style ------------------------------------------- */
    table { width: 100%; border-collapse: collapse; margin: 0 0 var(--s2); }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td {
      padding: var(--s2) 0; border-bottom: var(--rule) solid var(--line);
      text-align: left; vertical-align: top; font-size: var(--t-body);
      overflow-wrap: anywhere;
    }
    /* Labels are the lighter element; values carry the weight. */
    th { color: var(--slate); font-weight: 400; }
    td { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
    thead th {
      color: var(--slate); font-size: var(--t-micro); font-weight: 700;
      letter-spacing: .1em; text-transform: uppercase;
      border-bottom: var(--rule-heavy) solid var(--navy);
    }
    /* A total closes with the heavy rule above it and keeps the row hairline
       below, so it reads correctly whether it ends the table or sits mid-way. */
    tr.total th, tr.total td {
      padding-top: var(--s3); border-top: var(--rule-heavy) solid var(--navy);
      border-bottom: var(--rule) solid var(--line);
      color: var(--navy); font-size: 11pt; font-weight: 700;
    }

    /* --- One status box -------------------------------------------- *
     * No fill: a page of solid colour is a page of wasted toner, and the
     * verdict word carries the outcome on its own. */
    .result, .overall-decision, .eligible-card,
    .incomplete-checks, .complete-checks, .evidence-unavailable,
    .certification, .summary-notice, .note {
      margin: var(--s4) 0; padding: var(--s3) var(--s4);
      border: var(--rule) solid var(--line); border-left: var(--rule-heavy) solid var(--slate);
      border-radius: var(--radius); background: var(--paper);
      color: var(--ink); font-size: var(--t-body); line-height: 1.45;
      break-inside: avoid; page-break-inside: avoid;
    }
    /* The verdict word: one face, one size, on every page of a jacket. */
    .result h2, .overall-decision strong, .eligible-text strong {
      display: block; margin: 0 0 var(--s1);
      font-family: var(--font-display); font-size: var(--t-verdict); font-weight: 700;
      line-height: 1.2; letter-spacing: -0.01em; text-transform: none;
    }
    .result > p, .overall-decision span {
      display: block; margin: 0; color: var(--ink); font-size: var(--t-body);
    }
    .is-ok, .result.pass, .decision-approved,
    .eligible-card, .complete-checks { border-left-color: var(--ok); }
    .is-ok strong, .result.pass h2, .decision-approved strong,
    .eligible-card .eligible-text strong { color: var(--ok); }
    .is-alert, .result.fail, .decision-denied { border-left-color: var(--alert); }
    .is-alert strong, .result.fail h2, .decision-denied strong { color: var(--alert); }
    /* Gold is rationed: the masthead hairline, and the rule beside anything
       that still needs a human before the deal moves. Standing notices and
       disclaimers stay in slate so the gold means something when it appears. */
    .is-caution, .result.warn, .decision-review, .eligible-card.result-review,
    .incomplete-checks, .evidence-unavailable { border-left-color: var(--gold); }
    .is-caution strong, .result.warn h2, .decision-review strong,
    .eligible-card.result-review .eligible-text strong { color: var(--navy); }
    .result.neutral h2 { color: var(--navy); }
    .summary-notice strong, .summary-notice span { display: block; }
    .summary-notice strong {
      margin: 0 0 var(--s1); color: var(--navy); font-size: var(--t-small);
      letter-spacing: .08em; text-transform: uppercase;
    }
    .summary-notice span { color: var(--slate); font-size: var(--t-small); }

    /* --- Footers ---------------------------------------------------- */
    .footer, .portal-footer {
      margin: var(--s5) 0 0; padding-top: var(--s3);
      border-top: var(--rule) solid var(--line);
      color: var(--slate); font-size: var(--t-micro); line-height: 1.5; text-align: center;
    }
    .footer p, .portal-footer p { margin: 0; }`;
}

/**
 * The compliance-record documents — OFAC, Repeat Offender, Title & Lien, and
 * the combined deal jacket that stitches them together. One stylesheet for all
 * four: before this they carried three near-identical copies that had drifted
 * apart, so the same card was one colour on the standalone print and another
 * inside the jacket.
 */
export function reportDocumentCSS() {
  return `${printBaseCSS()}

    /* A record must not be cut in half by a page break. The sheet is 9.8in
       tall inside the margins; the tenth below that is rounding slack, so a
       full page never spills a lone footer onto a blank sheet. */
    .page {
      width: 100%; min-height: 9.7in; position: relative; padding-bottom: 0.45in;
      break-after: page; page-break-after: always;
    }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .content-box, .subject, .brands-section, .matches, .form-field {
      break-inside: avoid; page-break-inside: avoid;
    }

    /* --- Subject panel ---------------------------------------------- */
    .subject, .content-box {
      margin: var(--s4) 0; padding: var(--s4);
      border: var(--rule) solid var(--line); border-radius: var(--radius);
      background: var(--paper);
    }
    .subject h3 { margin: 0 0 var(--s2); }
    .subject table { table-layout: fixed; margin: 0; }
    .subject td:first-child { width: 30%; color: var(--slate); font-weight: 400; }
    .subject td:last-child { color: var(--ink); font-weight: 600; }
    /* The panel edge already closes the list; a rule under the last row would
       double it. */
    .subject tr:last-child td { border-bottom: 0; padding-bottom: 0; }

    /* --- Decision summary ------------------------------------------- */
    .check-summary th[scope="row"] { width: 29%; color: var(--ink); font-weight: 600; }
    .check-summary td:first-of-type { width: 22%; }
    .check-summary td:last-child { color: var(--slate); font-weight: 400; }
    .incomplete-checks h2, .complete-checks h2 { margin: 0 0 var(--s1); }
    .incomplete-checks p, .complete-checks p { margin: 0 0 var(--s1); }

    /* --- OFAC potential matches -------------------------------------- *
     * Inside the verdict box already, so a second frame would only add
     * noise: one hairline separates the list from the verdict above it. */
    .matches {
      margin: var(--s4) 0 0; padding: var(--s3) 0 0;
      border-top: var(--rule) solid var(--line);
      color: var(--ink); font-size: var(--t-small); text-align: left;
    }
    .matches ul { margin: var(--s2) 0 0 var(--s4); }
    .matches em { color: var(--slate); font-style: italic; }

    /* --- MDOS-shaped summary fields ----------------------------------- */
    .form-grid { display: grid; gap: var(--s3) var(--s4); margin-bottom: var(--s4); }
    .identity-grid, .id-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .form-field { display: flex; min-width: 0; flex-direction: column; }
    .form-label { margin-bottom: var(--s1); color: var(--slate); font-size: var(--t-micro); font-weight: 400; }
    .form-value {
      display: flex; align-items: center; min-height: 38px; height: 100%;
      padding: var(--s2) var(--s3); border: var(--rule) solid var(--line);
      border-radius: var(--radius); background: var(--paper); color: var(--ink);
      font-size: var(--t-body); font-weight: 600; text-transform: uppercase; line-height: 1.3;
      white-space: normal; overflow-wrap: anywhere; word-break: break-word;
    }
    .form-value.ref { text-transform: none; }
    .results-header { padding-bottom: var(--s1); border-bottom: var(--rule) solid var(--line); }

    /* --- Title & Lien detail rows: a table row without the table ------- */
    .detail-row {
      display: grid; grid-template-columns: 1.65in minmax(0, 1fr); gap: var(--s4);
      padding: var(--s2) 0; border-bottom: var(--rule) solid var(--line); font-size: var(--t-body);
      break-inside: avoid; page-break-inside: avoid;
    }
    .detail-label { color: var(--slate); font-weight: 400; }
    .detail-value { min-width: 0; color: var(--ink); font-weight: 600; overflow-wrap: anywhere; }
    .detail-value.red { color: var(--alert); }
    .brands-text { color: var(--ink); font-size: var(--t-body); }
    .vin-search-info { margin: 0 0 var(--s4); color: var(--slate); font-size: var(--t-small); }
    .vin-search-info strong { color: var(--ink); }

    /* --- Eligible / review card --------------------------------------- */
    .eligible-card { display: flex; gap: var(--s3); align-items: flex-start; }
    .eligible-icon { width: 12pt; height: 12pt; fill: currentColor; flex-shrink: 0; margin-top: 2pt; }
    .eligible-card { color: var(--ok); }
    .eligible-card.result-review { color: var(--navy); }
    .eligible-text { color: var(--ink); font-size: var(--t-body); line-height: 1.45; }
    .eligible-note { margin-top: var(--s2); color: var(--slate); font-size: var(--t-small); font-weight: 400; }

    /* --- Actual state-site capture ------------------------------------- */
    .state-evidence { margin: 0; background: var(--paper); color: var(--ink); break-inside: avoid; page-break-inside: avoid; }
    .state-evidence-header {
      position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s5);
      padding: 0 0 var(--s2); margin: 0 0 var(--s4);
      border-bottom: var(--rule-heavy) solid var(--navy);
    }
    .state-evidence-header::after {
      content: ""; position: absolute; right: 0; bottom: -3.75pt; left: 0;
      height: var(--rule-accent); background: var(--gold);
    }
    .state-evidence h2 {
      margin: 0 0 var(--s1); color: var(--navy); font-family: var(--font-display);
      font-size: var(--t-masthead); line-height: 1.15;
      letter-spacing: -0.015em; text-transform: none;
    }
    .state-evidence p { margin: 0; color: var(--slate); font-size: var(--t-micro); line-height: 1.4; }
    .state-evidence-part { flex: 0 0 auto; color: var(--slate); font-size: var(--t-micro); font-weight: 700; white-space: nowrap; }
    /* 9.8in inside the margins, less the masthead above and the footer below. */
    .state-evidence img { display: block; width: auto; height: auto; max-width: 100%; max-height: 8.3in; object-fit: contain; margin: 0 auto; border: var(--rule) solid var(--line); background: var(--paper); }

    /* The per-page footer is pinned to the bottom of its own page. */
    .portal-footer {
      position: absolute; right: 0; bottom: 0; left: 0; margin: 0;
      padding-top: var(--s3); border-top: var(--rule) solid var(--line);
    }`;
}

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
  // The id arrives from print-runner.html?id=, and removal happens in the
  // finally block below — so without this guard any session key named in that
  // query string would be deleted, including the in-flight run state.
  if (typeof id !== "string" || !id.startsWith(PRINT_STORAGE_PREFIX)) return null;
  let payload;
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
 * Ask for each shipped face at the weight the documents use, then wait for the
 * font set to settle, so print() is not called while a fallback face is still
 * standing in. Resolves at once where no face is declared (the iframe and
 * popup fallbacks), and never holds the dialog for more than a moment.
 *
 * @param {Document} doc
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function waitForDocumentFonts(doc, timeoutMs = 3000) {
  const fonts = doc?.fonts;
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
  const requests = PRINT_FONT_FACES.map((face) =>
    fonts.load(`700 12pt "${face.family}"`).catch(() => undefined)
  );
  const settled = Promise.all(requests)
    .then(() => fonts.ready)
    .then(() => undefined, () => undefined);
  const deadline = new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
  return Promise.race([settled, deadline]);
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
    await waitForDocumentFonts(doc);
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
