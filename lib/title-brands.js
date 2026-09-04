/**
 * Which brands on a Michigan title record disqualify it from reading as clear.
 *
 * Michigan reports a brand two ways. The title's own status becomes the single
 * `titleBrand` value (api-client derives it from `titleStatus`), and the record
 * carries a separate `vehicleBrands` list that a clear-status title can still
 * populate — a SALVAGE entry beside a "Clear" status is exactly the case a
 * dealer must disclose. The final decision has always read both lists; every
 * surface that *describes* the title read only `titleBrand`, so a salvage trade
 * printed "CLEAR TITLE — Michigan reported no title brands and no active liens"
 * on the sheet that goes in the deal jacket, and the audit CSV recorded
 * "Clear". One predicate now answers the question for all of them.
 *
 * Deliberately literal: anything that is not one of the recognized "no brand"
 * values counts as a brand, so an unfamiliar value from the state fails toward
 * disclosure rather than away from it.
 */
export function problemTitleBrands(title) {
  const reported = [
    title?.titleBrand,
    ...(Array.isArray(title?.vehicleBrands) ? title.vehicleBrands : []),
  ];
  return reported.filter(
    (brand) =>
      typeof brand === "string" &&
      brand &&
      brand !== "CLEAN" &&
      brand !== "UNKNOWN" &&
      brand !== "undefined" &&
      brand.toLowerCase() !== "none" &&
      brand.toLowerCase() !== "no brands" &&
      !brand.toLowerCase().includes("no brand")
  );
}
