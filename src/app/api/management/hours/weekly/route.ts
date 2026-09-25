import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { type TimePunch } from "@/lib/timesheets/state";
import { computeWeeklyHours } from "@/lib/timesheets/weekly";
import { fetchPunchesPaged } from "@/lib/timesheets/punches";
import { startOfWeekSundayInZone } from "@/lib/timesheets/tz";
import { NextRequest, NextResponse } from "next/server";

// Sunday-anchored weekly hours + overtime, scoped by the caller's
// (office ∩ department ∩ is_active). Managers see only their own; admins
// can filter with ?office and ?department.
export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope } = gate;

  const url = new URL(req.url);
  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  const onlyOvertime = url.searchParams.get("onlyOvertime") === "1";

  const now = new Date();
  const weekStart = startOfWeekSundayInZone(now);

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department")
    .eq("is_active", true)
    .order("email");
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

  const { data: profiles, error: pErr } = await profileQuery;
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json({ week_start: weekStart.toISOString(), rows: [] });

  const { data: punches } = await fetchPunchesPaged(
    supabase,
    profileIds,
    weekStart.toISOString(),
  );

  const byProfile = new Map<string, TimePunch[]>();
  for (const p of punches) {
    const list = byProfile.get(p.profile_id) || [];
    list.push(p);
    byProfile.set(p.profile_id, list);
  }

  const rows = (profiles || [])
    .map((profile) => ({
      profile,
      weekly: computeWeeklyHours(byProfile.get(profile.id) || [], now),
    }))
    .filter((row) => (onlyOvertime ? row.weekly.is_overtime : true))
    .sort((a, b) => b.weekly.worked_ms - a.weekly.worked_ms);

  return NextResponse.json({
    week_start: weekStart.toISOString(),
    rows,
  });
}
