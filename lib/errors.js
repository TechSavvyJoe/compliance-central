/**
 * Shared error-code constants. Kept in one place so producers (api-client) and
 * consumers (sidepanel describeError) can't drift on the literal string.
 */

// Thrown when the built-in service credential is unavailable. Users never need
// to supply or configure this value themselves.
export const MISSING_API_KEY = "MISSING_API_KEY";
