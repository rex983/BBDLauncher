import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextResponse } from "next/server";

// Count of incident reports awaiting the viewer's signature OR the
// employee's signature. Powers the sidebar badge — treat any non-terminal
// state as "still in flight". A separate query pulls just the manager's own
// pending signatures if we ever need per-user vs. per-scope counting.
export async function GET() {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) {
    return NextResponse.json({ count: 0 });
  }
  const { supabase, scope } = gate;

  let profileQuery = supabase
    .from("profiles")
    .select("id")
    .eq("is_active", true);
  if (scope.department) profileQuery = profileQuery.eq("department", scope.department);
  if (scope.office) profileQuery = profileQuery.eq("office", scope.office);

  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json({ count: 0 });

  const { data: rows, error } = await supabase
    .from("incident_reports")
    .select("id")
    .in("employee_profile_id", profileIds)
    .in("status", ["awaiting_manager_sig", "awaiting_employee_sig"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: rows?.length ?? 0 });
}
