import { createAdminClient } from "@/lib/supabase/admin";
import {
  isTargetInScope,
  resolveTimeDataScope,
  type GateFailure,
} from "@/lib/auth/scope-check";
import { startOfDayInZone } from "@/lib/timesheets/tz";
import {
  emptyTimeOffByType,
  requestDays,
  withTotal,
  type TimeOffDaysRow,
  type TimeOffTotals,
  type TimeOffType,
  type TimeOffStatus,
} from "@/lib/timeoff/types";
import type { TimePunch } from "@/lib/timesheets/state";
import { fetchPunchesPaged } from "@/lib/timesheets/punches";
import {
  buildWeekStarts,
  computeWeeklyBreakdown,
  startOfYearWeekInZone,
  summarizeWeeks,
  type WeekTotals,
} from "@/lib/timesheets/weekly";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "next-auth";

// Server-side hydration for /management/timesheets/[profileId]. The GET
// handler at /api/management/timesheets/employee/[profileId] returns the
// same shape via the shared loadEmployeeWindow — this helper lets the page
// render the first payload without a client-side fetch.

export interface EmployeeDetailProfile {
  id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
  department: string | null;
  is_active: boolean;
  created_at: string;
}

export interface WindowTimeOffRow {
  id: string;
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  status: TimeOffStatus;
  reason: string | null;
  decided_note: string | null;
  decided_at: string | null;
  decided_by: string | null;
}

export type YtdBreakdown = TimeOffTotals;

// YTD weekly hours for one employee. Independent of the days-selector —
// overtime is a per-week (Sun–Sat, ET) figure, so a 7-day window would
// slice weeks in half.
export interface EmployeeOvertime {
  ytd_worked_ms: number;
  ytd_overtime_ms: number;
  ytd_overtime_weeks: number;
  weeks: WeekTotals[]; // oldest → newest, through the current week
}

export interface EmployeeDetailData {
  profile: EmployeeDetailProfile;
  punches: TimePunch[];
  range: { from: string; to: string };
  time_off: {
    window: WindowTimeOffRow[];
    ytd: YtdBreakdown;
  };
  overtime: EmployeeOvertime | null; // only when requested (timesheet page)
}

// Shared by getEmployeeDetail (SSR) and the GET route (client refresh).
export async function loadEmployeeOvertime(
  supabase: SupabaseClient,
  profileId: string,
  now: Date = new Date(),
): Promise<{ data: EmployeeOvertime | null; error: string | null }> {
  const ytdStart = startOfYearWeekInZone(now);
  const { data: punches, error } = await fetchPunchesPaged(
    supabase,
    [profileId],
    ytdStart.toISOString(),
  );
  if (error) return { data: null, error };
  const weeks = computeWeeklyBreakdown(punches, buildWeekStarts(ytdStart, now), now);
  const ytd = summarizeWeeks(weeks);
  return {
    data: {
      ytd_worked_ms: ytd.worked_ms,
      ytd_overtime_ms: ytd.overtime_ms,
      ytd_overtime_weeks: ytd.overtime_weeks,
      weeks,
    },
    error: null,
  };
}

export type EmployeeDetailResult =
  | { ok: true; data: EmployeeDetailData }
  | GateFailure;

export const EMPLOYEE_COLUMNS =
  "id, email, name:full_name, role, office, department, is_active, created_at";

// Normalizes the days-selector to a supported range. Anything unexpected
// falls back to 7 so a bad ?days= query string doesn't hard-fail the page.
export function coerceDays(raw: string | undefined | null): number {
  const n = raw === undefined || raw === null ? 7 : Number(raw);
  if (n === 1 || n === 7 || n === 14 || n === 30) return n;
  return 7;
}

// Punches + time-off (+ optional YTD overtime) for one employee over
// [startISO, endISO]. Shared by getEmployeeDetail (SSR) and the GET route
// (client refresh) so both paint identical payloads. Caller has already
// enforced scope.
export async function loadEmployeeWindow(
  supabase: SupabaseClient,
  profileId: string,
  startISO: string,
  endISO: string,
  { includeOvertime, now = new Date() }: { includeOvertime: boolean; now?: Date },
): Promise<{ ok: true; data: Omit<EmployeeDetailData, "profile"> } | GateFailure> {
  // Time-off runs on YYYY-MM-DD dates, so bucket the window on those dates
  // rather than the timestamps used for punches.
  const windowFromDate = startISO.slice(0, 10);
  const windowToDate = endISO.slice(0, 10);
  const yearStart = `${now.getFullYear()}-01-01`;

  const [punchesRes, windowTimeOffRes, ytdTimeOffRes, overtimeRes] = await Promise.all([
    supabase
      .from("time_punches")
      .select("id, profile_id, event_type, occurred_at, source, note, edited_by")
      .eq("profile_id", profileId)
      .gte("occurred_at", startISO)
      .lte("occurred_at", endISO)
      .order("occurred_at", { ascending: true }),
    // Time-off entries whose window overlaps the visible range — pending
    // and approved, whether entered by the employee or a manager.
    supabase
      .from("time_off_requests")
      .select("id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_at, decided_by")
      .eq("profile_id", profileId)
      .lte("start_date", windowToDate)
      .gte("end_date", windowFromDate)
      .in("status", ["approved", "pending"])
      .order("start_date", { ascending: true }),
    // YTD approved for the stat card total.
    supabase
      .from("time_off_requests")
      .select("type, start_date, end_date, full_day, hours")
      .eq("profile_id", profileId)
      .eq("status", "approved")
      .gte("start_date", yearStart),
    includeOvertime
      ? loadEmployeeOvertime(supabase, profileId, now)
      : { data: null, error: null },
  ]);

  const error =
    punchesRes.error?.message ??
    windowTimeOffRes.error?.message ??
    ytdTimeOffRes.error?.message ??
    overtimeRes.error;
  if (error) return { ok: false, status: 500, message: error };

  const ytdByType = emptyTimeOffByType();
  for (const row of (ytdTimeOffRes.data || []) as TimeOffDaysRow[]) {
    ytdByType[row.type] += requestDays(row);
  }

  return {
    ok: true,
    data: {
      punches: (punchesRes.data || []) as TimePunch[],
      range: { from: startISO, to: endISO },
      time_off: {
        window: (windowTimeOffRes.data || []) as WindowTimeOffRow[],
        ytd: withTotal(ytdByType),
      },
      overtime: overtimeRes.data,
    },
  };
}

// Server-component entry: same auth + scope rules as the GET route, but
// returns a plain payload (or status + message) instead of a NextResponse.
export async function getEmployeeDetail(
  profileId: string,
  days: number,
  viewer: Pick<Session["user"], "role" | "department" | "office">,
  // YTD overtime reads a year of punches; only the timesheet page shows it.
  { includeOvertime = false }: { includeOvertime?: boolean } = {},
): Promise<EmployeeDetailResult> {
  const access = resolveTimeDataScope(viewer, "view");
  if (!access.ok) return access;

  const supabase = createAdminClient();
  const { data: target, error: targetErr } = await supabase
    .from("profiles")
    .select(EMPLOYEE_COLUMNS)
    .eq("id", profileId)
    .single<EmployeeDetailProfile>();
  if (targetErr || !target) {
    return { ok: false, status: 404, message: "Not found" };
  }
  if (!access.viewerIsAdmin && !isTargetInScope(access.scope, target)) {
    return { ok: false, status: 403, message: "Out of scope" };
  }

  // Window = start of the ET day `days` days back, through now.
  const now = new Date();
  const from = startOfDayInZone(now);
  from.setDate(from.getDate() - days);

  const res = await loadEmployeeWindow(supabase, profileId, from.toISOString(), now.toISOString(), {
    includeOvertime,
    now,
  });
  if (!res.ok) return res;
  return { ok: true, data: { profile: target, ...res.data } };
}
