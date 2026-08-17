import { calls } from "./stub-state.mjs";

export async function handleOfacCheck() {
  calls.ofac += 1;
  return {
    success: true,
    result: {
      hasMatch: false,
      matchCount: 0,
      matches: [],
      entriesSearched: 1,
      stale: false,
    },
  };
}
