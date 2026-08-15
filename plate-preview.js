import { plateDesignByValue } from "./src/sidepanel/sos-local-form.js";

function highResolutionUrl(source) {
  const url = new URL(source);
  url.searchParams.set("mw", "1600");
  return url.href;
}

const params = new URLSearchParams(location.search);
const design = plateDesignByValue(params.get("design")) || plateDesignByValue("pure_michigan");
const image = document.getElementById("platePreviewImage");
const name = document.getElementById("platePreviewName");

if (design && image && name) {
  image.src = highResolutionUrl(design.imageUrl);
  image.alt = `${design.label} official Michigan SOS plate design artwork`;
  name.textContent = design.label;
  document.title = `${design.label} Plate Preview · Compliance Central`;
}

document.getElementById("closePreviewBtn")?.addEventListener("click", () => window.close());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.close();
});
