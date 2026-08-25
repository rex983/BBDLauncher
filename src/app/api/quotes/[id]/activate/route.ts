import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

// Mark an existing quote as the active one. Clears any other active row
// first so the partial unique index doesn't reject the write.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const supabase = createAdminClient();

  const { data: target } = await supabase
    .from("launcher_motivational_quotes")
    .select("id, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (target.is_active) {
    return NextResponse.json({ ok: true, alreadyActive: true });
  }

  const { error: clearErr } = await supabase
    .from("launcher_motivational_quotes")
    .update({ is_active: false })
    .eq("is_active", true);
  if (clearErr) {
    return NextResponse.json({ error: clearErr.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("launcher_motivational_quotes")
    .update({ is_active: true, activated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to activate" },
      { status: 500 }
    );
  }
  return NextResponse.json(data);
}
