import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextResponse } from "next/server";

// Count of pending time-off requests the viewer can act on. Sidebar
// polls this on every dashboard mount, so it's on the hot path.
//
// Inner-join filter on profiles collapses the previous two-query pattern
// (scoped profile IDs → count) into one roundtrip.
export async function GET() {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) {
    // Sidebars mount for every user; treat "no access" as zero rather
    // than a hard error so viewers who can't manage time off don't see
    // a broken badge.
    return NextResponse.json({ count: 0 });
  }
  const { supabase, scope } = gate;

  let query = supabase
    .from("time_off_requests")
    .select("id, profile:profiles!profile_id!inner(id)", {
      count: "exact",
      head: true,
    })
    .eq("status", "pending")
    .eq("profile.is_active", true);
  if (scope.department) query = query.eq("profile.department", scope.department);
  if (scope.office) query = query.eq("profile.office", scope.office);

  const { count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 });
}
