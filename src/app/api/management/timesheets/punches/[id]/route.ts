import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditTimeData, timeDataScope } from "@/lib/auth/permissions";
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

async function loadPunchWithScope(id: string) {
  const session = await auth();
  if (!session?.user || !canEditTimeData(session.user.role)) return null;

  const scope = timeDataScope(session.user.role, session.user.office);
  if (!scope.allowed) return null;

  const supabase = createAdminClient();
  const { data: punch } = await supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at")
    .eq("id", id)
    .single();
  if (!punch) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, office")
    .eq("id", punch.profile_id)
    .single();
  if (!profile) return null;

  if (scope.office && profile.office !== scope.office) return null;
  return { session, supabase, punch };
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
