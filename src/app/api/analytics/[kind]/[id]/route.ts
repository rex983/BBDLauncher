import { auth } from "@/auth";
import { analyticsScope } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { sinceIsoForRange } from "@/lib/analytics/ranges";

// Shape returned by get_launcher_destination_analytics (migration 047).
type DestinationAgg = {
  totals: {
    clicks: number;
    unique_users: number;
    first_click: string | null;
    last_click: string | null;
  };
  users: Array<{
    user_id: string;
    email: string;
    name: string | null;
    role: string;
    office: string | null;
    clicks: number;
    first_click: string;
    last_click: string;
  }>;
  audit_log: Array<{
    id: string;
    created_at: string;
    user_id: string;
    email: string;
    name: string | null;
    ip_address: string | null;
    user_agent: string | null;
  }>;
  audit_log_truncated: boolean;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  try {
    const session = await auth();
    const scope = analyticsScope(session?.user?.permRole, session?.user?.office ?? null);
    if (!session?.user || !scope.allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { kind, id } = await params;
    if (kind !== "apps" && kind !== "links") {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }

    const rangeParam = req.nextUrl.searchParams.get("range") ?? "30d";
    const sinceIso = sinceIsoForRange(rangeParam);

    const supabase = createAdminClient();

    // Destination metadata, plus the aggregation in SQL (migration 047).
    // Office-scoped viewers only see rows from users in their office; the
    // function filters by office with a join instead of an id list.
    const table = kind === "apps" ? "launcher_apps" : "launcher_links";
    const cols = kind === "apps" ? "id, name, url, sso_type, status" : "id, name, url";
    const [{ data: dest, error: destErr }, { data: agg, error: aggErr }] = await Promise.all([
      supabase.from(table).select(cols).eq("id", id).maybeSingle(),
      supabase.rpc("get_launcher_destination_analytics", {
        p_kind: kind,
        p_dest_id: id,
        p_since: sinceIso,
        p_office: scope.office,
      }),
    ]);
    if (destErr) {
      return NextResponse.json({ error: destErr.message }, { status: 500 });
    }
    if (aggErr) {
      return NextResponse.json({ error: aggErr.message }, { status: 500 });
    }
    const result = agg as DestinationAgg;

    return NextResponse.json({
      kind,
      destination: dest,
      range: rangeParam,
      since: sinceIso,
      totals: result.totals,
      users: result.users,
      audit_log: result.audit_log,
      audit_log_truncated: result.audit_log_truncated,
    });
  } catch (err) {
    console.error("Destination analytics error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analytics failed" },
      { status: 500 }
    );
  }
}
