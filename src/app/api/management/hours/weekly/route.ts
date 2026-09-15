import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
import { type TimePunch } from "@/lib/timesheets/state";
import { computeWeeklyHours, startOfWeekSunday } from "@/lib/timesheets/weekly";
import { NextRequest, NextResponse } from "next/server";

// Sunday-anchored weekly hours + overtime, scoped by the caller's
// (office ∩ department ∩ is_active). Managers see only their own; admins
// can filter with ?office and ?department.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canViewTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const scope = timeDataScope(
    session.user.role,
    session.user.department,
    session.user.office,
  );
  if (!scope.allowed) return NextResponse.json({ error: "No scope" }, { status: 403 });

  const url = new URL(req.url);
  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  const onlyOvertime = url.searchParams.get("onlyOvertime") === "1";

  const supabase = createAdminClient();
  const now = new Date();
  const weekStart = startOfWeekSunday(now);

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

  const { data: punches } = await supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at, source, note")
    .in("profile_id", profileIds)
    .gte("occurred_at", weekStart.toISOString())
    .order("occurred_at", { ascending: true });

  const byProfile = new Map<string, TimePunch[]>();
  for (const p of (punches || []) as TimePunch[]) {
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
