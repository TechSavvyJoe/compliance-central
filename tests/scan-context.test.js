import assert from "node:assert/strict";
import test from "node:test";

import { classifyBrowseContext } from "../docs/lib/scan-context.js";
import { buildPrepareOptions } from "../docs/lib/zxing-wasm-loader.js";

test("classifyBrowseContext treats iframe as constrained", () => {
  const parent = { id: "parent" };
  const child = { id: "child" };
  const topLevel = classifyBrowseContext({
    self: parent,
    top: parent,
    outerWidth: 390,
    outerHeight: 844,
  });
  const embedded = classifyBrowseContext({
    self: child,
    top: parent,
    outerWidth: 390,
    outerHeight: 844,
  });
  assert.equal(topLevel.embedded, false);
  assert.equal(embedded.embedded, true);
  assert.equal(embedded.constrained, true);
});

test("classifyBrowseContext detects tiny popup with opener", () => {
  const ctx = classifyBrowseContext({
    self: 1,
    top: 1,
    opener: {},
    outerWidth: 400,
    outerHeight: 500,
  });
  assert.equal(ctx.tinyPopup, true);
  assert.equal(ctx.constrained, true);
});

test("classifyBrowseContext allows normal phone viewport", () => {
  const ctx = classifyBrowseContext({
    self: 1,
    top: 1,
    opener: null,
    outerWidth: 390,
    outerHeight: 844,
  });
  assert.equal(ctx.embedded, false);
  assert.equal(ctx.tinyPopup, false);
  assert.equal(ctx.constrained, false);
});

test("buildPrepareOptions requires fireImmediately so WASM actually loads", () => {
  const opts = buildPrepareOptions("https://example.test/zxing_reader.wasm");
  assert.equal(opts.fireImmediately, true);
  assert.equal(typeof opts.overrides.locateFile, "function");
  assert.equal(
    opts.overrides.locateFile("zxing_reader.wasm", "/prefix/"),
    "https://example.test/zxing_reader.wasm"
  );
  assert.equal(opts.overrides.locateFile("other.js", "/prefix/"), "/prefix/other.js");
});
