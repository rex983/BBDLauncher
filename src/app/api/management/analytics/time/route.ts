import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import type { TimePunch } from "@/lib/timesheets/state";
import {
  buildWeekStarts,
  computeWeeklyBreakdown,
  startOfYearWeekInZone,
  type WeekTotals,
} from "@/lib/timesheets/weekly";
import { fetchPunchesPaged } from "@/lib/timesheets/punches";
import { requestDays, type TimeOffType } from "@/lib/timeoff/types";
import { NextRequest, NextResponse } from "next/server";

const TIME_OFF_TYPES_ALL: TimeOffType[] = ["vacation", "sick", "personal", "parental", "other"];
type TimeOffByType = Record<TimeOffType, number>;
function emptyTimeOffByType(): TimeOffByType {
  return { vacation: 0, sick: 0, personal: 0, parental: 0, other: 0 };
}

// Time-data analytics for managers + admins. Returns per-employee weekly
// totals for the last N weeks, YTD overtime (weeks past 40h since the week
// containing Jan 1), a per-week team roll-up, and a summary block. Scope
// follows the same (office ∩ department ∩ is_active) rules as the rest of
// /management.
//
// ?weeks=1|2|4|12  (default 4)
// ?office=…        (admin overlay — ignored when scope.office is set)
// ?department=…    (admin overlay — ignored when scope.department is set)
// ?includeInactive=1 (admin only; shows deactivated employees who still
//                    have punches in the range)

const ALLOWED_WEEK_COUNTS = new Set([1, 2, 4, 12]);
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { session, supabase, scope } = gate;

  const url = new URL(req.url);
  const weeksParam = Number(url.searchParams.get("weeks") ?? "4");
  const weeks = ALLOWED_WEEK_COUNTS.has(weeksParam) ? weeksParam : 4;
  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  const isAdmin = session.user.role === "admin";
  const includeInactive =
    isAdmin && url.searchParams.get("includeInactive") === "1";

  const now = new Date();
  // Walk back a spare week then keep the last N zone-local week starts, so
  // a DST shift can't pull the range boundary off Sunday midnight.
  const rangeStart = buildWeekStarts(
    new Date(now.getTime() - weeks * MS_PER_WEEK),
    now,
  ).slice(-weeks)[0];

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
      ytd_from: startOfYearWeekInZone(now).toISOString(),
      week_starts: buildWeekStarts(rangeStart, now).map((d) => d.toISOString()),
      rows: [],
      summary: emptySummary(),
    });
  }

  // Punches reach back to whichever is earlier: the selected range or the
  // start of the year (YTD overtime). Paged — see fetchPunchesPaged.
  const ytdStart = startOfYearWeekInZone(now);
  const fetchStart = rangeStart < ytdStart ? rangeStart : ytdStart;

  const [punchesRes, { data: yearOffs, error: toErr }] = await Promise.all([
    fetchPunchesPaged(supabase, profileIds, fetchStart.toISOString()),
    // YTD approved time-off — used for per-employee breakdown + the
    // aggregate summary. Kept independent of the `weeks` selector
    // because "days off this year" is what managers ask about, not
    // "days off in the last 4 weeks".
    supabase
      .from("time_off_requests")
      .select("profile_id, type, start_date, end_date, full_day, hours")
      .in("profile_id", profileIds)
      .eq("status", "approved")
      .gte("start_date", `${now.getFullYear()}-01-01`),
  ]);
  if (punchesRes.error) return NextResponse.json({ error: punchesRes.error }, { status: 500 });
  if (toErr) return NextResponse.json({ error: toErr.message }, { status: 500 });

  const allWeekStarts = buildWeekStarts(fetchStart, now);
  const rangeFirstIdx = allWeekStarts.length - weeks;
  const ytdStartMs = ytdStart.getTime();
  const weekStartIsos = allWeekStarts.slice(rangeFirstIdx).map((d) => d.toISOString());

  const punchesByProfile = new Map<string, TimePunch[]>();
  for (const p of punchesRes.data) {
    const list = punchesByProfile.get(p.profile_id) || [];
    list.push(p);
    punchesByProfile.set(p.profile_id, list);
  }

  // Fold YTD approved time-off into per-employee days-by-type. `requestDays`
  // handles full-day (business-day count) vs partial-day (hours/8) semantics.
  const timeOffByProfile = new Map<string, TimeOffByType>();
  for (const t of yearOffs || []) {
    const row = t as {
      profile_id: string;
      type: TimeOffType;
      start_date: string;
      end_date: string;
      full_day: boolean;
      hours: number | null;
    };
    const existing = timeOffByProfile.get(row.profile_id) ?? emptyTimeOffByType();
    existing[row.type] += requestDays(row);
    timeOffByProfile.set(row.profile_id, existing);
  }

  const rows = (profiles || []).map((profile) => {
    const allWeeks = computeWeeklyBreakdown(
      punchesByProfile.get(profile.id) || [],
      allWeekStarts,
      now,
    );
    const rangeWeeks = allWeeks.slice(rangeFirstIdx);
    const ytdWeeks = allWeeks.filter(
      (w) => new Date(w.week_start).getTime() >= ytdStartMs,
    );
    const sum = (list: WeekTotals[], k: keyof Omit<WeekTotals, "week_start">) =>
      list.reduce((acc, w) => acc + w[k], 0);
    const timeOff = timeOffByProfile.get(profile.id) ?? emptyTimeOffByType();
    const timeOffTotal =
      timeOff.vacation + timeOff.sick + timeOff.personal + timeOff.parental + timeOff.other;
    return {
      profile,
      total_ms: sum(rangeWeeks, "worked_ms"),
      overtime_ms: sum(rangeWeeks, "overtime_ms"),
      overtime_weeks: rangeWeeks.filter((w) => w.overtime_ms > 0).length,
      lunch_ms: sum(rangeWeeks, "lunch_ms"),
      break_ms: sum(rangeWeeks, "break_ms"),
      ytd_worked_ms: sum(ytdWeeks, "worked_ms"),
      ytd_overtime_ms: sum(ytdWeeks, "overtime_ms"),
      ytd_overtime_weeks: ytdWeeks.filter((w) => w.overtime_ms > 0).length,
      time_off: { ...timeOff, total: timeOffTotal },
      weeks: rangeWeeks.map(({ week_start, worked_ms, overtime_ms }) => ({
        week_start,
        worked_ms,
        overtime_ms,
      })),
    };
  });

  rows.sort((a, b) => b.total_ms - a.total_ms);

  const workingProfileCount = rows.filter((r) => r.total_ms > 0).length;
  const totalMs = rows.reduce((acc, r) => acc + r.total_ms, 0);
  const totalOvertime = rows.reduce((acc, r) => acc + r.overtime_ms, 0);
  const totalLunch = rows.reduce((acc, r) => acc + r.lunch_ms, 0);
  const totalBreak = rows.reduce((acc, r) => acc + r.break_ms, 0);
  const inOvertimeCount = rows.filter((r) => r.overtime_ms > 0).length;
  const ytdOvertime = rows.reduce((acc, r) => acc + r.ytd_overtime_ms, 0);
  const ytdInOvertimeCount = rows.filter((r) => r.ytd_overtime_ms > 0).length;

  // Team roll-up per week so the tab can show whether overtime is a
  // one-off spike or a steady trend.
  const weekly = weekStartIsos.map((week_start, i) => {
    let worked = 0;
    let overtime = 0;
    let inOt = 0;
    for (const r of rows) {
      const w = r.weeks[i];
      worked += w.worked_ms;
      overtime += w.overtime_ms;
      if (w.overtime_ms > 0) inOt++;
    }
    return { week_start, worked_ms: worked, overtime_ms: overtime, in_overtime_count: inOt };
  });

  // Aggregate YTD time-off across the scope so the top-of-tab panel can
  // show "team took N sick days this year" etc. without a second call.
  const aggTimeOff = emptyTimeOffByType();
  for (const r of rows) {
    for (const t of TIME_OFF_TYPES_ALL) aggTimeOff[t] += r.time_off[t];
  }
  const aggTimeOffTotal =
    aggTimeOff.vacation + aggTimeOff.sick + aggTimeOff.personal + aggTimeOff.parental + aggTimeOff.other;

  return NextResponse.json({
    range: {
      from: rangeStart.toISOString(),
      to: now.toISOString(),
      weeks,
    },
    ytd_from: ytdStart.toISOString(),
    week_starts: weekStartIsos,
    rows,
    summary: {
      employee_count: rows.length,
      working_employee_count: workingProfileCount,
      total_ms: totalMs,
      total_overtime_ms: totalOvertime,
      total_lunch_ms: totalLunch,
      total_break_ms: totalBreak,
      in_overtime_count: inOvertimeCount,
      ytd_overtime_ms: ytdOvertime,
      ytd_in_overtime_count: ytdInOvertimeCount,
      avg_ms_per_working_employee: workingProfileCount
        ? Math.round(totalMs / workingProfileCount)
        : 0,
      time_off: { ...aggTimeOff, total: aggTimeOffTotal },
      weekly,
    },
  });
}

function emptySummary() {
  return {
    employee_count: 0,
    working_employee_count: 0,
    total_ms: 0,
    total_overtime_ms: 0,
    total_lunch_ms: 0,
    total_break_ms: 0,
    in_overtime_count: 0,
    ytd_overtime_ms: 0,
    ytd_in_overtime_count: 0,
    avg_ms_per_working_employee: 0,
    time_off: { ...emptyTimeOffByType(), total: 0 },
    weekly: [],
  };
}
