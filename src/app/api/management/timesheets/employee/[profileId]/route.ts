import { requireTimeDataAccessWithProfile } from "@/lib/auth/scope-check";
import { startOfDayInZone } from "@/lib/timesheets/tz";
import { loadEmployeeOvertime } from "@/lib/timesheets/detail";
import { requestDays, type TimeOffType } from "@/lib/timeoff/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type TimeOffByType = Record<TimeOffType, number>;
function emptyTimeOffByType(): TimeOffByType {
  return { vacation: 0, sick: 0, personal: 0, parental: 0, other: 0 };
}

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
  const todayStart = startOfDayInZone(now);
  const defaultFrom = new Date(todayStart);
  defaultFrom.setDate(defaultFrom.getDate() - 7);

  const startISO = from ? new Date(from).toISOString() : defaultFrom.toISOString();
  const endISO = to ? new Date(to).toISOString() : now.toISOString();

  // Time-off runs on ET-local YYYY-MM-DD dates, so bucket the window on
  // those dates rather than the timestamp used for punches.
  const startDate = new Date(startISO);
  const endDate = new Date(endISO);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const windowFromDate = isoDate(startDate);
  const windowToDate = isoDate(endDate);
  const yearStart = `${now.getFullYear()}-01-01`;

  const [punchesRes, windowTimeOffRes, ytdTimeOffRes, overtimeRes] = await Promise.all([
    gate.supabase
      .from("time_punches")
      .select("id, profile_id, event_type, occurred_at, source, note, edited_by")
      .eq("profile_id", profileId)
      .gte("occurred_at", startISO)
      .lte("occurred_at", endISO)
      .order("occurred_at", { ascending: true }),
    // Time-off entries whose window overlaps the visible range. Managers
    // want to see "who was out on these days", including entries entered
    // by the employee (pending, approved) and by managers (approved).
    gate.supabase
      .from("time_off_requests")
      .select("id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_at, decided_by")
      .eq("profile_id", profileId)
      .lte("start_date", windowToDate)
      .gte("end_date", windowFromDate)
      .in("status", ["approved", "pending"])
      .order("start_date", { ascending: true }),
    // YTD approved for the stat card total.
    gate.supabase
      .from("time_off_requests")
      .select("type, start_date, end_date, full_day, hours")
      .eq("profile_id", profileId)
      .eq("status", "approved")
      .gte("start_date", yearStart),
    loadEmployeeOvertime(gate.supabase, profileId, now),
  ]);

  if (punchesRes.error) return NextResponse.json({ error: punchesRes.error.message }, { status: 500 });
  if (windowTimeOffRes.error) return NextResponse.json({ error: windowTimeOffRes.error.message }, { status: 500 });
  if (ytdTimeOffRes.error) return NextResponse.json({ error: ytdTimeOffRes.error.message }, { status: 500 });
  if (overtimeRes.error) return NextResponse.json({ error: overtimeRes.error }, { status: 500 });

  const ytdByType = emptyTimeOffByType();
  for (const t of ytdTimeOffRes.data || []) {
    const row = t as {
      type: TimeOffType;
      start_date: string;
      end_date: string;
      full_day: boolean;
      hours: number | null;
    };
    ytdByType[row.type] += requestDays(row);
  }
  const ytdTotal =
    ytdByType.vacation + ytdByType.sick + ytdByType.personal + ytdByType.parental + ytdByType.other;

  return NextResponse.json({
    profile: gate.target,
    punches: punchesRes.data || [],
    range: { from: startISO, to: endISO },
    time_off: {
      window: windowTimeOffRes.data || [],
      ytd: { ...ytdByType, total: ytdTotal },
    },
    overtime: overtimeRes.data,
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
