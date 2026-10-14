import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTimeDataScope } from "@/lib/auth/scope-check";
import { getOrgLists } from "@/lib/org/lists";
import { resolvePermRole } from "@/lib/auth/perm-role";
import {
  ATTENDANCE_RANGES,
  loadAttendance,
  type AttendanceRange,
} from "@/lib/timesheets/attendance";
import AttendanceShell from "./AttendanceShell";

// Late arrivals, overtime, early exits and absences for everyone in the
// viewer's time-data scope. Filters live in the URL, so every change is a
// server render with no client fetch layer.
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, sp] = await Promise.all([auth(), searchParams]);
  if (!session?.user) redirect("/login");
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);

  // Admin "View as": show the team that person would see.
  let viewer: Parameters<typeof resolveTimeDataScope>[0] = session.user;
  const viewAsUser = one("viewAsUser");
  if (session.user.permRole === "admin" && viewAsUser && UUID.test(viewAsUser)) {
    const { data } = await createAdminClient()
      .from("profiles")
      .select("role, office, department")
      .eq("id", viewAsUser)
      .eq("is_active", true)
      .maybeSingle();
    if (data) {
      viewer = {
        permRole: await resolvePermRole(data.role as string),
        office: data.office as string | null,
        department: data.department as string | null,
      };
    }
  }
  const gate = resolveTimeDataScope(viewer, "view");
  if (!gate.ok) redirect("/dashboard");

  const daysParam = Number(one("days"));
  const days: AttendanceRange = (ATTENDANCE_RANGES as readonly number[]).includes(daysParam)
    ? (daysParam as AttendanceRange)
    : 30;
  // Only admins have open scope axes; for managers these are ignored.
  const { offices, departments } = await getOrgLists();
  const officeParam = one("office");
  const departmentParam = one("department");
  const office = officeParam && offices.some((o) => o.name === officeParam) ? officeParam : null;
  const department =
    departmentParam && departments.some((d) => d.name === departmentParam) ? departmentParam : null;

  const report = await loadAttendance({
    supabase: createAdminClient(),
    scope: { department: gate.scope.department, office: gate.scope.office },
    officeOverride: office,
    departmentOverride: department,
    days,
  });

  return (
    <AttendanceShell
      report={report}
      isAdmin={gate.viewerIsAdmin}
      office={gate.scope.office ?? office}
      department={gate.scope.department ?? department}
      offices={offices}
      departments={departments}
    />
  );
}
