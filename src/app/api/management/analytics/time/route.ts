import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
import { type TimePunch } from "@/lib/timesheets/state";
import {
  computeDayWorkedMs,
  OVERTIME_THRESHOLD_MS,
} from "@/lib/timesheets/weekly";
import { localDateInZone, startOfWeekSundayInZone } from "@/lib/timesheets/tz";
import { NextRequest, NextResponse } from "next/server";

// Time-data analytics for managers + admins. Returns per-employee weekly
// totals for the last N weeks + a summary block. Scope follows the same
// (office ∩ department ∩ is_active) rules as the rest of /management.
//
// ?weeks=1|2|4|12  (default 4)
// ?office=…        (admin overlay — ignored when scope.office is set)
// ?department=…    (admin overlay — ignored when scope.department is set)
// ?includeInactive=1 (admin only; shows deactivated employees who still
//                    have punches in the range)

const ALLOWED_WEEK_COUNTS = new Set([1, 2, 4, 12]);
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canViewTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const scope = timeDataScope(
    session.user.role,
    session.user.department,
    session.user.office,
  );
  if (!scope.allowed) return NextResponse.json({ error: "No scope" }, { status: 403 });

  const url = new URL(req.url);
  const weeksParam = Number(url.searchParams.get("weeks") ?? "4");
  const weeks = ALLOWED_WEEK_COUNTS.has(weeksParam) ? weeksParam : 4;
  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  const isAdmin = session.user.role === "admin";
  const includeInactive =
    isAdmin && url.searchParams.get("includeInactive") === "1";

  const supabase = createAdminClient();
  const now = new Date();
  const thisWeekStart = startOfWeekSundayInZone(now);
  const rangeStart = new Date(thisWeekStart.getTime() - (weeks - 1) * MS_PER_WEEK);

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department, is_active")
    .order("email");
  if (!includeInactive) profileQuery = profileQuery.eq("is_active", true);
  if (scope.department) {
    profileQuery = profileQuery.eq("department", scope.department);
  } else if (departmentFilter) {
    profileQuery = profileQuery.eq("department", departmentFilter);
  }
  if (scope.office) {
    profileQuery = profileQuery.eq("office", scope.office);
  } else if (officeFilter) {
    profileQuery = profileQuery.eq("office", officeFilter);
  }

  const { data: profiles, error: pErr } = await profileQuery;
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) {
    return NextResponse.json({
      range: {
        from: rangeStart.toISOString(),
        to: now.toISOString(),
        weeks,
      },
      week_starts: buildWeekStarts(thisWeekStart, weeks),
      rows: [],
      summary: emptySummary(),
    });
  }

  const { data: punches, error: puErr } = await supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at, source, note")
    .in("profile_id", profileIds)
    .gte("occurred_at", rangeStart.toISOString())
    .order("occurred_at", { ascending: true });
  if (puErr) return NextResponse.json({ error: puErr.message }, { status: 500 });

  // Bucket punches by (profile, week) via ET-local date.
  const weekStarts = buildWeekStarts(thisWeekStart, weeks);
  const weekStartIsos = weekStarts.map((d) => d.toISOString());
  const weekIndexOf = (occurredAt: string): number => {
    const t = new Date(occurredAt).getTime();
    for (let i = 0; i < weekStarts.length; i++) {
      const start = weekStarts[i].getTime();
      const end = start + MS_PER_WEEK;
      if (t >= start && t < end) return i;
    }
    return -1;
  };

  interface DayBucket {
    date: string;
    punches: TimePunch[];
  }
  const perProfile = new Map<string, DayBucket[][]>();
  for (const p of profiles || []) {
    const emptyWeeks: DayBucket[][] = [];
    for (let i = 0; i < weeks; i++) emptyWeeks.push([]);
    perProfile.set(p.id, emptyWeeks);
  }

  for (const p of (punches || []) as TimePunch[]) {
    const wIndex = weekIndexOf(p.occurred_at);
    if (wIndex < 0) continue;
    const profileWeeks = perProfile.get(p.profile_id);
    if (!profileWeeks) continue;
    const dayKey = localDateInZone(new Date(p.occurred_at));
    const dayBuckets = profileWeeks[wIndex];
    let day = dayBuckets.find((d) => d.date === dayKey);
    if (!day) {
      day = { date: dayKey, punches: [] };
      dayBuckets.push(day);
    }
    day.punches.push(p);
  }

  const rows = (profiles || []).map((profile) => {
    const profileWeeks = perProfile.get(profile.id) || [];
    let profileTotal = 0;
    let profileOvertime = 0;
    const weekTotals = profileWeeks.map((dayBuckets, idx) => {
      let weekTotal = 0;
      for (const day of dayBuckets) {
        weekTotal += computeDayWorkedMs(day.punches, day.date, now);
      }
      const overtime = Math.max(0, weekTotal - OVERTIME_THRESHOLD_MS);
      profileTotal += weekTotal;
      profileOvertime += overtime;
      return {
        week_start: weekStartIsos[idx],
        worked_ms: weekTotal,
        overtime_ms: overtime,
      };
    });
    return {
      profile,
      total_ms: profileTotal,
      overtime_ms: profileOvertime,
      weeks: weekTotals,
    };
  });

  rows.sort((a, b) => b.total_ms - a.total_ms);

  const workingProfileCount = rows.filter((r) => r.total_ms > 0).length;
  const totalMs = rows.reduce((acc, r) => acc + r.total_ms, 0);
  const totalOvertime = rows.reduce((acc, r) => acc + r.overtime_ms, 0);
  const inOvertimeCount = rows.filter((r) => r.overtime_ms > 0).length;

  return NextResponse.json({
    range: {
      from: rangeStart.toISOString(),
      to: now.toISOString(),
      weeks,
    },
    week_starts: weekStartIsos,
    rows,
    summary: {
      employee_count: rows.length,
      working_employee_count: workingProfileCount,
      total_ms: totalMs,
      total_overtime_ms: totalOvertime,
      in_overtime_count: inOvertimeCount,
      avg_ms_per_working_employee: workingProfileCount
        ? Math.round(totalMs / workingProfileCount)
        : 0,
    },
  });
}

function buildWeekStarts(thisWeekStart: Date, weeks: number): Date[] {
  const starts: Date[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    starts.push(new Date(thisWeekStart.getTime() - i * MS_PER_WEEK));
  }
  return starts;
}

function emptySummary() {
  return {
    employee_count: 0,
    working_employee_count: 0,
    total_ms: 0,
    total_overtime_ms: 0,
    in_overtime_count: 0,
    avg_ms_per_working_employee: 0,
  };
}
