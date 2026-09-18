import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { analyticsScope, canViewTimeData } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  coerceDays,
  getEmployeeDetail,
  type EmployeeDetailData,
} from "@/lib/timesheets/detail";
import { UserProfile360Shell } from "@/components/features/admin/UserProfile360Shell";
import type { IncidentSummary } from "@/components/features/incidents/IncidentPanel";

const RANGES = new Set(["24h", "7d", "30d", "90d", "all"]);

// Employee 360 view — merges the launcher analytics for one user with the
// full manager timesheet detail (punches, schedule, time-off, incidents).
// The page hydrates server-side; the client shell handles range changes and
// tab switching. Analytics is still served by /api/analytics/users/[id], so
// the client re-fetches that route when the range picker changes.
export default async function UserProfile360Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
  const { range: rawRange } = await searchParams;

  const session = await auth();
  if (!session?.user) redirect("/login");

  // Access gate is the analytics scope — same as the previous page. Time
  // data + incidents show only if the viewer ALSO has time-data scope over
  // this employee, which is stricter (department + office intersect).
  const scope = analyticsScope(session.user.role, session.user.office ?? null);
  if (!scope.allowed) redirect("/dashboard");

  const range = rawRange && RANGES.has(rawRange) ? rawRange : "30d";

  const supabase = createAdminClient();

  // Cheap profile pull up front so we can render the header even when the
  // deeper queries error.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name:full_name, role, office, department, is_it, is_active, created_at")
    .eq("id", id)
    .maybeSingle();

  if (profile && scope.office && profile.office !== scope.office) {
    // Office-scoped viewer trying to peek at another office's user.
    redirect("/admin/analytics");
  }

  // Time-data scope is a superset of the analytics gate for its own decisions
  // (dept + office). We attempt the fetch and let the helper tell us "no
  // scope" without redirecting — the UI degrades gracefully.
  const hasTimeDataRole = canViewTimeData(session.user.role);

  const days = coerceRangeToDays(range);

  const [timeResult, scheduleRes, incidentsRes] = await Promise.all([
    hasTimeDataRole
      ? getEmployeeDetail(
          id,
          days,
          session.user.profileId,
          session.user.role ?? "",
          session.user.department ?? null,
          session.user.office ?? null,
        )
      : Promise.resolve({ ok: false as const, status: 403, message: "No time-data role" }),
    hasTimeDataRole
      ? supabase
          .from("work_schedules")
          .select("weekday, start_time, end_time, timezone")
          .eq("profile_id", id)
      : Promise.resolve({ data: null }),
    hasTimeDataRole
      ? supabase
          .from("incident_reports")
          .select(
            "id, title, severity, category, status, occurred_at, manager_signed_at, employee_signed_at, attachments, created_at",
          )
          .eq("employee_profile_id", id)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: null }),
  ]);

  const timeData: EmployeeDetailData | null = timeResult.ok ? timeResult.data : null;
  const timeDataError = !timeResult.ok
    ? timeResult.message === "No time-data role"
      ? "Time data isn't available at your access level."
      : timeResult.message
    : null;

  const workSchedule = (scheduleRes.data ?? []) as {
    weekday: number;
    start_time: string;
    end_time: string;
    timezone: string;
  }[];

  const incidents = (incidentsRes.data ?? []) as IncidentSummary[];

  return (
    <UserProfile360Shell
      userId={id}
      initialRange={range}
      profile={profile}
      initialDays={days}
      timeData={timeData}
      timeDataError={timeDataError}
      workSchedule={workSchedule}
      incidents={incidents}
    />
  );
}

// Map analytics range → timesheet punches window. `getEmployeeDetail` only
// supports 1/7/14/30 (per `coerceDays`), so 90d/all fall back to 30 for the
// initial punches SSR — the analytics side handles the wider windows
// independently via its own paginated audit-log query.
function coerceRangeToDays(range: string): number {
  if (range === "24h") return 1;
  if (range === "7d") return 7;
  return coerceDays("30");
}
