import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
import { computeState, type TimePunch } from "@/lib/timesheets/state";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canViewTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const scope = timeDataScope(session.user.role, session.user.department);
  if (!scope.allowed) {
    return NextResponse.json({ error: "No department scope" }, { status: 403 });
  }

  const url = new URL(req.url);
  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");

  const supabase = createAdminClient();

  // Start of today in ET (approximated with server local; refined by tz in v2).
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, role, office, department")
    .order("email");

  // Enforce department scope from the viewer. Non-admins are locked to their
  // own department; admins can narrow via the ?department query param.
  if (scope.department) {
    profileQuery = profileQuery.eq("department", scope.department);
  } else if (departmentFilter) {
    profileQuery = profileQuery.eq("department", departmentFilter);
  }
  // Optional office narrowing — always allowed on top of the department scope.
  if (officeFilter) profileQuery = profileQuery.eq("office", officeFilter);

  const { data: profiles, error: pErr } = await profileQuery;
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json([]);

  const { data: punches, error: puErr } = await supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at, source, note")
    .in("profile_id", profileIds)
    .gte("occurred_at", startOfDay.toISOString())
    .order("occurred_at", { ascending: true });

  if (puErr) return NextResponse.json({ error: puErr.message }, { status: 500 });

  const punchesByProfile = new Map<string, TimePunch[]>();
  for (const p of (punches || []) as TimePunch[]) {
    const list = punchesByProfile.get(p.profile_id) || [];
    list.push(p);
    punchesByProfile.set(p.profile_id, list);
  }

  const rows = (profiles || []).map((profile) => {
    const list = punchesByProfile.get(profile.id) || [];
    const state = computeState(list, now);
    return { profile, state };
  });

  return NextResponse.json(rows);
}
