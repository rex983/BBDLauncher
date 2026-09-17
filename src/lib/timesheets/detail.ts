import { createAdminClient } from "@/lib/supabase/admin";
import {
  canViewTimeData,
  isAdmin,
  timeDataScope,
} from "@/lib/auth/permissions";
import { startOfDayInZone } from "@/lib/timesheets/tz";
import { requestDays, type TimeOffType, type TimeOffStatus } from "@/lib/timeoff/types";
import type { TimePunch } from "@/lib/timesheets/state";
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

export interface EmployeeDetailData {
  profile: EmployeeDetailProfile;
  punches: TimePunch[];
  range: { from: string; to: string };
  time_off: {
    window: WindowTimeOffRow[];
    ytd: YtdBreakdown;
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

function emptyYtd(): YtdBreakdown {
  return { vacation: 0, sick: 0, personal: 0, parental: 0, other: 0, total: 0 };
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

  const [punchesRes, windowTimeOffRes, ytdTimeOffRes] = await Promise.all([
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

  const ytd = emptyYtd();
  for (const t of ytdTimeOffRes.data || []) {
    const row = t as {
      type: TimeOffType;
      start_date: string;
      end_date: string;
      full_day: boolean;
      hours: number | null;
    };
    ytd[row.type] += requestDays(row);
  }
  ytd.total =
    ytd.vacation + ytd.sick + ytd.personal + ytd.parental + ytd.other;

  return {
    ok: true,
    data: {
      profile: target,
      punches: (punchesRes.data || []) as TimePunch[],
      range: { from: startISO, to: endISO },
      time_off: {
        window: (windowTimeOffRes.data || []) as WindowTimeOffRow[],
        ytd,
      },
    },
  };
}
