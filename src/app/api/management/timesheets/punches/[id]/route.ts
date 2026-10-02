import {
  isOwnRecord,
  isTargetInScope,
  ownRecordResponse,
  requireTimeDataAccess,
  type ScopedProfile,
} from "@/lib/auth/scope-check";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PUNCH_EVENT_TYPES } from "@/lib/timesheets/state";

const patchSchema = z.object({
  event_type: z.enum(PUNCH_EVENT_TYPES).optional(),
  occurred_at: z.string().datetime().optional(),
  note: z.string().nullable().optional(),
});

// Fetches the target punch with its owner's scope columns embedded (one
// round-trip). Non-admins must have the owner inside (office ∩ department
// ∩ is_active); admins skip the scope check.
async function loadPunchWithScope(id: string) {
  const gate = await requireTimeDataAccess(null, "edit");
  if (!gate.ok) return { fail: gate.response };

  const { data: punch } = await gate.supabase
    .from("time_punches")
    .select("id, profile_id, profile:profiles!profile_id(department, office, is_active)")
    .eq("id", id)
    .maybeSingle<{ id: string; profile_id: string; profile: ScopedProfile | null }>();
  if (!punch) {
    return { fail: NextResponse.json({ error: "Punch not found" }, { status: 404 }) };
  }
  if (isOwnRecord(gate.viewerIsAdmin, gate.session, punch.profile_id)) {
    return { fail: ownRecordResponse() };
  }

  if (!gate.viewerIsAdmin && (!punch.profile || !isTargetInScope(gate.scope, punch.profile))) {
    return { fail: NextResponse.json({ error: "Out of scope" }, { status: 403 }) };
  }

  return { ok: true as const, session: gate.session, supabase: gate.supabase };
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
