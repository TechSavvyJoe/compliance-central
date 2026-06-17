/**
 * Shared error-code constants. Kept in one place so producers (api-client) and
 * consumers (sidepanel describeError) can't drift on the literal string.
 */

// Thrown when no backend key is available (should not happen in normal use, as
// a default key ships with the extension — see CONFIG.backend.defaultApiKey).
export const MISSING_API_KEY = "MISSING_API_KEY";
