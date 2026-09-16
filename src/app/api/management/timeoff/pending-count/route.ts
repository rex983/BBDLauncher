import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextResponse } from "next/server";

// Count of pending time-off requests the current viewer can act on.
// Powers the sidebar badge — kept small (just a number) so it can be
// polled cheaply from the sidebar without dragging in row payloads.
export async function GET() {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) {
    // Sidebars mount for every user; treat "no access" as zero rather
    // than a hard error so viewers who can't manage time off don't see
    // a broken badge.
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

  const { count, error } = await supabase
    .from("time_off_requests")
    .select("id", { count: "exact", head: true })
    .in("profile_id", profileIds)
    .eq("status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 });
}
