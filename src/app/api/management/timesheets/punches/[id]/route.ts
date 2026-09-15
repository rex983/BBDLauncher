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

// Fetches the target punch. For non-admins, additionally fetches the punch
// owner's profile and enforces (office ∩ department ∩ is_active). Admins
// skip the profile fetch entirely.
async function loadPunchWithScope(id: string) {
  const gate = await requireTimeDataAccess(null, "edit");
  if (!gate.ok) return { fail: gate.response };

  const { data: punch } = await gate.supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at")
    .eq("id", id)
    .maybeSingle();
  if (!punch) {
    return { fail: NextResponse.json({ error: "Punch not found" }, { status: 404 }) };
  }

  if (!gate.viewerIsAdmin) {
    const { data: prof } = await gate.supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", punch.profile_id)
      .maybeSingle();
    if (!prof || prof.is_active === false) {
      return { fail: NextResponse.json({ error: "Out of scope" }, { status: 403 }) };
    }
    if (gate.scope.department && prof.department !== gate.scope.department) {
      return { fail: NextResponse.json({ error: "Out of scope" }, { status: 403 }) };
    }
    if (gate.scope.office && prof.office !== gate.scope.office) {
      return { fail: NextResponse.json({ error: "Out of scope" }, { status: 403 }) };
    }
  }

  return { ok: true as const, session: gate.session, supabase: gate.supabase, punch };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const gate = await loadPunchWithScope(id);
  if (!gate.ok) return gate.fail;

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
  if (!gate.ok) return gate.fail;

  const { error } = await gate.supabase.from("time_punches").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
