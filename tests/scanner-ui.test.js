import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../docs/scan.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../docs/scan.css", import.meta.url), "utf8");
const scanJs = readFileSync(new URL("../docs/scan.js", import.meta.url), "utf8");
const pairingJs = readFileSync(
  new URL("../src/sidepanel/scan-pairing.js", import.meta.url),
  "utf8"
);
const frontDemoWebp = readFileSync(
  new URL("../docs/images/mi-id-front-demo.webp", import.meta.url)
);
const backDemoWebp = readFileSync(
  new URL("../docs/images/mi-id-back-demo.webp", import.meta.url)
);

function rgb(hex) {
  return hex.match(/[a-f\d]{2}/gi).map((part) => Number.parseInt(part, 16));
}

function luminance(color) {
  const channels = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function vp8Dimensions(webp) {
  assert.equal(webp.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(webp.subarray(8, 12).toString("ascii"), "WEBP");
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const chunkType = webp.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = webp.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (chunkType === "VP8 ") {
      assert.deepEqual(
        [...webp.subarray(dataOffset + 3, dataOffset + 6)],
        [0x9d, 0x01, 0x2a],
        "demo image must contain a valid VP8 frame header"
      );
      return {
        width: webp.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: webp.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  assert.fail("demo image must contain a VP8 frame");
}

test("scanner exposes named regions and atomic live feedback", () => {
  for (const [screenId, headingId] of [
    ["cameraScreen", "captureHeading"],
    ["reviewScreen", "reviewHeading"],
    ["cobuyerPrompt", "cobuyerHeading"],
    ["doneScreen", "doneHeading"],
  ]) {
    assert.match(
      html,
      new RegExp(`<section id="${screenId}"[^>]*aria-labelledby="${headingId}"`)
    );
    assert.match(html, new RegExp(`<h2 id="${headingId}"`));
  }

  assert.match(html, /id="status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /id="deliveryStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(html, /id="errorBanner"[^>]*role="alert"[^>]*aria-atomic="true"/);
  assert.match(html, /id="captureSummary"[^>]*role="group"[^>]*aria-label="Captured people"/);
  assert.ok(html.indexOf('id="errorBanner"') < html.indexOf('id="cameraScreen"'));
});

test("photo fallback remains keyboard-accessible without an invisible tab stop", () => {
  assert.match(
    html,
    /class="viewport" role="img"[^>]*aria-label="Live camera preview[^>]*Michigan license or state ID[^>]*second barcode from the top on the right[^>]*large, wide barcode directly under the thin one[^>]*tilted or off-center[^>]*Scanning is automatic\./
  );
  assert.match(html, /<video id="video"[^>]*aria-hidden="true"/);
  assert.match(
    html,
    /id="photoBtn"[^>]*aria-controls="photoInput"[^>]*aria-label="Choose a photo of the back of the license or state ID"[^>]*>Use a photo<\/button>/
  );
  assert.match(
    html,
    /id="photoInput"[^>]*aria-label="Choose a photo of the back of the license or state ID"[^>]*tabindex="-1"/
  );
});

test("camera screen keeps only essential visible guidance", () => {
  assert.match(html, /<h2 id="captureHeading">Scan the back of the buyer's ID<\/h2>/);
  assert.match(
    html,
    /<ol class="scan-steps" role="list" aria-label="How to scan the ID">/
  );
  assert.equal((html.match(/<li class="scan-step/g) || []).length, 3);
  assert.match(
    html,
    /class="id-example" aria-label="Step 1\. Turn it over\. Show the back of the ID\."[\s\S]*?images\/mi-id-front-demo\.webp\?v=20260722-20" width="640" height="404" alt=""[\s\S]*?id="step1Title"[\s\S]*?<span class="step-number" aria-hidden="true">1<\/span>[\s\S]*?<strong>Turn it over<\/strong><small>Show the back<\/small>/
  );
  assert.match(
    html,
    /class="id-example is-target" aria-label="Step 2\. Find the wide barcode\. It is the second barcode from the top on the right, directly below the thin barcode\."[\s\S]*?images\/mi-id-back-demo\.webp\?v=20260722-20" width="640" height="404" alt=""[\s\S]*?id="step2Title"[\s\S]*?<span class="step-number" aria-hidden="true">2<\/span>[\s\S]*?<strong>Find the wide barcode<\/strong><small>Second from top, on the right<\/small>/
  );
  assert.match(
    html,
    /id="captureInstructions" class="camera-step">[\s\S]*?<span class="step-number" aria-hidden="true">3<\/span>[\s\S]*?<strong>Hold barcode in view<\/strong><small>Scanning is automatic\. Tilted or off-center is okay\.<\/small>/
  );
  const step1 = html.indexOf("Turn it over");
  const step2 = html.indexOf("Find the wide barcode");
  const step3 = html.indexOf("Hold barcode in view");
  const viewport = html.indexOf('class="viewport" role="img"');
  assert.ok(step1 >= 0 && step1 < step2 && step2 < step3 && step3 < viewport);
  assert.doesNotMatch(html, /barcode at the bottom/i);
  assert.doesNotMatch(html, /lowest barcode/i);
  assert.doesNotMatch(scanJs, /barcode at the bottom/i);
  assert.doesNotMatch(scanJs, /lowest barcode/i);
  assert.doesNotMatch(html, /Michigan Dealer Compliance Hub/);
  assert.doesNotMatch(html, /PDF417/);
  assert.doesNotMatch(html, /When asked/);
  assert.doesNotMatch(html, /frame-label/);
  assert.match(
    html,
    /id="privacyNote"[^>]*aria-label="Image stays on this phone\. Only the details you approve are encrypted and sent\."[^>]*>Image stays on this phone\.<\/p>/
  );
  assert.match(
    html,
    /id="torchBtn"[^>]*aria-label="Turn camera light on"[^>]*aria-pressed="false"[^>]*>Light<\/button>/
  );

  assert.match(css, /\.frame-guide\s*\{[^}]*width:\s*94%[^}]*height:\s*84%/s);
  assert.match(css, /\.frame-guide\s*\{[^}]*linear-gradient\(var\(--gold\), var\(--gold\)\)/s);
  assert.match(css, /\.scan-steps\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.82fr\) minmax\(0, 1\.18fr\)/s);
  assert.doesNotMatch(css, /\.scan-steps\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.id-example figcaption small\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.privacy-note\s*\{[^}]*font-size:\s*13px/s);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.id-example\.is-target\s*\{[^}]*outline:/s);
  assert.doesNotMatch(css, /border:\s*3px dashed var\(--gold\)/);
  assert.doesNotMatch(scanJs, /Hold the wide barcode anywhere in the yellow area/i);
  assert.doesNotMatch(scanJs, /Starting production-grade scanner/i);
  assert.doesNotMatch(scanJs, /No PDF417 license barcode/i);
});

test("demo ID artwork is lightweight and clearly non-document training media", () => {
  for (const asset of [frontDemoWebp, backDemoWebp]) {
    assert.equal(asset.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(asset.subarray(8, 12).toString("ascii"), "WEBP");
    assert.ok(asset.byteLength < 32_000);
  }
  assert.ok(frontDemoWebp.byteLength + backDemoWebp.byteLength < 50_000);
  assert.deepEqual(vp8Dimensions(frontDemoWebp), { width: 640, height: 404 });
  assert.deepEqual(vp8Dimensions(backDemoWebp), { width: 640, height: 404 });
  assert.match(html, /mi-id-front-demo\.webp\?v=20260722-20" width="640" height="404"/);
  assert.match(html, /mi-id-back-demo\.webp\?v=20260722-20" width="640" height="404"/);
});

test("normal scans do not populate implementation diagnostics", () => {
  assert.match(html, /id="diag" class="diag hidden"/);
  assert.match(html, /id="reviewDiag" class="diag hidden"/);
  assert.match(
    scanJs,
    /if \(DEBUG\) \{\s*el\("diag"\)\.classList\.remove\("hidden"\);\s*el\("reviewDiag"\)\.classList\.remove\("hidden"\);\s*\}/
  );
  assert.match(scanJs, /if \(DEBUG && rd\) \{/);
});

test("scanner asset versions are updated together", () => {
  const cssVersion = html.match(/scan\.css\?v=([^"']+)/)?.[1];
  const scriptVersion = html.match(/scan\.js\?v=([^"']+)/)?.[1];
  assert.equal(cssVersion, "20260722-20");
  assert.equal(scriptVersion, cssVersion);
  assert.match(html, /mi-id-front-demo\.webp\?v=20260722-20/);
  assert.match(html, /mi-id-back-demo\.webp\?v=20260722-20/);
  assert.match(pairingJs, /&cb=20260722-20#k=/);
  assert.doesNotMatch(pairingJs, /debug=1/);
});

test("scanner styles preserve focus, readable labels, motion preferences, and narrow layouts", () => {
  assert.match(css, /--text-muted:\s*#7f97ae/i);
  assert.match(css, /\.btn:focus\s*\{[^}]*outline:/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.actions\s*\{\s*flex-direction: column;/);
  assert.doesNotMatch(css, /\.camera-actions\s*\{\s*flex-direction:\s*column/);
  assert.doesNotMatch(css, /flex-direction:\s*column-reverse/);
  assert.match(css, /\.fields dd\s*\{[^}]*overflow-wrap: anywhere;/s);
});

test("scanner secondary text meets WCAG AA contrast on cards", () => {
  assert.ok(contrast(rgb("7f97ae"), rgb("122a45")) >= 4.5);
});
