import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../docs/scan.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../docs/scan.css", import.meta.url), "utf8");
const scanJs = readFileSync(new URL("../docs/scan.js", import.meta.url), "utf8");

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
  assert.match(html, /When asked, choose <strong>Allow<\/strong> for camera access/);
  assert.match(html, /class="viewport" role="img"[^>]*aria-label="Live camera preview/);
  assert.match(html, /<video id="video"[^>]*aria-hidden="true"/);
  assert.match(html, /id="photoBtn"[^>]*aria-controls="photoInput"/);
  assert.match(
    html,
    /id="photoInput"[^>]*aria-label="Choose a photo of the back of the license"[^>]*tabindex="-1"/
  );
});

test("camera guidance describes a forgiving automatic scan area", () => {
  assert.match(html, /roughly inside\s+the large yellow area/);
  assert.match(html, /tilted or off-center — no need to line it up perfectly/);
  assert.match(html, /reads it automatically as soon as it is clear/);
  assert.match(html, /Exact alignment is not required/);
  assert.match(html, /<span class="frame-label">Barcode can be anywhere here<\/span>/);
  assert.match(html, /The license image is not uploaded/);
  assert.match(html, /only the fields you review and confirm are encrypted and sent/);

  assert.match(css, /\.frame-guide\s*\{[^}]*width:\s*96%[^}]*height:\s*78%/s);
  assert.match(css, /\.frame-guide\s*\{[^}]*border:\s*3px dashed var\(--gold\)/s);
  assert.match(css, /\.frame-label\s*\{/);
  assert.doesNotMatch(scanJs, /fill the yellow frame/i);
});

test("scanner asset versions are updated together", () => {
  const cssVersion = html.match(/scan\.css\?v=([^"']+)/)?.[1];
  const scriptVersion = html.match(/scan\.js\?v=([^"']+)/)?.[1];
  assert.equal(cssVersion, "20260722-15");
  assert.equal(scriptVersion, cssVersion);
});

test("scanner styles preserve focus, readable labels, motion preferences, and narrow layouts", () => {
  assert.match(css, /--text-muted:\s*#7f97ae/i);
  assert.match(css, /\.btn:focus\s*\{[^}]*outline:/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.actions\s*\{\s*flex-direction: column;/);
  assert.doesNotMatch(css, /flex-direction:\s*column-reverse/);
  assert.match(css, /\.fields dd\s*\{[^}]*overflow-wrap: anywhere;/s);
});

test("scanner secondary text meets WCAG AA contrast on cards", () => {
  assert.ok(contrast(rgb("7f97ae"), rgb("122a45")) >= 4.5);
});
