import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
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
  if (!canViewTimeData(session.user.role)) redirect("/dashboard");

  const scope = timeDataScope(
    session.user.role,
    session.user.department,
    session.user.office,
  );
  if (!scope.allowed) {
    return <SchedulesShell initialProfiles={[]} initialSchedules={[]} />;
  }

  const supabase = createAdminClient();

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office")
    .eq("is_active", true)
    .order("email");
  if (scope.department) profileQuery = profileQuery.eq("department", scope.department);
  if (scope.office) profileQuery = profileQuery.eq("office", scope.office);

  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  const schedulesRes = profileIds.length
    ? await supabase
        .from("work_schedules")
        .select("profile_id, weekday, start_time, end_time, timezone")
        .in("profile_id", profileIds)
    : { data: [] as Schedule[] };

  return (
    <SchedulesShell
      initialProfiles={(profiles || []) as Profile[]}
      initialSchedules={(schedulesRes.data || []) as Schedule[]}
    />
  );
}
