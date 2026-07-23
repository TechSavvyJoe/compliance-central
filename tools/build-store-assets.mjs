/**
 * Build all Chrome Web Store media for Compliance Central.
 *
 *   node tools/build-store-assets.mjs
 *
 * - Icons (transparent shield) are rasterized from icons/icon.svg with sharp.
 * - Screenshots (1280x800) and promo tiles are authored as self-contained HTML
 *   and rendered to PNG by headless Google Chrome at an exact 1:1 pixel size.
 *
 * Requires: Google Chrome (macOS) and the `sharp` package.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BUILD = join(ROOT, "store-assets", ".build");
const IMAGES = join(ROOT, "store-assets", "chrome-web-store", "images");
const UPLOAD = join(ROOT, "store-assets", "upload");
const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(BUILD, { recursive: true });
mkdirSync(join(IMAGES, "icons"), { recursive: true });
mkdirSync(join(IMAGES, "screenshots"), { recursive: true });
mkdirSync(join(IMAGES, "promotional"), { recursive: true });
mkdirSync(UPLOAD, { recursive: true });

// ---------- brand ----------
const C = {
  navy: "#00274c",
  navy2: "#003d73",
  appbg: "#0a1628",
  appbg2: "#0f2137",
  card: "#122a45",
  input: "#1a3654",
  gold: "#ffcb05",
  white: "#ffffff",
  text2: "#b8c9db",
  muted: "#6b8299",
  success: "#22c55e",
  warning: "#f59e0b",
  border: "rgba(255,255,255,0.10)",
};

const shield = (size, stroke = 14) => `
<svg width="${size}" height="${size}" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g${size}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${C.navy}"/><stop offset="1" stop-color="${C.navy2}"/>
  </linearGradient></defs>
  <path d="M64 0 L128 24 L128 64 C128 104 80 128 64 128 C48 128 0 104 0 64 L0 24 Z" fill="url(#g${size})"/>
  <path d="M32 64 L52 84 L96 40" stroke="${C.gold}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

// ---------- shared CSS ----------
const baseCss = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:${C.white}}
.stage{width:1280px;height:800px;display:flex;position:relative;overflow:hidden;
  background:radial-gradient(1100px 560px at 92% -8%, rgba(255,203,5,.10), transparent 60%),
             linear-gradient(160deg, ${C.appbg} 0%, ${C.appbg2} 58%, ${C.appbg} 100%)}
.copy{width:592px;padding:88px 0 88px 72px;display:flex;flex-direction:column;justify-content:center;gap:20px}
.brandrow{display:flex;align-items:center;gap:14px}
.brandname{font-size:20px;font-weight:700;letter-spacing:.3px}
.eyebrow{font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.gold}}
.headline{font-size:46px;line-height:1.07;font-weight:800;letter-spacing:-1.2px}
.headline .a{color:${C.gold}}
.sub{font-size:18px;color:${C.text2};line-height:1.55;max-width:430px}
.bullets{display:flex;flex-direction:column;gap:12px;margin-top:8px}
.bullet{display:flex;align-items:center;gap:12px;font-size:16px;color:#dce7f2}
.bdot{width:24px;height:24px;border-radius:50%;background:rgba(255,203,5,.16);color:${C.gold};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0}
.panelwrap{flex:1;display:flex;align-items:center;justify-content:center;padding-right:56px}
.panel{width:406px;height:664px;background:${C.appbg};border:1px solid ${C.border};border-radius:22px;box-shadow:0 34px 80px rgba(0,0,0,.6);overflow:hidden;display:flex;flex-direction:column}
.phead{background:linear-gradient(135deg, ${C.navy}, ${C.navy2});padding:13px 15px;display:flex;align-items:center;gap:11px}
.phead h1{font-size:15px;font-weight:700;line-height:1.1}
.phead .psub{font-size:9px;letter-spacing:1.4px;text-transform:uppercase;opacity:.82;margin-top:1px}
.gear{margin-left:auto;width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;color:#fff}
.pbody{padding:15px;display:flex;flex-direction:column;gap:11px;overflow:hidden;flex:1}
.sectitle{font-size:12px;font-weight:700;color:${C.text2};letter-spacing:.3px;display:flex;align-items:center;gap:7px}
.field{background:${C.input};border:1px solid ${C.border};border-radius:9px;padding:9px 11px;font-size:13px;color:#fff}
.flabel{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:${C.muted};margin-bottom:5px}
.row2{display:flex;gap:9px}
.row2>div{flex:1}
.decision{border-radius:12px;padding:14px;text-align:center}
.decision.ok{background:rgba(34,197,94,.13);border:1px solid ${C.success}}
.dbadge{display:inline-flex;align-items:center;gap:8px;font-size:18px;font-weight:800;letter-spacing:.5px}
.dbadge.ok{color:${C.success}}
.dtext{font-size:11px;color:${C.text2};margin-top:6px}
.rcard{background:${C.card};border:1px solid ${C.border};border-radius:11px;padding:11px 12px}
.rhead{display:flex;align-items:center;justify-content:space-between}
.rname{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;display:inline-flex;align-items:center;gap:5px}
.pill.pass{color:${C.success};background:rgba(34,197,94,.14)}
.pill.warn{color:${C.warning};background:rgba(245,158,11,.14)}
.pill.muted{color:${C.muted};background:rgba(107,130,153,.16)}
.rdetail{font-size:11px;color:${C.muted};margin-top:5px}
.btnrow{display:flex;gap:7px;margin-top:9px}
.btn{font-size:10.5px;font-weight:600;padding:6px 10px;border-radius:7px;background:rgba(255,255,255,.06);border:1px solid ${C.border};color:${C.text2};display:inline-flex;align-items:center;gap:5px}
.btn.gold{background:${C.gold};color:#1a1a1a;border-color:${C.gold}}
.ico{display:inline-flex}
.ico svg{display:block}
.scan-flow{display:flex;flex-direction:column;gap:10px}
.flow-card{background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:12px}
.flow-step-title{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:750;color:#edf5fd}
.flow-step-dot{display:inline-grid;place-items:center;width:23px;height:23px;border-radius:50%;background:${C.gold};color:${C.navy};font-size:12px;font-weight:900;flex:0 0 auto}
.secure-label{margin-left:auto;display:inline-flex;align-items:center;gap:4px;padding:4px 7px;border-radius:999px;background:rgba(34,197,94,.13);color:${C.success};font-size:9px;font-weight:750;letter-spacing:.3px;text-transform:uppercase}
.connect-row{display:flex;align-items:center;gap:14px;margin-top:10px}
.qr-wrap{display:grid;place-items:center;width:88px;height:88px;border:6px solid #fff;border-radius:9px;background:#fff;box-shadow:0 8px 18px rgba(0,0,0,.28);flex:0 0 auto}
.qr-mark{display:block;width:76px;height:76px}
.connect-copy{display:flex;flex-direction:column;gap:5px;color:${C.text2};font-size:11px;line-height:1.42}
.connect-copy strong{color:#fff;font-size:13px}
.phone-preview{padding:11px;background:#071321;border:1px solid rgba(255,203,5,.32);border-radius:17px;box-shadow:inset 0 0 0 3px rgba(255,255,255,.025)}
.phone-top{display:flex;align-items:center;gap:7px;margin-bottom:9px;color:#edf5fd;font-size:11px;font-weight:750}
.live-label{margin-left:auto;display:inline-flex;align-items:center;gap:5px;color:${C.success};font-size:9px;text-transform:uppercase;letter-spacing:.4px}
.live-label::before{content:"";width:6px;height:6px;border-radius:50%;background:${C.success};box-shadow:0 0 0 3px rgba(34,197,94,.13)}
.scan-window{height:220px;display:grid;place-items:center;position:relative;overflow:hidden;border-radius:12px;background:linear-gradient(145deg,#203a54,#0d2238)}
.demo-id{width:305px;height:184px;padding:12px;border-radius:10px;background:linear-gradient(150deg,#e6f1f7,#b7d1df);color:#12314a;box-shadow:0 12px 26px rgba(0,0,0,.32);transform:rotate(-2deg)}
.demo-id-head{display:flex;justify-content:space-between;font-size:8px;font-weight:900;letter-spacing:.8px;text-transform:uppercase}
.demo-magstripe{height:25px;margin:9px -12px 8px;background:#25323d}
.demo-id-body{display:grid;grid-template-columns:.72fr 1.28fr;gap:11px}
.demo-lines{display:flex;flex-direction:column;gap:6px;padding-top:3px}
.demo-lines span{height:4px;border-radius:99px;background:rgba(18,49,74,.32)}
.demo-lines span:nth-child(2){width:74%}
.demo-lines span:nth-child(4){width:62%}
.demo-code-column{display:flex;flex-direction:column;gap:7px}
.demo-code-thin{height:18px;border-radius:2px;background:repeating-linear-gradient(90deg,#10283e 0 2px,transparent 2px 4px,#10283e 4px 5px,transparent 5px 8px)}
.demo-code-wide{height:72px;position:relative;border:3px solid ${C.gold};border-radius:5px;background:repeating-linear-gradient(90deg,#10283e 0 2px,transparent 2px 4px,#10283e 4px 7px,transparent 7px 9px),repeating-linear-gradient(0deg,rgba(16,40,62,.74) 0 2px,transparent 2px 5px);box-shadow:0 0 0 2px rgba(255,203,5,.18)}
.barcode-label{position:absolute;right:4px;bottom:4px;padding:3px 5px;border-radius:3px;background:${C.gold};color:${C.navy};font-size:7px;font-weight:900;letter-spacing:.35px}
.scan-corner{position:absolute;width:28px;height:28px;border-color:${C.gold};border-style:solid}
.scan-corner.tl{top:13px;left:13px;border-width:3px 0 0 3px;border-radius:7px 0 0 0}
.scan-corner.tr{top:13px;right:13px;border-width:3px 3px 0 0;border-radius:0 7px 0 0}
.scan-corner.bl{bottom:13px;left:13px;border-width:0 0 3px 3px;border-radius:0 0 0 7px}
.scan-corner.br{right:13px;bottom:13px;border-width:0 3px 3px 0;border-radius:0 0 7px 0}
.scan-message{margin-top:8px;color:${C.text2};font-size:10px;text-align:center}
.flow-ready{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid rgba(34,197,94,.34);border-radius:11px;background:rgba(34,197,94,.10)}
.flow-ready .ready-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:${C.success};color:#061b10;flex:0 0 auto}
.flow-ready strong,.flow-ready span{display:block}
.flow-ready strong{color:#fff;font-size:12px}
.flow-ready span{margin-top:2px;color:${C.text2};font-size:9.5px}
`;

const I = {
  globe: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  ban: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>`,
  file: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  check: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  shieldcheck: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
  printer: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  download: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  gear: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  key: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3"/></svg>`,
  calendar: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg>`,
  history: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>`,
  lock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
};

const qrPairMark = `
<svg class="qr-mark" viewBox="0 0 84 84" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect width="84" height="84" fill="#fff"/>
  <g fill="${C.navy}">
    <path d="M4 4h24v24H4zm5 5v14h14V9zM56 4h24v24H56zm5 5v14h14V9zM4 56h24v24H4zm5 5v14h14V61z"/>
    <path d="M34 4h6v6h-6zM44 4h6v12h-6zM34 16h12v6H34zM38 26h8v8h-8zM50 22h6v12h-6zM60 34h6v6h-6zM70 34h10v6H70zM4 34h6v12H4zM14 34h14v6H14zM20 44h14v6H20zM4 48h10v6H4zM34 40h6v14h-6zM44 36h10v6H44zM46 46h8v8h-8zM58 44h12v6H58zM74 46h6v16h-6zM32 58h10v6H32zM46 58h6v14h-6zM56 54h14v6H56zM58 64h6v6h-6zM68 64h12v6H68zM34 72h8v8h-8zM50 74h16v6H50zM72 74h8v6h-8z"/>
  </g>
</svg>`;

const pHead = () => `
<div class="phead">
  ${shield(34)}
  <div><h1>Compliance Central</h1><div class="psub">Michigan Dealer Compliance Hub</div></div>
  <div class="gear">${I.gear}</div>
</div>`;

const rcard = (icon, name, pill, pillCls, detail, btns = "") => `
<div class="rcard">
  <div class="rhead">
    <span class="rname"><span class="ico" style="color:${C.text2}">${icon}</span>${name}</span>
    <span class="pill ${pillCls}">${pill}</span>
  </div>
  <div class="rdetail">${detail}</div>
  ${btns}
</div>`;

const evBtns = `<div class="btnrow"><span class="btn"><span class="ico">${I.printer}</span>Print</span><span class="btn gold"><span class="ico">${I.download}</span>Download PDF</span></div>`;

const stage = (copy, panelBody) => `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}</style></head>
<body><div class="stage"><div class="copy">${copy}</div>
<div class="panelwrap"><div class="panel">${pHead()}<div class="pbody">${panelBody}</div></div></div></div></body></html>`;

const copyBlock = (eyebrow, headlineHtml, sub, bullets) => `
  <div class="brandrow">${shield(40)}<span class="brandname">Compliance Central</span></div>
  <div class="eyebrow">${eyebrow}</div>
  <div class="headline">${headlineHtml}</div>
  <div class="sub">${sub}</div>
  <div class="bullets">${bullets
    .map((b) => `<div class="bullet"><span class="bdot">${I.check}</span>${b}</div>`)
    .join("")}</div>`;

// ---------- screenshots ----------
const screen01 = stage(
  copyBlock(
    "Illustrative result",
    `Run all your checks.<br><span class="a">Review one combined result.</span>`,
    "OFAC SDN name screening, Repeat Offender, and Title/Lien outcomes appear together for the current side-panel run.",
    ["Labeled outcomes at a glance", "Print or download the current-run record", "Co-buyer outcomes in the same run"]
  ),
  `
  <div class="decision ok"><div class="dbadge ok"><span class="ico">${I.shieldcheck}</span>APPROVED</div>
    <div class="dtext">No review conditions returned in this example</div></div>
  ${rcard(I.globe, "OFAC Screening", "Pass", "pass", "No matches in SDN list", evBtns)}
  ${rcard(I.ban, "Repeat Offender", "Pass", "pass", "Eligible per MDOS response", evBtns)}
  ${rcard(I.file, "Title &amp; Lien", "Clear", "pass", "2021 Ford F-150 · Clean · No liens", evBtns)}
  `
);

const screen02 = stage(
  copyBlock(
    "Free · No account",
    `OFAC sanctions screening,<br><span class="a">100% on your device.</span>`,
    "Compare buyer names with the locally downloaded U.S. Treasury OFAC SDN list. Customer information stays on your computer for this check.",
    ["No account required", "Daily list-refresh attempt with freshness checks", "Fuzzy name + alias matching for review"]
  ),
  `
  <div class="sectitle">${I.globe} OFAC Only</div>
  ${rcard(I.globe, "OFAC Screening", "Pass", "pass", "No matches across 17,400+ SDN entries", evBtns)}
  <div class="rcard" style="border-style:dashed">
    <div class="rname" style="font-size:12px"><span class="ico" style="color:${C.gold}">${I.shieldcheck}</span>OFAC customer data stays on-device</div>
    <div class="rdetail">Repeat Offender &amp; Title/Lien are included too — no account or setup needed.</div>
  </div>
  `
);

const screen03 = stage(
  copyBlock(
    "Illustrative result · Trade-in",
    `Title &amp; lien results,<br><span class="a">in one view.</span>`,
    "Enter the trade-in VIN to request available title brand, lien status, and vehicle details through the MDOS workflow. The finished report includes the actual captured Michigan state page.",
    ["Title brand: Clean / Salvage / Rebuilt", "Active liens & lienholder", "Actual state-page capture in the report"]
  ),
  `
  <div class="sectitle">${I.file} Title &amp; Lien</div>
  ${rcard(I.file, "Title &amp; Lien", "Clear", "pass", "2021 Ford F-150 · Clean title", evBtns)}
  <div class="rcard">
    <div style="display:flex;flex-direction:column;gap:8px;font-size:11.5px;color:${C.text2}">
      <div style="display:flex;justify-content:space-between"><span style="color:${C.muted}">Title status</span><span>Clean</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:${C.muted}">Brand</span><span>None</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:${C.muted}">Lien</span><span>No active liens</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:${C.muted}">Vehicle</span><span>2021 Ford F-150</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:${C.muted}">Title issued</span><span>03/2021</span></div>
    </div>
  </div>
  `
);

const screen04 = stage(
  copyBlock(
    "Instructional composite · Phone scan",
    `Point your phone.<br><span class="a">Fields fill automatically.</span>`,
    "Open the pairing code, then aim at the large, wide barcode on the back of the license or state ID. The scanner captures it automatically.",
    ["No perfect alignment needed", "License image stays on the phone", "Encrypted, one-time field transfer"]
  ),
  `
  <div class="scan-flow">
    <div class="flow-card">
      <div class="flow-step-title"><span class="flow-step-dot">1</span>Scan the pairing code<span class="secure-label">${I.lock} Secure</span></div>
      <div class="connect-row">
        <div class="qr-wrap">${qrPairMark}</div>
        <div class="connect-copy"><strong>Open your phone camera</strong><span>Point it at the code. The license scanner opens in your browser—no app download.</span></div>
      </div>
    </div>
    <div class="phone-preview">
      <div class="phone-top"><span class="flow-step-dot">2</span>Aim at the wide barcode<span class="live-label">Automatic</span></div>
      <div class="scan-window">
        <div class="demo-id">
          <div class="demo-id-head"><span>Michigan · Sample ID</span><span>Back</span></div>
          <div class="demo-magstripe"></div>
          <div class="demo-id-body">
            <div class="demo-lines"><span></span><span></span><span></span><span></span><span></span></div>
            <div class="demo-code-column">
              <div class="demo-code-thin"></div>
              <div class="demo-code-wide"><span class="barcode-label">WIDE BARCODE</span></div>
            </div>
          </div>
        </div>
        <span class="scan-corner tl"></span><span class="scan-corner tr"></span>
        <span class="scan-corner bl"></span><span class="scan-corner br"></span>
      </div>
      <div class="scan-message">Second barcode from the top, on the right · tilted is okay</div>
    </div>
    <div class="flow-ready">
      <span class="ready-icon">${I.check}</span>
      <div><strong>Buyer fields ready</strong><span>Name, birth date, and license/ID number fill on the computer.</span></div>
    </div>
  </div>
  `
);

const histItem = (name, decision, cls, meta) => `
<div class="rcard" style="padding:11px 12px">
  <div class="rhead"><span class="rname" style="font-size:13px">${name}</span><span class="pill ${cls}">${decision}</span></div>
  <div class="rdetail">${meta}</div>
</div>`;

const screen05 = stage(
  copyBlock(
    "Anonymous audit history",
    `Recent outcomes,<br><span class="a">without customer identity.</span>`,
    "Up to 50 outcome-only audit records stay on your device for no more than 30 days. Names, dates of birth, license numbers, VINs, and screenshots are excluded.",
    ["Anonymous reference + timestamp", "Decision and check outcomes only", "Clear local history anytime"]
  ),
  `
  <div class="sectitle">${I.history} Compliance History &nbsp;<span style="color:${C.muted};font-weight:500">· 3 today, 41 total</span></div>
  ${histItem("CC-20260722-091421", "APPROVED", "pass", "Today 9:14 AM · Trade-in included")}
  ${histItem("CC-20260722-085105", "APPROVED", "pass", "Today 8:51 AM · No trade-in")}
  ${histItem("CC-20260721-163204", "REVIEW", "warn", "Yesterday 4:32 PM · Title review")}
  ${histItem("CC-20260721-140512", "APPROVED", "pass", "Yesterday 2:05 PM · Trade-in included")}
  `
);

// ---------- promo tiles ----------
const promoSmall = `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}
.tile{width:440px;height:280px;background:radial-gradient(420px 240px at 84% -10%, rgba(255,203,5,.16), transparent 62%),linear-gradient(135deg,${C.navy} 0%,${C.navy2} 100%);padding:30px 34px;display:flex;flex-direction:column;justify-content:space-between}
.chip{font-size:12px;font-weight:700;padding:6px 12px;border-radius:20px;background:rgba(255,255,255,.12);display:inline-flex;align-items:center;gap:7px}
</style></head><body>
<div class="tile">
  <div style="display:flex;align-items:center;gap:12px">${shield(46)}<div style="font-size:22px;font-weight:800;letter-spacing:-.3px">Compliance Central</div></div>
  <div><div style="font-size:25px;font-weight:800;line-height:1.12;letter-spacing:-.6px">Michigan dealer compliance,<br><span style="color:${C.gold}">all in one side panel.</span></div></div>
  <div style="display:flex;gap:9px">
    <span class="chip"><span class="ico">${I.globe}</span>OFAC</span>
    <span class="chip"><span class="ico">${I.ban}</span>Repeat Offender</span>
    <span class="chip"><span class="ico">${I.file}</span>Title/Lien</span>
  </div>
</div></body></html>`;

const promoMarquee = `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}
.m{width:1400px;height:560px;background:radial-gradient(900px 520px at 96% -10%, rgba(255,203,5,.14), transparent 60%),linear-gradient(135deg,${C.navy} 0%,${C.navy2} 100%);display:flex;align-items:center;padding:0 90px;position:relative;overflow:hidden}
.left{width:58%;display:flex;flex-direction:column;gap:24px}
.chip{font-size:15px;font-weight:700;padding:9px 16px;border-radius:24px;background:rgba(255,255,255,.12);display:inline-flex;align-items:center;gap:9px}
.mpanel{position:absolute;right:84px;top:64px;width:330px;height:432px;background:${C.appbg};border:1px solid ${C.border};border-radius:20px;box-shadow:0 40px 90px rgba(0,0,0,.5);overflow:hidden;transform:rotate(2deg)}
</style></head><body>
<div class="m">
  <div class="left">
    <div style="display:flex;align-items:center;gap:16px">${shield(58)}<div style="font-size:30px;font-weight:800;letter-spacing:-.5px">Compliance Central</div></div>
    <div style="font-size:54px;font-weight:800;line-height:1.05;letter-spacing:-1.6px">OFAC, Repeat Offender &amp;<br>Title checks &mdash; <span style="color:${C.gold}">one click.</span></div>
    <div style="font-size:19px;color:${C.text2};max-width:560px;line-height:1.5">Screen buyers and download current-run Deal Jacket records — built for Michigan auto dealers.</div>
    <div style="display:flex;gap:12px">
      <span class="chip"><span class="ico">${I.globe}</span>OFAC sanctions</span>
      <span class="chip"><span class="ico">${I.ban}</span>Repeat Offender</span>
      <span class="chip"><span class="ico">${I.file}</span>Title &amp; Lien</span>
    </div>
  </div>
  <div class="mpanel">${pHead()}<div class="pbody">
    <div class="decision ok"><div class="dbadge ok"><span class="ico">${I.shieldcheck}</span>APPROVED</div><div class="dtext">No review conditions returned in this example</div></div>
    ${rcard(I.globe, "OFAC", "Pass", "pass", "No SDN matches")}
    ${rcard(I.ban, "Repeat Offender", "Pass", "pass", "Eligible")}
    ${rcard(I.file, "Title &amp; Lien", "Clear", "pass", "Clean · No liens")}
  </div></div>
</div></body></html>`;

// ---------- render ----------
function renderHtml(name, html, w, h, outPath) {
  const htmlPath = join(BUILD, name + ".html");
  writeFileSync(htmlPath, html);
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${w},${h}`,
      `--screenshot=${outPath}`,
      "file://" + htmlPath,
    ],
    { stdio: "ignore" }
  );
}

// Flat, transparent shield — correct for the browser toolbar (blends with
// light/dark toolbars). The richer 3D tile below is used only for the store.
async function renderIcons() {
  const { default: sharp } = await import("sharp");
  const svg = readFileSync(join(ROOT, "icons", "icon.svg"));
  for (const s of [16, 32, 48, 128]) {
    await sharp(svg, { density: 384 }).resize(s, s).png().toFile(join(ROOT, "icons", `icon${s}.png`));
  }
  await sharp(svg, { density: 1024 }).resize(512, 512).png().toFile(join(ROOT, "icons", "icon_master.png"));
  console.log("toolbar icons: 16/32/48/128 (transparent) + master 512");
}

// Rich, opaque 3D shield tile — full-bleed background (no transparent corners,
// so the store can't show white), volume gradient, gloss, soft drop shadows,
// metallic gold check. Rendered by Chrome (full SVG filter support) then
// flattened to a 24-bit PNG (no alpha).
const STORE_ICON_SVG = `
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c2f56"/><stop offset="1" stop-color="#03152b"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.30" r="0.75">
      <stop offset="0" stop-color="#4a86c8" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#4a86c8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body" x1="0.3" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="#3a72ad"/><stop offset="0.5" stop-color="#16487f"/><stop offset="1" stop-color="#0a2c54"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/>
      <stop offset="0.4" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="0.54" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0.15" y2="1">
      <stop offset="0" stop-color="#ffe884"/><stop offset="0.55" stop-color="#ffc52e"/><stop offset="1" stop-color="#ef9e00"/>
    </linearGradient>
    <filter id="shieldShadow" x="-40%" y="-30%" width="180%" height="190%">
      <feDropShadow dx="0" dy="4" stdDev="3.2" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
    <filter id="checkShadow" x="-60%" y="-60%" width="240%" height="260%">
      <feDropShadow dx="0" dy="2.4" stdDev="1.8" flood-color="#241200" flood-opacity="0.55"/>
    </filter>
  </defs>

  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>

  <g transform="translate(218,196) scale(4.6)">
    <g filter="url(#shieldShadow)">
      <path d="M64 0 L128 24 L128 64 C128 104 80 128 64 128 C48 128 0 104 0 64 L0 24 Z" fill="url(#body)"/>
    </g>
    <path d="M64 0 L128 24 L128 64 C128 104 80 128 64 128 C48 128 0 104 0 64 L0 24 Z" fill="url(#gloss)"/>
    <path d="M64 0 L128 24 L128 64 C128 104 80 128 64 128 C48 128 0 104 0 64 L0 24 Z" fill="none" stroke="#8fbce8" stroke-opacity="0.5" stroke-width="1.6"/>
    <path d="M32 64 L52 84 L96 40" fill="none" stroke="url(#gold)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" filter="url(#checkShadow)"/>
    <path d="M32 64 L52 84 L96 40" fill="none" stroke="#fff6cf" stroke-opacity="0.55" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,-2.5)"/>
  </g>
</svg>`;

const STORE_ICON_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0}html,body{width:1024px;height:1024px}</style></head><body>${STORE_ICON_SVG}</body></html>`;

async function renderStoreIcon() {
  const { default: sharp } = await import("sharp");
  const htmlPath = join(BUILD, "store-icon.html");
  writeFileSync(htmlPath, STORE_ICON_HTML);
  const raw = join(BUILD, "store-icon-1024.png");
  execFileSync(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1024,1024", `--screenshot=${raw}`, "file://" + htmlPath],
    { stdio: "ignore" }
  );
  const bg = "#03152b";
  await sharp(raw).flatten({ background: bg }).png().toFile(join(IMAGES, "icons", "icon-master-1024.png"));
  await sharp(raw).resize(128, 128, { fit: "fill" }).flatten({ background: bg }).png().toFile(join(IMAGES, "icons", "icon128.png"));
  console.log("store icon: opaque 3D tile — 1024 master + 128");
}

const SCREENS = [
  ["01-run-all-approved-1280x800", screen01, 1280, 800, join(IMAGES, "screenshots")],
  ["02-ofac-only-local-1280x800", screen02, 1280, 800, join(IMAGES, "screenshots")],
  ["03-title-lien-1280x800", screen03, 1280, 800, join(IMAGES, "screenshots")],
  ["04-phone-license-scan-1280x800", screen04, 1280, 800, join(IMAGES, "screenshots")],
  ["05-compliance-history-1280x800", screen05, 1280, 800, join(IMAGES, "screenshots")],
];

// Remove screenshots superseded by the current product flow.
for (const old of [
  "01-run-all-results-and-pdf-actions-1280x800.png",
  "02-history-recordkeeping-actions-1280x800.png",
  "03-date-of-birth-year-selector-1280x800.png",
  "04-dob-decade-picker-1280x800.png",
  "04-dob-decade-picker-1280x800.jpg",
]) {
  for (const dir of [join(IMAGES, "screenshots"), UPLOAD]) {
    const p = join(dir, old);
    if (existsSync(p)) rmSync(p);
  }
}

async function writeUploadAssets() {
  const { default: sharp } = await import("sharp");
  for (const [name] of SCREENS) {
    const png = join(IMAGES, "screenshots", `${name}.png`);
    const jpg = join(IMAGES, "screenshots", `${name}.jpg`);
    await sharp(png).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(jpg);
    copyFileSync(jpg, join(UPLOAD, `${name}.jpg`));
  }

  copyFileSync(join(IMAGES, "icons", "icon128.png"), join(UPLOAD, "cc-store-icon-128.png"));

  for (const name of ["small-promo-440x280", "marquee-promo-1400x560"]) {
    const png = join(IMAGES, "promotional", `${name}.png`);
    const jpg = join(IMAGES, "promotional", `${name}.jpg`);
    await sharp(png)
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
      .toFile(jpg);
    copyFileSync(jpg, join(UPLOAD, `${name}.jpg`));
  }
}

await renderIcons();
await renderStoreIcon();
for (const [name, html, w, h, dir] of SCREENS) {
  renderHtml(name, html, w, h, join(dir, name + ".png"));
  console.log("screenshot:", name);
}
renderHtml("small-promo-440x280", promoSmall, 440, 280, join(IMAGES, "promotional", "small-promo-440x280.png"));
console.log("promo: small 440x280");
renderHtml("marquee-promo-1400x560", promoMarquee, 1400, 560, join(IMAGES, "promotional", "marquee-promo-1400x560.png"));
console.log("promo: marquee 1400x560");
await writeUploadAssets();
console.log("upload: icon, five screenshots, and two promo tiles");

rmSync(BUILD, { recursive: true, force: true });
console.log("done.");
