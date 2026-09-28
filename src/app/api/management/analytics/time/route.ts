import { requireTimeDataAccess, scopeProfilesQuery } from "@/lib/auth/scope-check";
import type { TimePunch } from "@/lib/timesheets/state";
import {
  buildWeekStarts,
  computeWeeklyBreakdown,
  lastWeekStarts,
  startOfYearWeekInZone,
  summarizeWeeks,
} from "@/lib/timesheets/weekly";
import { fetchPunchesPaged } from "@/lib/timesheets/punches";
import {
  emptyTimeOffByType,
  requestDays,
  TIME_OFF_TYPES,
  withTotal,
  type TimeOffByType,
  type TimeOffType,
} from "@/lib/timeoff/types";
import { NextRequest, NextResponse } from "next/server";

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
  // One zone-local week list covering both the selected range and YTD
  // (whichever reaches further back); range + YTD are slices of it.
  const ytdStart = startOfYearWeekInZone(now);
  const rangeStart = lastWeekStarts(weeks, now)[0];
  const allWeekStarts = buildWeekStarts(rangeStart < ytdStart ? rangeStart : ytdStart, now);
  const rangeFirstIdx = allWeekStarts.length - weeks;
  const ytdFirstIdx = allWeekStarts.findIndex((d) => d >= ytdStart);
  const weekStartIsos = allWeekStarts.slice(rangeFirstIdx).map((d) => d.toISOString());

  const { data: profiles, error: pErr } = await scopeProfilesQuery(
    supabase.from("profiles").select("id, email, name:full_name, office, department, is_active"),
    scope,
    { department: departmentFilter, office: officeFilter, includeInactive },
  ).order("email");
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const profileIds = (profiles || []).map((p) => p.id);

  // Punches reach back to whichever is earlier: the selected range or the
  // start of the year (YTD overtime). Paged — see fetchPunchesPaged.
  const [punchesRes, { data: yearOffs, error: toErr }] = await Promise.all([
    fetchPunchesPaged(supabase, profileIds, allWeekStarts[0].toISOString()),
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
    const range = summarizeWeeks(rangeWeeks);
    const ytd = summarizeWeeks(allWeeks.slice(ytdFirstIdx));
    return {
      profile,
      total_ms: range.worked_ms,
      overtime_ms: range.overtime_ms,
      overtime_weeks: range.overtime_weeks,
      lunch_ms: range.lunch_ms,
      break_ms: range.break_ms,
      ytd_worked_ms: ytd.worked_ms,
      ytd_overtime_ms: ytd.overtime_ms,
      ytd_overtime_weeks: ytd.overtime_weeks,
      time_off: withTotal(timeOffByProfile.get(profile.id) ?? emptyTimeOffByType()),
      weeks: rangeWeeks,
    };
  });

  rows.sort((a, b) => b.total_ms - a.total_ms);

  const team = summarizeWeeks(rows.flatMap((r) => r.weeks));
  let workingProfileCount = 0;
  let inOvertimeCount = 0;
  let ytdOvertime = 0;
  let ytdInOvertimeCount = 0;
  for (const r of rows) {
    if (r.total_ms > 0) workingProfileCount++;
    if (r.overtime_ms > 0) inOvertimeCount++;
    ytdOvertime += r.ytd_overtime_ms;
    if (r.ytd_overtime_ms > 0) ytdInOvertimeCount++;
  }

  // Team roll-up per week so the tab can show whether overtime is a
  // one-off spike or a steady trend. Across rows, "weeks over 40h" for a
  // single week is the number of employees in overtime.
  const weekly = weekStartIsos.map((week_start, i) => {
    const s = summarizeWeeks(rows.map((r) => r.weeks[i]));
    return {
      week_start,
      worked_ms: s.worked_ms,
      overtime_ms: s.overtime_ms,
      in_overtime_count: s.overtime_weeks,
    };
  });

  // Aggregate YTD time-off across the scope so the top-of-tab panel can
  // show "team took N sick days this year" etc. without a second call.
  const aggTimeOff = emptyTimeOffByType();
  for (const r of rows) {
    for (const { value } of TIME_OFF_TYPES) aggTimeOff[value] += r.time_off[value];
  }

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
      total_ms: team.worked_ms,
      total_overtime_ms: team.overtime_ms,
      total_lunch_ms: team.lunch_ms,
      total_break_ms: team.break_ms,
      in_overtime_count: inOvertimeCount,
      ytd_overtime_ms: ytdOvertime,
      ytd_in_overtime_count: ytdInOvertimeCount,
      avg_ms_per_working_employee: workingProfileCount
        ? Math.round(team.worked_ms / workingProfileCount)
        : 0,
      time_off: withTotal(aggTimeOff),
      weekly,
    },
  });
}
