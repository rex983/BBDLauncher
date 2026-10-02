import { auth } from "@/auth";
import { analyticsScope } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { sinceIsoForRange } from "@/lib/analytics/ranges";
import { fetchAllPages } from "@/app/api/_lib/paged";

type AuditRow = {
  id: string;
  user_id: string;
  event_type: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
};

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  office: string | null;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  try {
    const session = await auth();
    const scope = analyticsScope(session?.user?.role, session?.user?.office ?? null);
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

    // Office-scoped viewers only see rows from users in their office. The
    // destination metadata lookup is independent, so both run together.
    const table = kind === "apps" ? "launcher_apps" : "launcher_links";
    const cols = kind === "apps" ? "id, name, url, sso_type, status" : "id, name, url";
    const [officeRes, { data: dest, error: destErr }] = await Promise.all([
      scope.office !== null
        ? supabase.from("profiles").select("id").eq("office", scope.office)
        : null,
      supabase.from(table).select(cols).eq("id", id).maybeSingle(),
    ]);
    let allowedUserIds: string[] | null = null;
    if (officeRes) {
      if (officeRes.error) {
        return NextResponse.json({ error: officeRes.error.message }, { status: 500 });
      }
      allowedUserIds = (officeRes.data ?? []).map((p) => p.id);
    }
    if (destErr) {
      return NextResponse.json({ error: destErr.message }, { status: 500 });
    }

    // Pull events for this specific destination
    const filterCol = kind === "apps" ? "app_id" : "link_id";
    const eventType = kind === "apps" ? "app_launch" : "link_click";

    let events: AuditRow[] = [];
    if (allowedUserIds?.length !== 0) {
      const paged = await fetchAllPages<AuditRow>((from, to) => {
        let query = supabase
          .from("launcher_sso_audit_log")
          .select("id, user_id, event_type, created_at, ip_address, user_agent")
          .eq(filterCol, id)
          .eq("event_type", eventType)
          .order("created_at", { ascending: false })
          .range(from, to);
        if (sinceIso) query = query.gte("created_at", sinceIso);
        if (allowedUserIds) query = query.in("user_id", allowedUserIds);
        return query;
      });
      if (paged.error) {
        return NextResponse.json({ error: paged.error }, { status: 500 });
      }
      events = paged.data;
    }

    const userIds = [...new Set(events.map((e) => e.user_id))];
    const { data: profilesRaw } = userIds.length
      ? await supabase
          .from("profiles")
          .select("id, email, full_name, role, office")
          .in("id", userIds)
      : { data: [] as ProfileRow[] };

    const profileById = new Map<string, ProfileRow>(
      (profilesRaw ?? []).map((p) => [p.id, p])
    );

    type UserAgg = {
      user_id: string;
      email: string;
      name: string | null;
      role: string;
      office: string | null;
      clicks: number;
      first_click: string;
      last_click: string;
    };
    const perUser = new Map<string, UserAgg>();

    for (const e of events) {
      const existing = perUser.get(e.user_id);
      if (existing) {
        existing.clicks += 1;
        if (e.created_at > existing.last_click) existing.last_click = e.created_at;
        if (e.created_at < existing.first_click) existing.first_click = e.created_at;
      } else {
        const p = profileById.get(e.user_id);
        perUser.set(e.user_id, {
          user_id: e.user_id,
          email: p?.email ?? "(unknown user)",
          name: p?.full_name ?? null,
          role: p?.role ?? "unknown",
          office: p?.office ?? null,
          clicks: 1,
          first_click: e.created_at,
          last_click: e.created_at,
        });
      }
    }

    const users = [...perUser.values()].sort((a, b) => b.clicks - a.clicks);

    const auditLog = events.slice(0, 500).map((e) => {
      const p = profileById.get(e.user_id);
      return {
        id: e.id,
        created_at: e.created_at,
        user_id: e.user_id,
        email: p?.email ?? "(unknown user)",
        name: p?.full_name ?? null,
        ip_address: e.ip_address,
        user_agent: e.user_agent,
      };
    });

    return NextResponse.json({
      kind,
      destination: dest,
      range: rangeParam,
      since: sinceIso,
      totals: {
        clicks: events.length,
        unique_users: perUser.size,
        first_click: events.length ? events[events.length - 1].created_at : null,
        last_click: events.length ? events[0].created_at : null,
      },
      users,
      audit_log: auditLog,
      audit_log_truncated: events.length > 500,
    });
  } catch (err) {
    console.error("Destination analytics error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analytics failed" },
      { status: 500 }
    );
  }
}
