import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { canAccessAdminPath } from "@/lib/auth/permissions";
import type { UserRole } from "@/types/auth";

const publicPaths = [
  "/login",
  "/auth-error",
  "/api/auth",
  "/api/saml/metadata",
  "/api/sso/jwks",
  // An app's "not signed in" hand-off; it checks the session itself.
  "/sso/start",
  // Home-screen install manifest; browsers fetch it without cookies.
  "/manifest.webmanifest",
  // Cron endpoints gate themselves via the Bearer CRON_SECRET (src/lib/cron.ts).
  // If middleware redirects them to /login, external cron pings return
  // 307-then-HTML and never actually execute the handler.
  "/api/cron",
  // Server-to-server webhooks that check their own shared secret.
  "/api/integrations",
];

// Paths where cross-origin POST is legitimate and expected. The Origin
// check below refuses cross-origin state-changing requests everywhere else.
//   - /api/auth: NextAuth OAuth callbacks (Google POSTs here).
//   - /api/saml/sso: SAML SP-initiated flow — service providers submit
//     forms to us from their own origin.
//   - /api/cron: server-to-server, no browser session at all.
const csrfExemptPrefixes = [
  "/api/auth",
  "/api/saml/sso",
  "/api/cron",
  "/api/integrations",
];

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Only allow relative paths as callback URLs to prevent open redirect */
function sanitizeCallbackUrl(pathname: string): string {
  if (pathname.startsWith("/") && !pathname.startsWith("//")) {
    return pathname;
  }
  return "/dashboard";
}

// CSRF defense: for cookie-authenticated state-changing requests we require
// the browser-set Origin header to match the request host. A cross-origin
// page can force the browser to POST here, but it cannot spoof Origin — so
// this stops classic CSRF cold without touching any client code.
function isCrossOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // No Origin means either same-origin GET (irrelevant here) or a
    // non-browser client. Fall back to Referer if present, else treat as
    // cross-origin to be safe.
    const referer = req.headers.get("referer");
    if (!referer) return true;
    try {
      const refOrigin = new URL(referer).origin;
      const expected = new URL(req.url).origin;
      return refOrigin !== expected;
    } catch {
      return true;
    }
  }
  try {
    const originHost = new URL(origin).origin;
    const expected = new URL(req.url).origin;
    return originHost !== expected;
  } catch {
    return true;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CSRF gate runs before public-path shortcuts so exempt routes can be
  // hit cross-origin, but public + non-exempt POSTs are still checked.
  if (
    stateChangingMethods.has(req.method) &&
    !csrfExemptPrefixes.some((p) => pathname.startsWith(p)) &&
    isCrossOrigin(req)
  ) {
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 }
    );
  }

  // Allow public paths
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  try {
    // Most requests only need "is this a signed-in browser?", which the
    // encrypted session cookie answers on its own. A full auth() also reads
    // the profiles row (deactivated / signed out / role changed), and doing
    // that here as well as in the page or API route cost a database round
    // trip on every click. Pages and API routes still call auth(), which
    // returns no session for deactivated or signed-out people.
    const token = await getToken({
      req,
      secret: process.env.AUTH_SECRET,
      // Same rule Auth.js uses to name the cookie: AUTH_URL's scheme, else
      // the request's.
      secureCookie: (process.env.AUTH_URL ?? req.url).startsWith("https:"),
    });
    if (!token) {
      const loginUrl = new URL("/login", req.url);
      // Keep the query: /api/launch/<id>?next=… must survive the sign-in.
      loginUrl.searchParams.set("callbackUrl", sanitizeCallbackUrl(pathname + req.nextUrl.search));
      return NextResponse.redirect(loginUrl);
    }

    // Admin routes — admins get all; managers get a curated subset. This is
    // a cheap first gate on the role carried in the session cookie (no
    // database read). It is not the authoritative check: the role in the
    // cookie can lag a demotion until the session is rewritten, so
    // admin/layout.tsx (canManageContent), the admin-only pages and layouts
    // (isAdmin), and every API route behind them re-check with auth().
    if (pathname.startsWith("/admin")) {
      // Permission role (acts_as ?? role, migration 051); older cookies
      // carry only `role`.
      const role = (token.permRole ?? token.role) as UserRole | undefined;
      if (!canAccessAdminPath(role, pathname)) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    // Management routes — access is enforced server-side by
    // src/app/(dashboard)/management/layout.tsx via notFound(). We deliberately
    // do NOT redirect here so unauthorized visitors get a real 404 page
    // instead of a silent redirect that reveals the route exists.
  } catch {
    // If auth fails (e.g. missing AUTH_SECRET), redirect to login
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
