import type { Session } from "next-auth";

// SAML attribute mapping is admin-configured, but only these identity
// claims may be exposed — a future addition to session.user (e.g. an
// internal token) can't leak via a stale mapping row. Shared by the
// IdP-initiated (/api/launch) and SP-initiated (/api/saml/sso) paths.
const ALLOWED_USER_FIELDS = new Set([
  "email", "name", "role", "office", "department", "is_it", "profileId",
]);

// Adds each mapped attribute onto `attributes` (mutated and returned).
export function applyAttributeMapping(
  attributes: Record<string, string>,
  mapping: unknown,
  user: Session["user"],
): Record<string, string> {
  if (!mapping) return attributes;
  for (const [samlAttr, userField] of Object.entries(mapping as Record<string, string>)) {
    if (!ALLOWED_USER_FIELDS.has(userField)) continue;
    const value = (user as Record<string, unknown>)[userField];
    if (value) attributes[samlAttr] = String(value);
  }
  return attributes;
}
