import {
  requireTimeDataAccess,
  requireTimeDataAccessWithProfile,
} from "@/lib/auth/scope-check";
import { VALID_DEPARTMENTS, VALID_OFFICES } from "@/lib/org/constants";
import { NextRequest, NextResponse } from "next/server";

const MAX_RANGE_MS = 24 * 31 * 24 * 60 * 60 * 1000; // ~24 months
const MAX_REQUESTS = 5000;

type TargetProfile = {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
  department: string | null;
  is_active: boolean;
};

// Time-off rows overlapping a date range for calendar + summary views.
// Returns approved + pending by default so managers can see who's off AND
// what's queued for their decision. Pass ?statuses=approved,denied,cancelled
// to override.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (to < from) {
    return NextResponse.json({ error: "to must be on or after from" }, { status: 400 });
  }
  const spanMs =
    new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime();
  if (spanMs > MAX_RANGE_MS) {
    return NextResponse.json({ error: "Date range too large (max ~24 months)" }, { status: 400 });
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

  const profileIdFilter = url.searchParams.get("profile_id");
  if (profileIdFilter && !/^[0-9a-f-]{36}$/i.test(profileIdFilter)) {
    return NextResponse.json({ error: "Invalid profile_id" }, { status: 400 });
  }

  // When a specific profile is targeted, gate through the with-profile
  // helper so the scope check on that target is explicit and contractual.
  // The previous "AND the scope filter onto the profiles list query" pattern
  // worked but would silently disappear if the query building were reordered.
  type ProfileOut = {
    id: string;
    email: string;
    name: string | null;
    office: string | null;
    department: string | null;
  };
  let supabase;
  let scope;
  let profiles: ProfileOut[];
  if (profileIdFilter) {
    const gate = await requireTimeDataAccessWithProfile<TargetProfile>(
      profileIdFilter,
      "view",
      "id, email, name:full_name, office, department, is_active",
    );
    if (!gate.ok) return gate.response;
    supabase = gate.supabase;
    scope = gate.scope;
    const t = gate.target;
    profiles = [{
      id: t.id,
      email: t.email,
      name: t.name,
      office: t.office,
      department: t.department,
    }];
  } else {
    const gate = await requireTimeDataAccess(null, "view");
    if (!gate.ok) return gate.response;
    supabase = gate.supabase;
    scope = gate.scope;
    let profileQuery = supabase
      .from("profiles")
      .select("id, email, name:full_name, office, department")
      .eq("is_active", true);
    if (scope.department) profileQuery = profileQuery.eq("department", scope.department);
    else if (departmentFilter) profileQuery = profileQuery.eq("department", departmentFilter);
    if (scope.office) profileQuery = profileQuery.eq("office", scope.office);
    else if (officeFilter) profileQuery = profileQuery.eq("office", officeFilter);
    const { data } = await profileQuery;
    profiles = (data || []) as ProfileOut[];
  }

  const profileIds = profiles.map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json({ profiles: [], requests: [] });

  // A request overlaps [from, to] iff start_date <= to AND end_date >= from.
  const { data: requests, error } = await supabase
    .from("time_off_requests")
    .select(
      "id, profile_id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_at, created_at, attachments",
    )
    .in("profile_id", profileIds)
    .in("status", statuses)
    .lte("start_date", to)
    .gte("end_date", from)
    .order("start_date", { ascending: true })
    .limit(MAX_REQUESTS);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    profiles,
    requests: requests || [],
  });
}
