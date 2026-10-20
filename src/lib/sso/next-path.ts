/**
 * A path inside the app someone was opening ("/cases/123?tab=notes"), passed
 * through the launcher and back. Relative paths only, so it can't be turned
 * into a redirect to another site.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}
