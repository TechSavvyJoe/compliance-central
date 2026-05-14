/**
 * Tiny DOM helpers.
 */

export function sanitizeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildSanitizedName(customer) {
  const parts = [
    sanitizeHTML(customer.firstName),
    sanitizeHTML(customer.middleName || ""),
    sanitizeHTML(customer.lastName),
  ].filter((p) => p.trim());

  let name = parts.join(" ");
  if (customer.suffix) {
    name += " " + sanitizeHTML(customer.suffix);
  }
  return name;
}

export function $(id) {
  return document.getElementById(id);
}
