import { createAdminClient } from "@/lib/supabase/admin";
import {
  canViewTimeData,
  isAdmin,
  timeDataScope,
} from "@/lib/auth/permissions";
import { startOfDayInZone } from "@/lib/timesheets/tz";
import {
  emptyTimeOffByType,
  requestDays,
  withTotal,
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
import type { Department, Office, UserRole } from "@/types/auth";

// Server-side hydration for /management/timesheets/[profileId]. The GET
// handler at /api/management/timesheets/employee/[profileId] returns the
// same shape — this helper lets the page render the first payload without
// a client-side fetch. Days-selector changes still re-fetch the route.
//
// Kept in sync with that route: any query change here should mirror the
// route (or vice-versa) so client-side reloads and the initial SSR paint
// stay consistent.

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

export type YtdBreakdown = Record<TimeOffType, number> & { total: number };

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
  | { ok: false; status: number; message: string };

const EMPLOYEE_COLUMNS =
  "id, email, name:full_name, role, office, department, is_active, created_at";

interface EmployeeScopeRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
  department: string | null;
  is_active: boolean;
  created_at: string;
}

// Normalizes the days-selector to a supported range. Anything unexpected
// falls back to 7 so a bad ?days= query string doesn't hard-fail the page.
export function coerceDays(raw: string | undefined | null): number {
  const n = raw === undefined || raw === null ? 7 : Number(raw);
  if (n === 1 || n === 7 || n === 14 || n === 30) return n;
  return 7;
}

// Replicates the auth + scope + query logic from the GET route. Returns a
// plain data payload (or an error status + message) rather than a
// NextResponse so it's usable from server components.
export async function getEmployeeDetail(
  profileId: string,
  days: number,
  viewerProfileId: string,
  viewerRole: string,
  viewerDepartment: string | null,
  viewerOffice: string | null,
  // YTD overtime reads a year of punches; only the timesheet page shows it.
  { includeOvertime = false }: { includeOvertime?: boolean } = {},
): Promise<EmployeeDetailResult> {
  void viewerProfileId; // reserved for future audit logging; scope keys off role/dept/office

  if (!canViewTimeData(viewerRole as UserRole)) {
    return { ok: false, status: 403, message: "Unauthorized" };
  }

  const scope = timeDataScope(
    viewerRole as UserRole,
    viewerDepartment as Department | null,
    viewerOffice as Office | null,
  );
  if (!scope.allowed) {
    return { ok: false, status: 403, message: "No scope" };
  }

  const supabase = createAdminClient();

  const { data: target, error: targetErr } = await supabase
    .from("profiles")
    .select(EMPLOYEE_COLUMNS)
    .eq("id", profileId)
    .single<EmployeeScopeRow>();
  if (targetErr || !target) {
    return { ok: false, status: 404, message: "Not found" };
  }

  const viewerIsAdmin = isAdmin(viewerRole as UserRole);
  if (!viewerIsAdmin) {
    if (target.is_active === false) {
      return { ok: false, status: 403, message: "Out of scope" };
    }
    if (scope.department && target.department !== scope.department) {
      return { ok: false, status: 403, message: "Out of scope" };
    }
    if (scope.office && target.office !== scope.office) {
      return { ok: false, status: 403, message: "Out of scope" };
    }
  }

  // Mirror the client's window math: from = start-of-ET-day, `days` days back
  // through `now`. The GET route uses the same default when the query params
  // are absent — but here we're the source of truth, so compute explicitly.
  const now = new Date();
  const todayStart = startOfDayInZone(now);
  const from = new Date(todayStart);
  from.setDate(from.getDate() - days);
  const startISO = from.toISOString();
  const endISO = now.toISOString();

  const startDate = new Date(startISO);
  const endDate = new Date(endISO);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const windowFromDate = isoDate(startDate);
  const windowToDate = isoDate(endDate);
  const yearStart = `${now.getFullYear()}-01-01`;

  const [punchesRes, windowTimeOffRes, ytdTimeOffRes, overtimeRes] = await Promise.all([
    supabase
      .from("time_punches")
      .select("id, profile_id, event_type, occurred_at, source, note, edited_by")
      .eq("profile_id", profileId)
      .gte("occurred_at", startISO)
      .lte("occurred_at", endISO)
      .order("occurred_at", { ascending: true }),
    supabase
      .from("time_off_requests")
      .select("id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_at, decided_by")
      .eq("profile_id", profileId)
      .lte("start_date", windowToDate)
      .gte("end_date", windowFromDate)
      .in("status", ["approved", "pending"])
      .order("start_date", { ascending: true }),
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

  if (punchesRes.error) {
    return { ok: false, status: 500, message: punchesRes.error.message };
  }
  if (windowTimeOffRes.error) {
    return { ok: false, status: 500, message: windowTimeOffRes.error.message };
  }
  if (ytdTimeOffRes.error) {
    return { ok: false, status: 500, message: ytdTimeOffRes.error.message };
  }
  if (overtimeRes.error) {
    return { ok: false, status: 500, message: overtimeRes.error };
  }

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

  return {
    ok: true,
    data: {
      profile: target,
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
