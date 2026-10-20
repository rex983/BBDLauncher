// Where the BBD Launcher lives. NEXT_PUBLIC_LAUNCHER_URL (or LAUNCHER_URL on
// the server) overrides the default.

export const LAUNCHER_URL = (
  process.env.NEXT_PUBLIC_LAUNCHER_URL ||
  process.env.LAUNCHER_URL ||
  "https://bbd-launcher.vercel.app"
).replace(/\/+$/, "");

export const LAUNCHER_DASHBOARD_URL = `${LAUNCHER_URL}/dashboard`;

/** Admin → Users, where people, roles, offices and departments are managed. */
export const LAUNCHER_USERS_URL = `${LAUNCHER_URL}/admin/users`;

export const LAUNCHER_JWKS_URL =
  process.env.LAUNCHER_JWKS_URL || `${LAUNCHER_URL}/api/sso/jwks`;

/**
 * A path inside this app ("/cases/123?tab=notes") carried through sign-in.
 * Relative paths only, so it can't become a redirect to another site.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

/**
 * Signs someone in to this app through the launcher, then lands them on
 * `next`. Signed in on the launcher already: straight in, no prompt. Not
 * signed in: back to this app's /login?signedOut=1 — unless `login` is set
 * (the "Sign in on the launcher" button), which signs them in there first.
 */
export function launcherSignInUrl(audience: string, next?: string | null, opts?: { login?: boolean }): string {
  const q = new URLSearchParams({ app: audience });
  const path = safeNext(next);
  if (path) q.set("next", path);
  if (opts?.login) q.set("login", "1");
  return `${LAUNCHER_URL}/sso/start?${q}`;
}
