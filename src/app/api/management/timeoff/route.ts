import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";

// List time-off requests for everyone in the viewer's department scope.
// Filter by status via ?status=pending|approved|denied|cancelled (default: pending).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canViewTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const scope = timeDataScope(session.user.role, session.user.department);
  if (!scope.allowed) return NextResponse.json({ error: "No scope" }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";

  const supabase = createAdminClient();
  let profileQuery = supabase.from("profiles").select("id, email, name:full_name, office, department");
  if (scope.department) profileQuery = profileQuery.eq("department", scope.department);
  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json([]);

  const { data: requests, error } = await supabase
    .from("time_off_requests")
    .select("*")
    .in("profile_id", profileIds)
    .eq("status", status)
    .order("start_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  return NextResponse.json(
    (requests || []).map((r) => ({ ...r, profile: profileMap.get(r.profile_id) })),
  );
}
