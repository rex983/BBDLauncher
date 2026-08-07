import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

const RANGE_DAYS: Record<string, number | null> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

type AuditRow = {
  id: string;
  app_id: string | null;
  link_id: string | null;
  event_type: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
};

type AppRow = { id: string; name: string };
type LinkRow = { id: string; name: string };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !isAdmin(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;
    const rangeParam = req.nextUrl.searchParams.get("range") ?? "30d";
    const days = rangeParam in RANGE_DAYS ? RANGE_DAYS[rangeParam] : 30;
    const sinceIso =
      days === null ? null : new Date(Date.now() - days * 86400_000).toISOString();

    const supabase = createAdminClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, office")
      .eq("id", id)
      .maybeSingle();

    let query = supabase
      .from("launcher_sso_audit_log")
      .select("id, app_id, link_id, event_type, created_at, ip_address, user_agent")
      .eq("user_id", id)
      .in("event_type", ["app_launch", "link_click"])
      .order("created_at", { ascending: false })
      .limit(10000);
    if (sinceIso) query = query.gte("created_at", sinceIso);

    const { data: eventsRaw, error: eventsErr } = await query;
    if (eventsErr) {
      return NextResponse.json({ error: eventsErr.message }, { status: 500 });
    }
    const events = (eventsRaw ?? []) as AuditRow[];

    const appIds = [
      ...new Set(events.map((e) => e.app_id).filter((v): v is string => !!v)),
    ];
    const linkIds = [
      ...new Set(events.map((e) => e.link_id).filter((v): v is string => !!v)),
    ];

    const [{ data: appsRaw }, { data: linksRaw }] = await Promise.all([
      appIds.length
        ? supabase.from("launcher_apps").select("id, name").in("id", appIds)
        : Promise.resolve({ data: [] as AppRow[] }),
      linkIds.length
        ? supabase.from("launcher_links").select("id, name").in("id", linkIds)
        : Promise.resolve({ data: [] as LinkRow[] }),
    ]);
    const appById = new Map<string, AppRow>((appsRaw ?? []).map((a) => [a.id, a]));
    const linkById = new Map<string, LinkRow>((linksRaw ?? []).map((l) => [l.id, l]));

    type DestAgg = {
      id: string;
      name: string;
      kind: "app" | "link";
      count: number;
      first_used: string;
      last_used: string;
    };
    const perDest = new Map<string, DestAgg>();
    let appLaunches = 0;
    let linkClicks = 0;

    for (const e of events) {
      const isApp = e.event_type === "app_launch" && e.app_id;
      const isLink = e.event_type === "link_click" && e.link_id;
      if (!isApp && !isLink) continue;

      const destId = isApp ? e.app_id! : e.link_id!;
      const kind: "app" | "link" = isApp ? "app" : "link";
      const name = isApp
        ? appById.get(destId)?.name ?? "(deleted app)"
        : linkById.get(destId)?.name ?? "(deleted link)";
      const key = `${kind}:${destId}`;

      if (isApp) appLaunches += 1;
      else linkClicks += 1;

      const existing = perDest.get(key);
      if (existing) {
        existing.count += 1;
        if (e.created_at > existing.last_used) existing.last_used = e.created_at;
        if (e.created_at < existing.first_used) existing.first_used = e.created_at;
      } else {
        perDest.set(key, {
          id: destId,
          name,
          kind,
          count: 1,
          first_used: e.created_at,
          last_used: e.created_at,
        });
      }
    }

    const destinations = [...perDest.values()].sort((a, b) => b.count - a.count);

    const auditLog = events.slice(0, 500).map((e) => {
      const isLink = e.event_type === "link_click";
      const destId = isLink ? e.link_id : e.app_id;
      const destName = isLink
        ? linkById.get(destId ?? "")?.name ?? "(deleted link)"
        : appById.get(destId ?? "")?.name ?? "(deleted app)";
      return {
        id: e.id,
        created_at: e.created_at,
        destination_id: destId,
        destination_name: destName,
        kind: isLink ? ("link" as const) : ("app" as const),
        ip_address: e.ip_address,
        user_agent: e.user_agent,
      };
    });

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
      totals: {
        events: events.length,
        unique_destinations: perDest.size,
        app_launches: appLaunches,
        link_clicks: linkClicks,
        first_event: events.length ? events[events.length - 1].created_at : null,
        last_event: events.length ? events[0].created_at : null,
      },
      destinations,
      audit_log: auditLog,
      audit_log_truncated: events.length > 500,
    });
  } catch (err) {
    console.error("User analytics error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analytics failed" },
      { status: 500 }
    );
  }
}
