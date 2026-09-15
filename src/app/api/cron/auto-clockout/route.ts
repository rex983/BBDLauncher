import { createAdminClient } from "@/lib/supabase/admin";
import type { PunchEventType } from "@/lib/timesheets/state";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// Auto-clockout: runs every 5 minutes. For each employee who is currently
// on the clock past their (scheduled + any extension) end time, insert a
// clock_out punch at exactly that end time so timesheets reflect the
// intended stop, not when the cron happened to fire.
//
// The T-5 min "still working?" popup lives client-side. If the employee
// clicks "yes 30 min", they hit POST /api/timeclock/extend which upserts a
// row in time_extensions; this cron reads it. If they dismiss or ignore,
// we clock them out.

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization");
    if (header === `Bearer ${secret}`) return true;
  }
  if (req.headers.get("x-vercel-cron") === "1") return true;
  return false;
}

const DEFAULT_WORKDAYS = new Set([1, 2, 3, 4, 5]);
const DEFAULT_END = "18:00";

function toLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const weekday = now.getDay();
  const localDate = toLocalDate(now);
  const startOfDayIso = new Date(now).setHours(0, 0, 0, 0);

  // Find everyone with a punch today whose latest event isn't clock_out.
  const { data: today, error: recentErr } = await supabase
    .from("time_punches")
    .select("profile_id, event_type, occurred_at")
    .gte("occurred_at", new Date(startOfDayIso).toISOString())
    .order("occurred_at", { ascending: false });
  if (recentErr) return NextResponse.json({ error: recentErr.message }, { status: 500 });

  const latest = new Map<string, PunchEventType>();
  for (const row of today || []) {
    if (!latest.has(row.profile_id)) latest.set(row.profile_id, row.event_type as PunchEventType);
  }
  const onClock: string[] = [];
  for (const [profile_id, eventType] of latest) {
    if (eventType !== "clock_out") onClock.push(profile_id);
  }
  if (onClock.length === 0) {
    return NextResponse.json({ ok: true, clocked_out: 0, ran_at: now.toISOString() });
  }

  // Fetch schedules + extensions for the on-clock cohort in parallel.
  const [schedRes, hasAnySchedRes, extRes] = await Promise.all([
    supabase
      .from("work_schedules")
      .select("profile_id, end_time")
      .in("profile_id", onClock)
      .eq("weekday", weekday),
    supabase
      .from("work_schedules")
      .select("profile_id")
      .in("profile_id", onClock),
    supabase
      .from("time_extensions")
      .select("profile_id, extension_until")
      .in("profile_id", onClock)
      .eq("local_date", localDate),
  ]);

  const schedEndByProfile = new Map<string, string>(
    (schedRes.data || []).map((r) => [r.profile_id, r.end_time as string]),
  );
  const hasAnyOverride = new Set<string>((hasAnySchedRes.data || []).map((r) => r.profile_id));
  const extensionByProfile = new Map<string, string>(
    (extRes.data || []).map((r) => [r.profile_id, r.extension_until as string]),
  );

  const toClockOut: { profile_id: string; occurred_at: string }[] = [];
  for (const profile_id of onClock) {
    // Determine effective end. If they have an override for today, use it.
    // If they have any override rows but not today's, they're not scheduled
    // today — skip; nightly midnight cron will handle any straggler.
    // If they have no override rows at all, fall back to Mon-Fri 18:00.
    const overrideEnd = schedEndByProfile.get(profile_id);
    let scheduledEnd: Date | null = null;
    if (overrideEnd) {
      const [h, m] = overrideEnd.split(":").map(Number);
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      scheduledEnd = d;
    } else if (!hasAnyOverride.has(profile_id) && DEFAULT_WORKDAYS.has(weekday)) {
      const [h, m] = DEFAULT_END.split(":").map(Number);
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      scheduledEnd = d;
    }
    const extensionEnd = extensionByProfile.get(profile_id)
      ? new Date(extensionByProfile.get(profile_id)!)
      : null;
    const effectiveEnd =
      extensionEnd && scheduledEnd
        ? extensionEnd > scheduledEnd
          ? extensionEnd
          : scheduledEnd
        : extensionEnd ?? scheduledEnd;
    if (!effectiveEnd) continue;
    if (now < effectiveEnd) continue;

    toClockOut.push({ profile_id, occurred_at: effectiveEnd.toISOString() });
  }

  let clockedOut = 0;
  if (toClockOut.length > 0) {
    const { error: insertErr } = await supabase.from("time_punches").insert(
      toClockOut.map((row) => ({
        profile_id: row.profile_id,
        event_type: "clock_out",
        occurred_at: row.occurred_at,
        source: "auto",
        note: "Auto clock-out at scheduled end",
      })),
    );
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
    clockedOut = toClockOut.length;
  }

  return NextResponse.json({
    ok: true,
    clocked_out: clockedOut,
    checked: onClock.length,
    ran_at: now.toISOString(),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
