import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const patchSchema = z.object({
  event_type: z.enum([
    "clock_in", "clock_out",
    "lunch_start", "lunch_end",
    "break_start", "break_end",
  ]).optional(),
  occurred_at: z.string().datetime().optional(),
  note: z.string().nullable().optional(),
});

// Fetch the target punch and its owner's department in one query so the
// scope check doesn't cost a second round trip. Admins skip the scope check.
async function loadPunchWithScope(id: string) {
  const gate = await requireTimeDataAccess(null, "edit");
  if (!gate.ok) return null;

  const { data: punch } = await gate.supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at, profiles!inner(department, office, is_active)")
    .eq("id", id)
    .single<{
      id: string;
      profile_id: string;
      event_type: string;
      occurred_at: string;
      profiles: { department: string | null; office: string | null; is_active: boolean };
    }>();
  if (!punch) return null;

  if (!gate.viewerIsAdmin) {
    if (punch.profiles.is_active === false) return null;
    if (gate.scope.department && punch.profiles.department !== gate.scope.department) return null;
    if (gate.scope.office && punch.profiles.office !== gate.scope.office) return null;
  }
  return { session: gate.session, supabase: gate.supabase, punch };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await loadPunchWithScope(id);
  if (!gate) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await gate.supabase
    .from("time_punches")
    .update({
      ...parsed.data,
      source: "admin_edit",
      edited_by: gate.session.user.profileId,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await loadPunchWithScope(id);
  if (!gate) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { error } = await gate.supabase.from("time_punches").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
