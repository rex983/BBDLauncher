import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, canEditTimeData, timeDataScope } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

async function checkScope(profileId: string) {
  const session = await auth();
  if (!session?.user || !canViewTimeData(session.user.role)) return null;

  const scope = timeDataScope(session.user.role, session.user.department);
  if (!scope.allowed) return null;

  const supabase = createAdminClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, email, name:full_name, role, office, department, created_at")
    .eq("id", profileId)
    .single();

  if (!target) return null;
  // Non-admin managers can only touch profiles in their own department.
  if (scope.department && target.department !== scope.department) return null;

  return { session, target, supabase };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await ctx.params;
  const gate = await checkScope(profileId);
  if (!gate) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 7);
  defaultFrom.setHours(0, 0, 0, 0);

  const startISO = from ? new Date(from).toISOString() : defaultFrom.toISOString();
  const endISO = to ? new Date(to).toISOString() : now.toISOString();

  const { data: punches, error } = await gate.supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at, source, note, edited_by")
    .eq("profile_id", profileId)
    .gte("occurred_at", startISO)
    .lte("occurred_at", endISO)
    .order("occurred_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    profile: gate.target,
    punches: punches || [],
    range: { from: startISO, to: endISO },
  });
}

const punchSchema = z.object({
  event_type: z.enum([
    "clock_in", "clock_out",
    "lunch_start", "lunch_end",
    "break_start", "break_end",
  ]),
  occurred_at: z.string().datetime(),
  note: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await ctx.params;
  const gate = await checkScope(profileId);
  if (!gate) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!canEditTimeData(gate.session.user.role)) {
    return NextResponse.json({ error: "Read-only role" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = punchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await gate.supabase
    .from("time_punches")
    .insert({
      profile_id: profileId,
      event_type: parsed.data.event_type,
      occurred_at: parsed.data.occurred_at,
      source: "admin_edit",
      edited_by: gate.session.user.profileId,
      note: parsed.data.note ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
