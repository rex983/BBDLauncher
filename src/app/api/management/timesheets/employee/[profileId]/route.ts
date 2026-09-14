import { requireTimeDataAccessWithProfile } from "@/lib/auth/scope-check";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

interface EmployeeRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
  department: string | null;
  is_active: boolean;
  created_at: string;
}

const EMPLOYEE_COLUMNS =
  "id, email, name:full_name, role, office, department, is_active, created_at";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await ctx.params;
  const gate = await requireTimeDataAccessWithProfile<EmployeeRow>(
    profileId,
    "view",
    EMPLOYEE_COLUMNS,
  );
  if (!gate.ok) return gate.response;

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
  const gate = await requireTimeDataAccessWithProfile<EmployeeRow>(
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
