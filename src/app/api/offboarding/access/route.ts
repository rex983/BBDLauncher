import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { isAdmin } from "@/lib/auth/permissions";

const schema = z.object({
  profile_id: z.string().uuid(),
  allowed: z.boolean(),
});

// Admins grant or revoke /offboarding for one person (profiles.can_offboard).
// Admins always have it, so this only matters for everyone else.
export async function PUT(req: NextRequest) {
  const session = await requireSession(isAdmin);
  if (session instanceof NextResponse) return session;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: before } = await supabase
    .from("profiles")
    .select("session_version")
    .eq("id", parsed.data.profile_id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Bump session_version so the change reaches their open session on the
  // next request instead of at their next sign-in.
  const { error } = await supabase
    .from("profiles")
    .update({
      can_offboard: parsed.data.allowed,
      session_version: ((before.session_version as number | null) ?? 1) + 1,
    })
    .eq("id", parsed.data.profile_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
