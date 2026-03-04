import { NextRequest, NextResponse } from "next/server";

const publicPaths = [
  "/login",
  "/auth-error",
  "/api/auth",
  "/api/saml/metadata",
  "/api/sso/jwks",
];

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
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Admin routes require admin role
    if (pathname.startsWith("/admin")) {
      if (session.user.role !== "admin") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }
  } catch {
    // If auth fails (e.g. missing AUTH_SECRET), redirect to login
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
