import { NextResponse, type NextRequest } from "next/server";
import { decode } from "next-auth/jwt";
import type { ViewAs } from "./session";

// "View as" sessions are read-only. Apps keep the ViewAs on the token as
// `viewAs` and on the session as `session.viewAs`.
//
// Middleware/proxy: `const blocked = await viewAsWriteBlock(req, ALLOW); if (blocked) return blocked;`
// Server code that writes: `assertNotViewingAs(session)` as a second layer.

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

/** Raw session cookie value (joins NextAuth's chunked .0, .1, … cookies). */
function sessionCookie(req: NextRequest): { name: string; value: string } | null {
  for (const name of COOKIE_NAMES) {
    const whole = req.cookies.get(name)?.value;
    if (whole) return { name, value: whole };
    const chunks: string[] = [];
    for (let i = 0; ; i++) {
      const part = req.cookies.get(`${name}.${i}`)?.value;
      if (!part) break;
      chunks.push(part);
    }
    if (chunks.length) return { name, value: chunks.join("") };
  }
  return null;
}

/** Who is being viewed, if this request's session is a View as. */
export async function readViewAs(req: NextRequest): Promise<{ viewAs: ViewAs; name: string } | null> {
  const cookie = sessionCookie(req);
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!cookie || !secret) return null;
  try {
    const token = await decode({ token: cookie.value, secret, salt: cookie.name });
    const viewAs = token?.viewAs as ViewAs | undefined;
    if (!viewAs) return null;
    const name = (typeof token?.name === "string" && token.name) || (token?.email as string) || "another user";
    return { viewAs, name };
  } catch {
    return null;
  }
}

/**
 * 403 for any write while viewing as someone. `allow` lists path prefixes
 * that may still be written to (always include "/api/auth").
 */
export async function viewAsWriteBlock(
  req: NextRequest,
  allow: string[] = ["/api/auth"],
): Promise<NextResponse | null> {
  if (READ_METHODS.has(req.method)) return null;
  const path = req.nextUrl.pathname;
  if (allow.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`))) return null;
  const hit = await readViewAs(req);
  if (!hit) return null;
  return NextResponse.json({ error: `Read-only: viewing as ${hit.name}` }, { status: 403 });
}

export class ViewAsReadOnlyError extends Error {
  constructor(name?: string | null) {
    super(`Read-only: viewing as ${name || "another user"}`);
    this.name = "ViewAsReadOnlyError";
  }
}

/** Throw if this session is a View as. Use in server actions / route handlers that write. */
export function assertNotViewingAs(
  session: { viewAs?: ViewAs | null; user?: { name?: string | null } | null } | null | undefined,
): void {
  if (session?.viewAs) throw new ViewAsReadOnlyError(session.user?.name);
}
