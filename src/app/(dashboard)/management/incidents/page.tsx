import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
import { listScopedIncidentSummaries } from "@/lib/incidents/queries";
import IncidentsShell from "./IncidentsShell";

// Server-rendered entry point for /management/incidents. Fetches the
// initial roster of incidents in-scope for the viewer BEFORE first paint,
// so the client shell renders with data instead of a "Loading…" flash +
// useEffect round-trip. Subsequent filter changes / post-action refreshes
// still hit /api/management/incidents on the client.
//
// Auth mirrors requireTimeDataAccess() so we don't leak this page to
// employees. If the viewer has no scope (a manager with no
// office/department assignment), we render an empty shell rather than
// crashing.
export default async function IncidentsManagementPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewTimeData(session.user.role)) redirect("/dashboard");

  const scope = timeDataScope(
    session.user.role,
    session.user.department,
    session.user.office,
  );
  if (!scope.allowed) {
    return <IncidentsShell initialRows={[]} />;
  }

  const supabase = createAdminClient();
  const initialRows = await listScopedIncidentSummaries({
    supabase,
    scope: {
      department: scope.department,
      office: scope.office,
    },
  });

  return <IncidentsShell initialRows={initialRows} />;
}
