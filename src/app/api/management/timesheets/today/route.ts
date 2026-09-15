import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
import { computeState, type TimePunch } from "@/lib/timesheets/state";
import { computeWeeklyHours, startOfWeekSunday } from "@/lib/timesheets/weekly";
import { startOfDayInZone } from "@/lib/timesheets/tz";
import { NextRequest, NextResponse } from "next/server";

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
  if (!scope.allowed) {
    return NextResponse.json({ error: "No scope" }, { status: 403 });
  }

  const url = new URL(req.url);
  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");

  const supabase = createAdminClient();

  const now = new Date();
  const startOfDay = startOfDayInZone(now);
  const weekStart = startOfWeekSunday(now);

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, role, office, department")
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
  if (profileIds.length === 0) return NextResponse.json([]);

  // One query covers both today's live state AND the current week's totals.
  const { data: punches, error: puErr } = await supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at, source, note")
    .in("profile_id", profileIds)
    .gte("occurred_at", weekStart.toISOString())
    .order("occurred_at", { ascending: true });

  if (puErr) return NextResponse.json({ error: puErr.message }, { status: 500 });

  const punchesByProfile = new Map<string, TimePunch[]>();
  for (const p of (punches || []) as TimePunch[]) {
    const list = punchesByProfile.get(p.profile_id) || [];
    list.push(p);
    punchesByProfile.set(p.profile_id, list);
  }

  const rows = (profiles || []).map((profile) => {
    const all = punchesByProfile.get(profile.id) || [];
    const today = all.filter((p) => new Date(p.occurred_at) >= startOfDay);
    const state = computeState(today, now);
    const weekly = computeWeeklyHours(all, now);
    return { profile, state, weekly };
  });

  return NextResponse.json(rows);
}
