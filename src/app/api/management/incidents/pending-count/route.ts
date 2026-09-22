import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextResponse } from "next/server";

// Count of incident reports awaiting the viewer's signature OR the
// employee's signature. Powers the sidebar badge — treat any non-terminal
// state as "still in flight".
//
// Uses an inner-join on profiles so the scope filter (department, office,
// is_active) applies in a single roundtrip instead of the previous
// two-step "fetch profile IDs, then fetch incidents" pattern.
export async function GET() {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) {
    return NextResponse.json({ count: 0 });
  }
  const { supabase, scope } = gate;

  let query = supabase
    .from("incident_reports")
    .select("id, employee:profiles!employee_profile_id!inner(id)", {
      count: "exact",
      head: true,
    })
    .in("status", ["awaiting_manager_sig", "awaiting_employee_sig"])
    .eq("employee.is_active", true);
  if (scope.department) query = query.eq("employee.department", scope.department);
  if (scope.office) query = query.eq("employee.office", scope.office);

  const { count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 });
}
