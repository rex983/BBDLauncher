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
