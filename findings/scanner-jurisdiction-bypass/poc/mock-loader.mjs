const ofacStub = new URL("./stub-ofac.mjs", import.meta.url).href;
const mdosStub = new URL("./stub-mdos.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("/ofac-check.js") || specifier === "./ofac-check.js") {
    return { url: ofacStub, shortCircuit: true };
  }
  if (specifier.endsWith("/mdos-check.js") || specifier === "./mdos-check.js") {
    return { url: mdosStub, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
