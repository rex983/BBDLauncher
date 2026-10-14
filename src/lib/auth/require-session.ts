import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { UserRole } from "@/types/auth";

// Route-handler session gate. Returns the session, or a ready-to-return
// error response:
//   requireSession()        → 401 when signed out
//   requireSession(permit)  → 403 when signed out OR the role fails `permit`
// (The 401/403 split mirrors what the routes returned before this helper.)
//
//   const session = await requireSession(canManageContent);
//   if (session instanceof NextResponse) return session;
export async function requireSession(
  permit?: (role: UserRole) => boolean,
): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: permit ? 403 : 401 });
  }
  if (permit && !permit(session.user.permRole)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return session;
}

// Admin-only route gate on the REAL role (role === "admin"). Used where only
// admins may act — never manager tiers, never a custom role's acts_as —
// e.g. creating roles, offices and departments.
export async function requireAdmin(): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }
  return session;
}
