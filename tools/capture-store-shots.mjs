/**
 * Chrome Web Store media, built from the REAL side panel.
 *
 *   node tools/capture-store-shots.mjs
 *
 * The previous generator (build-store-assets.mjs) authored screenshots as
 * hand-built HTML replicas of the original dark theme. The shipped product is
 * now the light workspace, so those images misrepresent the listing — and a
 * store screenshot that does not match the installed product is both a review
 * risk and a broken promise to the buyer.
 *
 * This generator instead serves the repository over localhost, loads the real
 * sidepanel.html in an iframe at side-panel width, stages each state with the
 * same modules the app runs (History cards come from populateHistoryModal, the
 * verdict banner uses the exact markup results.js writes), and lets headless
 * Chrome print the finished 1280x800 composition. Every pixel of UI in the
 * output is the product's own CSS rendering its own DOM.
 *
 * Requires Google Chrome at the standard macOS path. No npm dependencies.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BUILD = join(ROOT, "store-assets", ".build");
const OUT = join(ROOT, "store-assets", "chrome-web-store");
const SHOTS = join(OUT, "screenshots");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8790;

mkdirSync(BUILD, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

// ---------- the five screenshots ----------
// Each entry: headline, support copy, bullets, and the staging script that
// runs inside the iframe (same origin) before capture.

// sidepanel.js aborts early outside the extension (no chrome.*), so the icon
// pass never runs and every <span class="icon-*"> renders as an empty box.
// Re-run the app's own injection: same map, same ICONS module.
const ICON_PRELUDE = `
      const { ICONS } = await import("./src/sidepanel/icons.js");
      const iconMap = [
        ["icon-user", ICONS.user], ["icon-users", ICONS.users],
        ["icon-car", ICONS.car], ["icon-globe", ICONS.globe],
        ["icon-ban", ICONS.ban], ["icon-file", ICONS.fileText],
        ["icon-calendar", ICONS.calendar], ["icon-play", ICONS.play],
        ["icon-trash", ICONS.trash], ["icon-history", ICONS.history],
        ["icon-printer", ICONS.printer], ["icon-download", ICONS.download],
        ["icon-chevron", ICONS.chevron], ["icon-settings", ICONS.settings],
        ["icon-check", ICONS.check], ["icon-info", ICONS.info],
      ];
      const injectIcons = () => {
        for (const [cls, svg] of iconMap) {
          if (!svg) continue;
          document.querySelectorAll("." + cls).forEach((el) => { el.innerHTML = svg; });
        }
      };
      injectIcons();
`;
const SCREENSHOTS = [
  {
    file: "screenshot-1.png",
    eyebrow: "Michigan dealer compliance",
    headline: "Every check,\none side panel",
    bullets: [
      "OFAC screening runs on this computer",
      "MDOS Repeat Offender and Title/Lien",
      "Scan the buyer's ID with your phone",
    ],
    stage: `
      window.scrollTo(0, 0);
    `,
  },
  {
    file: "screenshot-2.png",
    eyebrow: "One verdict",
    headline: "Clear to deliver,\nor exactly why not",
    bullets: [
      "Pass, review, or do-not-sell — with the statute",
      "Evidence saved with every decision",
      "Print or PDF the full deal jacket",
    ],
    stage: `
      const fd = document.getElementById("finalDecision");
      document.body.classList.add("has-screening-results");
      document.getElementById("firstRunHero").hidden = true;
      document.getElementById("resultsSection").classList.remove("hidden");
      fd.className = "final-decision verdict-approved";
      fd.innerHTML =
        '<div class="decision-eyebrow">All checks passed</div>' +
        '<h2 class="decision-headline">Clear to deliver</h2>' +
        '<p class="decision-text">Marcus cleared every check that applied.</p>' +
        '<div class="decision-meta"><span>Delaney, Marcus</span><span aria-hidden="true">\\u00b7</span><span>2:14 PM</span><span aria-hidden="true">\\u00b7</span><span>ref 02</span></div>';
      // Card statuses use the app's own classes and copy.
      const set = (id, cls, txt) => {
        const el = document.getElementById(id);
        if (el) { el.className = "status-indicator " + cls; el.textContent = txt; }
      };
      for (const [card, status, detail] of [
        ["ofacResultCard", "ofacResultStatus", "No matches in SDN list"],
        ["repeatResultCard", "repeatResultStatus", "Eligible per MDOS repeat-offender response"],
        ["titleResultCard", "titleResultStatus", "Clear paper title \\u00b7 no active lien"],
      ]) {
        const detailEl = document.querySelector("#" + card + " .result-detail");
        if (detailEl) detailEl.textContent = detail;
        const s = document.querySelector("#" + card + " .result-status");
        if (s) { s.classList.add("status-pass"); s.textContent = card === "titleResultCard" ? "Clear" : "Pass"; }
      }
      window.scrollTo(0, 0);
    `,
  },
  {
    file: "screenshot-3.png",
    eyebrow: "Registration and plates",
    headline: "The official fee,\nfrom the official calculator",
    bullets: [
      "One click runs the Michigan SOS calculator",
      "Total, term, and expiration — verified",
      "A customer worksheet with your store's name",
    ],
    stage: `
      document.querySelectorAll("[data-workspace-panel]").forEach((p) => {
        p.hidden = p.dataset.workspacePanel !== "sos";
      });
      document.querySelectorAll(".workspace-tabs [role=tab]").forEach((t) =>
        t.setAttribute("aria-selected", String(t.dataset.workspaceTarget === "sos"))
      );
      const h = document.getElementById("sosQuoteHeadline");
      h.classList.remove("hidden");
      document.getElementById("sosQuoteTotal").textContent = "$179.00";
      document.getElementById("sosQuoteTerm").textContent = "12 months \\u00b7 expires Apr 15, 2027";
      const src = document.getElementById("sosQuoteSource");
      src.textContent = "SOS calculated";
      src.classList.add("is-calculated");
      const ws = document.getElementById("sosWorkspaceStatus");
      ws.classList.add("is-ok");
      document.getElementById("sosWorkspaceStatusText").textContent =
        "Official SOS calculation complete.";
      document.getElementById("sosQuoteStatus").textContent =
        "Calculated by the Michigan SOS for a purchase today.";
      // A calculated quote enables the customer print and PDF actions.
      for (const id of ["printSosQuoteBtn", "printSosCalculationBtn", "downloadSosCalculationPdfBtn"]) {
        const b = document.getElementById(id);
        if (b) b.disabled = false;
      }
      // Show the money: scroll the quote headline into the frame.
      document.getElementById("calculateSosFeeBtn").scrollIntoView({ block: "center" });
    `,
  },
  {
    file: "screenshot-4.png",
    eyebrow: "Audit trail",
    headline: "Thirty days of proof,\nall on this device",
    bullets: [
      "Reopen, re-screen, print, or delete any record",
      "Week-old deals flagged before delivery",
      "Audit log exports to CSV",
    ],
    stage: `
      const now = Date.now();
      const rec = (over) => Object.assign({
        id: "a" + Math.random().toString(16).slice(2),
        reference: "CC-20260817-104233",
        timestamp: now - 2 * 864e5, decision: "APPROVED", runType: "full",
        customerName: "Marcus Delaney", hasCoBuyer: false, hasTrade: true,
        tradeVin: "1FTFW1E84PFA10397",
        checks: { ofac: "clear", repeatOffender: "eligible", title: "clear" },
        savedResults: { customer: { firstName: "Marcus", lastName: "Delaney" } },
      }, over);
      const hist = [
        rec({}),
        rec({
          decision: "REVIEW", timestamp: now - 9 * 864e5,
          reference: "CC-20260810-153012",
          customerName: "Dana Whitfield",
          savedResults: { customer: { firstName: "Dana", lastName: "Whitfield" } },
          checks: { ofac: "potential_match", repeatOffender: "eligible", title: "not_run" },
          hasTrade: false, tradeVin: null,
        }),
        rec({
          runType: "individual", runLabel: "OFAC only", decision: "PARTIAL",
          reference: "CC-20260812-091507",
          customerName: "Lee Tran",
          savedResults: { customer: { firstName: "Lee", lastName: "Tran" } },
          checks: { ofac: "clear", repeatOffender: "not_run", title: "not_run" },
          hasTrade: false, tradeVin: null,
        }),
      ];
      window.chrome = window.chrome || {};
      chrome.storage = { local: { get: async () => ({ complianceHistory: hist }) } };
      const mod = await import("./src/sidepanel/history.js");
      await mod.populateHistoryModal(document.getElementById("historyList"));
      document.getElementById("historyCount").textContent = "3";
      document.querySelectorAll("[data-workspace-panel]").forEach((p) => {
        p.hidden = p.dataset.workspacePanel !== "history";
      });
      document.querySelectorAll(".workspace-tabs [role=tab]").forEach((t) =>
        t.setAttribute("aria-selected", String(t.dataset.workspaceTarget === "history"))
      );
      window.scrollTo(0, 0);
    `,
  },
  {
    file: "screenshot-5.png",
    eyebrow: "Built for the showroom",
    headline: "Your store's name.\nYour customers' data, kept home.",
    bullets: [
      "Dealership name and logo on printed worksheets",
      "Records live on this device — clear them any time",
      "No account, no key, no setup",
    ],
    stage: `
      const m = document.getElementById("settingsModal");
      m.classList.remove("hidden");
      m.hidden = false;
      const name = document.getElementById("dealershipNameInput");
      if (name) name.value = "Great Lakes Auto Group";
    `,
  },
];

// ---------- page templates ----------
const fonts = `
  @font-face { font-family: "Archivo"; src: url("/assets/fonts/archivo-latin-variable.woff2") format("woff2"); font-weight: 400 800; }
  @font-face { font-family: "Bricolage Grotesque"; src: url("/assets/fonts/bricolage-grotesque-latin-variable.woff2") format("woff2"); font-weight: 600 800; }
`;

const shieldSvg = `
<svg width="54" height="54" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#00274c"/><stop offset="1" stop-color="#003d73"/>
  </linearGradient></defs>
  <path d="M64 0 L128 24 L128 64 C128 104 80 128 64 128 C48 128 0 104 0 64 L0 24 Z" fill="url(#sg)"/>
  <path d="M32 64 L52 84 L96 40" stroke="#ffcb05" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

function screenshotHtml({ eyebrow, headline, bullets, stage }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${fonts}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 800px; overflow: hidden; }
  body {
    display: flex; align-items: center; gap: 56px;
    padding: 0 0 0 72px;
    font-family: Archivo, system-ui, sans-serif;
    background:
      radial-gradient(1000px 600px at 110% -10%, rgba(255, 203, 5, 0.10), transparent 60%),
      linear-gradient(135deg, #0d2b4a 0%, #123a63 55%, #0d2b4a 100%);
    color: #fff;
  }
  .copy { flex: 1; max-width: 520px; }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 44px; }
  .brand strong { font-size: 24px; font-weight: 750; letter-spacing: -0.02em; }
  .eyebrow { color: #ffcb05; font-size: 15px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 16px; }
  h1 { font-family: "Bricolage Grotesque", Archivo, sans-serif; font-size: 52px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.04; white-space: pre-line; margin-bottom: 30px; }
  ul { list-style: none; }
  li { display: flex; gap: 12px; align-items: baseline; color: #d4e2ee; font-size: 19px; line-height: 1.4; margin-bottom: 14px; }
  li::before { content: ""; flex: 0 0 10px; width: 10px; height: 10px; border-radius: 3px; background: #ffcb05; transform: translateY(-1px); }
  .device {
    flex: 0 0 auto; width: 440px; height: 760px; margin-right: 64px;
    border-radius: 18px; overflow: hidden;
    box-shadow: 0 40px 90px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.14);
    background: #fff;
  }
  iframe { width: 440px; height: 760px; border: 0; display: block; }
  </style></head><body>
    <div class="copy">
      <div class="brand">${shieldSvg}<strong>Compliance Central</strong></div>
      <div class="eyebrow">${eyebrow}</div>
      <h1>${headline}</h1>
      <ul>${bullets.map((b) => `<li>${b}</li>`).join("")}</ul>
    </div>
    <div class="device"><iframe id="app" src="/sidepanel.html"></iframe></div>
    <script>
      const frame = document.getElementById("app");
      frame.addEventListener("load", () => {
        const w = frame.contentWindow;
        const doc = w.document;
        const script = doc.createElement("script");
        script.type = "module";
        script.textContent =
          ${JSON.stringify(`(async () => { ${ICON_PRELUDE} ${stage} injectIcons(); document.documentElement.dataset.staged = "1"; })().catch((e) => { console.error(e); document.documentElement.dataset.staged = "err"; });`)};
        doc.body.appendChild(script);
      });
    </script>
  </body></html>`;
}

function promoHtml({ width, height, marquee }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  ${fonts}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    display: flex; flex-direction: column; justify-content: center; align-items: center; gap: ${marquee ? 22 : 14}px;
    font-family: Archivo, system-ui, sans-serif; text-align: center;
    background:
      radial-gradient(${width}px ${height}px at 85% -20%, rgba(255, 203, 5, 0.14), transparent 55%),
      linear-gradient(135deg, #0d2b4a 0%, #123a63 55%, #0d2b4a 100%);
    color: #fff;
  }
  .mark { display: flex; align-items: center; gap: ${marquee ? 20 : 12}px; }
  .mark svg { width: ${marquee ? 92 : 56}px; height: ${marquee ? 92 : 56}px; }
  .mark strong { font-family: "Bricolage Grotesque", Archivo, sans-serif; font-size: ${marquee ? 64 : 30}px; font-weight: 800; letter-spacing: -0.03em; }
  p { color: #d4e2ee; font-size: ${marquee ? 26 : 14.5}px; line-height: 1.35; max-width: ${marquee ? 900 : 380}px; }
  .chips { display: flex; gap: ${marquee ? 14 : 8}px; margin-top: ${marquee ? 10 : 4}px; }
  .chip { padding: ${marquee ? "10px 20px" : "5px 11px"}; border: 1px solid rgba(255, 203, 5, 0.5); border-radius: 999px; color: #ffcb05; font-size: ${marquee ? 19 : 11.5}px; font-weight: 700; }
  </style></head><body>
    <div class="mark">${shieldSvg}<strong>Compliance Central</strong></div>
    <p>OFAC screening, MDOS Repeat Offender, Title &amp; Lien, and official Michigan plate fees — in Chrome's side panel, free.</p>
    <div class="chips"><span class="chip">OFAC</span><span class="chip">Repeat Offender</span><span class="chip">Title / Lien</span><span class="chip">Plate Fees</span></div>
  </body></html>`;
}

// ---------- render ----------
const execFileAsync = promisify(execFile);

// Chrome is spawned asynchronously and awaited. It used to be execFileSync,
// which blocks Node's event loop for as long as Chrome runs — and this script
// serves the page from an HTTP server on that same loop. So Chrome would
// request the page, the server could not answer while blocked, and Chrome sat
// there until execFileSync's own 60s timeout killed it. The failure only
// appeared when the script started its own server; against an already-running
// external one it worked every time, which is what made it look like a Chrome
// problem rather than a self-inflicted deadlock.
async function render(html, outFile, width, height, budgetMs) {
  const page = join(BUILD, "page.html");
  writeFileSync(page, html);
  const url = `http://127.0.0.1:${PORT}/store-assets/.build/page.html`;
  await execFileAsync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    `--screenshot=${outFile}`,
    `--virtual-time-budget=${budgetMs}`,
    "--run-all-compositor-stages-before-draw",
    url,
  ], { stdio: "pipe", timeout: 60_000 });
}

let server = null;
const needServer = await fetch(`http://127.0.0.1:${PORT}/sidepanel.html`)
  .then((r) => !r.ok)
  .catch(() => true);
if (needServer) {
  const { createReadStream, statSync } = await import("node:fs");
  const types = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", webp: "image/webp", woff2: "font/woff2", json: "application/json", svg: "image/svg+xml" };
  server = http.createServer((req, res) => {
    try {
      const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
      const stat = statSync(path);
      if (!path.startsWith(ROOT) || !stat.isFile()) throw new Error("nope");
      res.setHeader("Content-Type", types[path.split(".").pop()] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      // Length lets the browser see the end of the body without waiting on the
      // socket to close, and the error handler keeps a failed read from
      // stranding the request open — Chrome advances virtual time only once
      // every request has settled, so any unanswered response hangs the render.
      res.setHeader("Content-Length", stat.size);
      const stream = createReadStream(path);
      stream.on("error", () => {
        res.statusCode = 500;
        res.end();
        stream.destroy();
      });
      stream.pipe(res);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  }).listen(PORT, "127.0.0.1");
  // A request that arrives just as the socket idles out would otherwise be cut
  // off mid-flight and never answered.
  server.keepAliveTimeout = 30_000;
  server.headersTimeout = 35_000;
  await new Promise((r) => server.on("listening", r));
}

for (const shot of SCREENSHOTS) {
  await render(screenshotHtml(shot), join(SHOTS, shot.file), 1280, 800, 9000);
  console.log("wrote", shot.file);
}
await render(promoHtml({ width: 440, height: 280 }), join(OUT, "promo-small-440x280.png"), 440, 280, 3000);
console.log("wrote promo-small-440x280.png");
await render(promoHtml({ width: 1400, height: 560, marquee: true }), join(OUT, "promo-marquee-1400x560.png"), 1400, 560, 3000);
console.log("wrote promo-marquee-1400x560.png");

server?.close();
rmSync(BUILD, { recursive: true, force: true });
console.log("done");
