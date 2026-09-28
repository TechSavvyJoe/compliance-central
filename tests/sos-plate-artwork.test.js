import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SOS_PLATE_DESIGNS } from "../src/sidepanel/sos-plate-catalog.js";

const manifest = JSON.parse(readFileSync(new URL("../assets/plates/provenance.json", import.meta.url), "utf8"));
test("all selectable plates have exact packaged official artwork and intact source provenance", () => {
  const designs = Object.values(SOS_PLATE_DESIGNS);
  assert.equal(designs.length, 89);
  assert.equal(Object.keys(manifest.images).length, 85);
  for (const design of designs) {
    assert.match(design.bundledImageUrl, /^assets\/plates\/[a-z0-9._-]+\.(?:png|jpg|webp)$/);
    const record = Object.values(manifest.images).find((item) => item.path === design.bundledImageUrl);
    assert.ok(record?.designs.includes(design.value), design.value + " must be mapped to its verified artwork");
    assert.equal(design.imageUrl, record.url);
    assert.ok(["www.michigan.gov", "dsvsesvc.sos.state.mi.us"].includes(new URL(record.url).hostname));
    assert.equal(new URL(record.sourcePage).hostname, "www.michigan.gov");
    const image = readFileSync(new URL("../" + record.path, import.meta.url));
    assert.equal(image.length, record.bytes);
    assert.equal(createHash("sha256").update(image).digest("hex"), record.sha256);
  }
  assert.notEqual(SOS_PLATE_DESIGNS.pure_michigan.bundledImageUrl, SOS_PLATE_DESIGNS.u_michigan_state.bundledImageUrl);
});
