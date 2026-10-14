import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
import { scopeProfilesQuery } from "@/lib/auth/scope-check";
import SchedulesShell from "./SchedulesShell";

interface Profile {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
}
interface Schedule {
  profile_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
}

// Server-render the roster + schedule overrides so the schedules table
// paints with data on first visit. Same shape helpers as
// /management/timesheets — mirrors that page's approach.
export default async function SchedulesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewTimeData(session.user.permRole)) redirect("/dashboard");

  const scope = timeDataScope(
    session.user.permRole,
    session.user.department,
    session.user.office,
  );
  if (!scope.allowed) {
    return <SchedulesShell initialProfiles={[]} initialSchedules={[]} />;
  }

  const supabase = createAdminClient();

  // Schedules ride along as an embed on the roster read — one roundtrip
  // instead of profiles first, then `.in("profile_id", ids)`.
  const { data: rows } = await scopeProfilesQuery(
    supabase
      .from("profiles")
      .select(
        "id, email, name:full_name, office, work_schedules(profile_id, weekday, start_time, end_time, timezone)",
      ),
    scope,
  ).order("email");
  const profiles: Profile[] = [];
  const schedules: Schedule[] = [];
  for (const { work_schedules, ...profile } of rows || []) {
    profiles.push(profile as Profile);
    schedules.push(...((work_schedules || []) as Schedule[]));
  }

  return (
    <SchedulesShell
      initialProfiles={profiles}
      initialSchedules={schedules}
    />
  );
}
