import { auth } from "@/auth";
import { isAnalyticsRange } from "@/lib/analytics/ranges";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedRoles } from "@/lib/launcher/cache";
import { getOrgLists } from "@/lib/org/lists";
import { loadPersonSummary } from "@/lib/people/summary";
import {
  coerceDays,
  getEmployeeDetail,
  type EmployeeDetailData,
} from "@/lib/timesheets/detail";
import { UserProfile360Shell } from "@/components/features/admin/UserProfile360Shell";
import type { IncidentSummary } from "@/components/features/incidents/IncidentPanel";

// One person's full profile: photo and who they are, then (inside the
// viewer's scopes) their timesheet, time off, incidents and launcher
// activity. Anyone who can open the Users page can open this; what it holds
// follows src/lib/people/summary.ts:
//   - the basics: every admin and manager (managers: active people only)
//   - time data + incidents: the viewer's time-data scope (department + office)
//   - launcher activity: the viewer's analytics scope (office)
// The client shell handles range changes and tab switching; analytics is
// served by /api/analytics/users/[id], which applies the same office rule.
export default async function UserProfilePage({
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

  const [person, roles, { offices, departments }] = await Promise.all([
    loadPersonSummary(session.user, id),
    getCachedRoles(),
    getOrgLists(),
  ]);
  if (!person) notFound();

  const range = isAnalyticsRange(rawRange) ? rawRange : "30d";
  const days = coerceRangeToDays(range);
  const supabase = createAdminClient();

  // Schedules and incidents are read directly below, so they sit behind the
  // same dept + office check getEmployeeDetail applies to punches
  // (person.can.time). Managers also don't see incidents filed against
  // themselves here.
  const canTime = person.can.time;

  const [timeResult, scheduleRes, incidentsRes] = await Promise.all([
    canTime
      ? getEmployeeDetail(id, days, session.user, {
          // Already loaded — trimmed to EMPLOYEE_COLUMNS so the payload
          // matches what the helper's own read returns.
          profile: {
            id: person.id,
            email: person.email,
            name: person.name,
            role: person.role,
            office: person.office,
            department: person.department,
            is_active: person.is_active,
            created_at: person.created_at,
          },
        })
      : Promise.resolve({ ok: false as const, status: 403, message: "No time-data role" }),
    canTime
      ? supabase
          .from("work_schedules")
          .select("weekday, start_time, end_time, timezone")
          .eq("profile_id", id)
      : Promise.resolve({ data: null }),
    canTime
      ? supabase
          .from("incident_reports")
          .select(
            "id, number, title, severity, category, status, occurred_at, manager_signed_at, employee_signed_at, attachments, created_at",
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
      person={person}
      roles={roles.map((r) => ({ name: r.name, display_name: r.display_name }))}
      offices={offices}
      departments={departments}
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
