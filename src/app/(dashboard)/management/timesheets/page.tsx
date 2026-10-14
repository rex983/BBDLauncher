import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
import { loadTimesheetsToday } from "@/lib/timesheets/queries";
import TimesheetsShell from "./TimesheetsShell";
import { getOrgLists } from "@/lib/org/lists";

// Server-rendered entry point for /management/timesheets. Fetches the
// initial roster + live states for the viewer's default scope before
// first paint. Admin filter flips still refetch via
// /api/management/timesheets/today on the client.
export default async function TimesheetsTodayPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewTimeData(session.user.permRole)) redirect("/dashboard");

  const scope = timeDataScope(
    session.user.permRole,
    session.user.department,
    session.user.office,
  );
  const { offices, departments } = await getOrgLists();
  if (!scope.allowed) {
    return <TimesheetsShell initialRows={[]} offices={offices} departments={departments} />;
  }

  const supabase = createAdminClient();
  const initialRows = await loadTimesheetsToday({
    supabase,
    scope: { department: scope.department, office: scope.office },
  });

  return <TimesheetsShell initialRows={initialRows} offices={offices} departments={departments} />;
}
