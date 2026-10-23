import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { teamScope } from "@/lib/auth/permissions";

type Gate =
  | { ok: true; session: Session; supabase: SupabaseClient; office: string | null }
  | { ok: false; response: NextResponse };

// Admins: every office's teams. Manager tier: their own office's.
export async function teamGate(): Promise<Gate> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const scope = teamScope(session.user.permRole, session.user.office);
  if (!scope.allowed) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 403 }) };
  return { ok: true, session, supabase: createAdminClient(), office: scope.office };
}

/** A database error as a response; a unique-name clash reads as a sentence. */
export function dbError(message: string, code?: string) {
  if (code === "23505") return NextResponse.json({ error: "A team with that name already exists." }, { status: 409 });
  return NextResponse.json({ error: message }, { status: 500 });
}
