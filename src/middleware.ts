import { NextRequest, NextResponse } from "next/server";
import { canAccessAdminPath } from "@/lib/auth/permissions";

const publicPaths = [
  "/login",
  "/auth-error",
  "/api/auth",
  "/api/saml/metadata",
  "/api/sso/jwks",
  // Cron endpoints gate themselves via CRON_SECRET / x-vercel-cron header.
  // If middleware redirects them to /login, external cron pings return
  // 307-then-HTML and never actually execute the handler.
  "/api/cron",
];

/** Only allow relative paths as callback URLs to prevent open redirect */
function sanitizeCallbackUrl(pathname: string): string {
  if (pathname.startsWith("/") && !pathname.startsWith("//")) {
    return pathname;
  }
  return "/dashboard";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Dynamically import auth to avoid blowing up if AUTH_SECRET is missing
  try {
    const { auth } = await import("@/auth");
    const session = await auth();

    // Redirect unauthenticated users to login
    if (!session?.user) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", sanitizeCallbackUrl(pathname));
      return NextResponse.redirect(loginUrl);
    }

    // Admin routes — admins get all; managers get a curated subset.
    if (pathname.startsWith("/admin")) {
      if (!canAccessAdminPath(session.user.role, pathname)) {
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
