import { auth } from "@/auth";
import { analyticsScope } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { sinceIsoForRange } from "@/lib/analytics/ranges";

// Shape returned by get_launcher_user_analytics (migration 047).
type UserAgg = {
  totals: {
    events: number;
    unique_destinations: number;
    app_launches: number;
    link_clicks: number;
    first_event: string | null;
    last_event: string | null;
  };
  destinations: Array<{
    id: string;
    name: string;
    kind: "app" | "link";
    count: number;
    first_used: string;
    last_used: string;
  }>;
  audit_log: Array<{
    id: string;
    created_at: string;
    destination_id: string | null;
    destination_name: string;
    kind: "app" | "link";
    ip_address: string | null;
    user_agent: string | null;
  }>;
  audit_log_truncated: boolean;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const scope = analyticsScope(session?.user?.permRole, session?.user?.office ?? null);
    if (!session?.user || !scope.allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;
    const rangeParam = req.nextUrl.searchParams.get("range") ?? "30d";
    const sinceIso = sinceIsoForRange(rangeParam);

    const supabase = createAdminClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, office")
      .eq("id", id)
      .maybeSingle();

    // Office-scoped viewers can only drill into users in their own office.
    // If the target profile is missing (orphaned audit rows) or in another
    // office, refuse. Admins and BST managers pass through.
    if (scope.office !== null && profile?.office !== scope.office) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Aggregated in SQL (migration 047) instead of paging raw rows here.
    const { data: agg, error: aggErr } = await supabase.rpc("get_launcher_user_analytics", {
      p_user_id: id,
      p_since: sinceIso,
    });
    if (aggErr) {
      return NextResponse.json({ error: aggErr.message }, { status: 500 });
    }
    const result = agg as UserAgg;

    return NextResponse.json({
      user: profile
        ? {
            id: profile.id,
            email: profile.email,
            name: profile.full_name,
            role: profile.role,
            office: profile.office,
          }
        : null,
      user_id: id,
      range: rangeParam,
      since: sinceIso,
      totals: result.totals,
      destinations: result.destinations,
      audit_log: result.audit_log,
      audit_log_truncated: result.audit_log_truncated,
    });
  } catch (err) {
    console.error("User analytics error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analytics failed" },
      { status: 500 }
    );
  }
}
