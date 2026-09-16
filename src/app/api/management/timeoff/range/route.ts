import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextRequest, NextResponse } from "next/server";

const VALID_OFFICES = new Set(["Harbor", "Marion", "BST", "RnD"]);
const VALID_DEPARTMENTS = new Set(["SALES TEAM", "BST", "RnD"]);

// Time-off rows overlapping a date range for calendar + summary views.
// Returns approved + pending by default so managers can see who's off AND
// what's queued for their decision. Pass ?statuses=approved,denied,cancelled
// to override.
export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope } = gate;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (to < from) {
    return NextResponse.json({ error: "to must be on or after from" }, { status: 400 });
  }

  const statusParam = url.searchParams.get("statuses");
  const statuses = statusParam
    ? statusParam.split(",").filter((s) => ["pending", "approved", "denied", "cancelled"].includes(s))
    : ["approved", "pending"];
  if (statuses.length === 0) {
    return NextResponse.json({ error: "No valid statuses" }, { status: 400 });
  }

  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  if (officeFilter && !VALID_OFFICES.has(officeFilter)) {
    return NextResponse.json({ error: "Invalid office" }, { status: 400 });
  }
  if (departmentFilter && !VALID_DEPARTMENTS.has(departmentFilter)) {
    return NextResponse.json({ error: "Invalid department" }, { status: 400 });
  }

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department")
    .eq("is_active", true);
  if (scope.department) profileQuery = profileQuery.eq("department", scope.department);
  else if (departmentFilter) profileQuery = profileQuery.eq("department", departmentFilter);
  if (scope.office) profileQuery = profileQuery.eq("office", scope.office);
  else if (officeFilter) profileQuery = profileQuery.eq("office", officeFilter);

  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json({ profiles: [], requests: [] });

  // A request overlaps [from, to] iff start_date <= to AND end_date >= from.
  const { data: requests, error } = await supabase
    .from("time_off_requests")
    .select(
      "id, profile_id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_at, created_at",
    )
    .in("profile_id", profileIds)
    .in("status", statuses)
    .lte("start_date", to)
    .gte("end_date", from)
    .order("start_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    profiles: profiles || [],
    requests: requests || [],
  });
}
