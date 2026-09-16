import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextRequest, NextResponse } from "next/server";

const VALID_STATUSES = new Set(["pending", "approved", "denied", "cancelled"]);
const VALID_OFFICES = new Set(["Harbor", "Marion", "BST", "RnD"]);
const VALID_DEPARTMENTS = new Set(["SALES TEAM", "BST", "RnD"]);

// List time-off requests for everyone in the viewer's department scope.
// Filter by status via ?status=pending|approved|denied|cancelled (default: pending).
export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope } = gate;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  // Admin-only overlay filters (scope.office/department already dominate
  // for manager-tier viewers, so these only apply when scope is unbounded).
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
  if (scope.department) {
    profileQuery = profileQuery.eq("department", scope.department);
  } else if (departmentFilter) {
    profileQuery = profileQuery.eq("department", departmentFilter);
  }
  if (scope.office) {
    profileQuery = profileQuery.eq("office", scope.office);
  } else if (officeFilter) {
    profileQuery = profileQuery.eq("office", officeFilter);
  }
  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json([]);

  const { data: requests, error } = await supabase
    .from("time_off_requests")
    .select(
      "id, profile_id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_by, decided_at, created_at, attachments",
    )
    .in("profile_id", profileIds)
    .eq("status", status)
    .order("start_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  return NextResponse.json(
    (requests || []).map((r) => ({ ...r, profile: profileMap.get(r.profile_id) })),
  );
}
