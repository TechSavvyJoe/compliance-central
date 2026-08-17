import { calls } from "./stub-state.mjs";

export async function handleRepeatOffenderCheck() {
  calls.repeatOffender += 1;
  return { success: true, result: { status: "eligible", passed: true } };
}

export async function handleTitleCheck() {
  calls.title += 1;
  return {
    success: true,
    result: { titleBrand: "CLEAN", hasLien: false, passed: true },
  };
}
