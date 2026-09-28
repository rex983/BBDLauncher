import { requireTimeDataAccessWithProfile } from "@/lib/auth/scope-check";
import { startOfDayInZone } from "@/lib/timesheets/tz";
import {
  EMPLOYEE_COLUMNS,
  loadEmployeeWindow,
  type EmployeeDetailProfile,
} from "@/lib/timesheets/detail";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PUNCH_EVENT_TYPES } from "@/lib/timesheets/state";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await ctx.params;
  const gate = await requireTimeDataAccessWithProfile<EmployeeDetailProfile>(
    profileId,
    "view",
    EMPLOYEE_COLUMNS,
  );
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const now = new Date();
  const defaultFrom = startOfDayInZone(now);
  defaultFrom.setDate(defaultFrom.getDate() - 7);

  const res = await loadEmployeeWindow(
    gate.supabase,
    profileId,
    from ? new Date(from).toISOString() : defaultFrom.toISOString(),
    to ? new Date(to).toISOString() : now.toISOString(),
    { includeOvertime: url.searchParams.get("overtime") === "1", now },
  );
  if (!res.ok) return NextResponse.json({ error: res.message }, { status: res.status });
  return NextResponse.json({ profile: gate.target, ...res.data });
}

const punchSchema = z.object({
  event_type: z.enum(PUNCH_EVENT_TYPES),
  occurred_at: z.string().datetime(),
  note: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await ctx.params;
  const gate = await requireTimeDataAccessWithProfile<EmployeeDetailProfile>(
    profileId,
    "edit",
    EMPLOYEE_COLUMNS,
  );
  if (!gate.ok) return gate.response;

  const parsed = punchSchema.safeParse(await req.json());
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
