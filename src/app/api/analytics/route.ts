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
  user_id: string;
  app_id: string | null;
  link_id: string | null;
  event_type: string;
  created_at: string;
};

type AppRow = { id: string; name: string };
type LinkRow = { id: string; name: string };
type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  office: string | null;
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rangeParam = req.nextUrl.searchParams.get("range") ?? "30d";
  const days = rangeParam in RANGE_DAYS ? RANGE_DAYS[rangeParam] : 30;
  const sinceIso =
    days === null ? null : new Date(Date.now() - days * 86400_000).toISOString();

  const supabase = createAdminClient();

  let query = supabase
    .from("launcher_sso_audit_log")
    .select("user_id, app_id, link_id, event_type, created_at")
    .in("event_type", ["app_launch", "link_click"])
    .order("created_at", { ascending: false })
    .limit(50000);

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
  const userIds = [...new Set(events.map((e) => e.user_id))];

  const [{ data: appsRaw }, { data: linksRaw }, { data: profilesRaw }] =
    await Promise.all([
      appIds.length
        ? supabase.from("launcher_apps").select("id, name").in("id", appIds)
        : Promise.resolve({ data: [] as AppRow[] }),
      linkIds.length
        ? supabase.from("launcher_links").select("id, name").in("id", linkIds)
        : Promise.resolve({ data: [] as LinkRow[] }),
      userIds.length
        ? supabase
            .from("profiles")
            .select("id, email, full_name, role, office")
            .in("id", userIds)
        : Promise.resolve({ data: [] as ProfileRow[] }),
    ]);

  const appById = new Map<string, AppRow>((appsRaw ?? []).map((a) => [a.id, a]));
  const linkById = new Map<string, LinkRow>(
    (linksRaw ?? []).map((l) => [l.id, l])
  );
  const profileById = new Map<string, ProfileRow>(
    (profilesRaw ?? []).map((p) => [p.id, p])
  );

  type DestAgg = {
    id: string;
    name: string;
    kind: "app" | "link";
    launches: number;
    users: Set<string>;
    last_launch: string;
  };
  const perApp = new Map<string, DestAgg>();
  const perLink = new Map<string, DestAgg>();

  type UserAgg = {
    user_id: string;
    email: string;
    name: string | null;
    role: string;
    office: string | null;
    launches: number;
    last_launch: string;
    // key is `app:<id>` or `link:<id>` so top-destination reflects any target
    destCounts: Map<string, { name: string; kind: "app" | "link"; count: number }>;
  };
  const perUser = new Map<string, UserAgg>();

  for (const e of events) {
    const isLink = e.event_type === "link_click" && e.link_id;
    const isApp = e.event_type === "app_launch" && e.app_id;

    let destId: string | null = null;
    let destName = "";
    let destKind: "app" | "link" | null = null;

    if (isApp) {
      destId = e.app_id!;
      destName = appById.get(destId)?.name ?? "(deleted app)";
      destKind = "app";
      const a = perApp.get(destId);
      if (a) {
        a.launches += 1;
        a.users.add(e.user_id);
        if (e.created_at > a.last_launch) a.last_launch = e.created_at;
      } else {
        perApp.set(destId, {
          id: destId,
          name: destName,
          kind: "app",
          launches: 1,
          users: new Set([e.user_id]),
          last_launch: e.created_at,
        });
      }
    } else if (isLink) {
      destId = e.link_id!;
      destName = linkById.get(destId)?.name ?? "(deleted link)";
      destKind = "link";
      const l = perLink.get(destId);
      if (l) {
        l.launches += 1;
        l.users.add(e.user_id);
        if (e.created_at > l.last_launch) l.last_launch = e.created_at;
      } else {
        perLink.set(destId, {
          id: destId,
          name: destName,
          kind: "link",
          launches: 1,
          users: new Set([e.user_id]),
          last_launch: e.created_at,
        });
      }
    }

    if (!destId || !destKind) continue;

    const profile = profileById.get(e.user_id);
    const u = perUser.get(e.user_id);
    const destKey = `${destKind}:${destId}`;
    if (u) {
      u.launches += 1;
      if (e.created_at > u.last_launch) u.last_launch = e.created_at;
      const existing = u.destCounts.get(destKey);
      if (existing) existing.count += 1;
      else u.destCounts.set(destKey, { name: destName, kind: destKind, count: 1 });
    } else {
      perUser.set(e.user_id, {
        user_id: e.user_id,
        email: profile?.email ?? "(unknown user)",
        name: profile?.full_name ?? null,
        role: profile?.role ?? "unknown",
        office: profile?.office ?? null,
        launches: 1,
        last_launch: e.created_at,
        destCounts: new Map([[destKey, { name: destName, kind: destKind, count: 1 }]]),
      });
    }
  }

  const shape = (m: Map<string, DestAgg>) =>
    [...m.values()]
      .map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        launches: a.launches,
        unique_users: a.users.size,
        last_launch: a.last_launch,
      }))
      .sort((a, b) => b.launches - a.launches);

  const appsStats = shape(perApp);
  const linksStats = shape(perLink);

  const usersStats = [...perUser.values()]
    .map((u) => {
      let topName: string | null = null;
      let topKind: "app" | "link" | null = null;
      let topCount = 0;
      for (const dest of u.destCounts.values()) {
        if (dest.count > topCount) {
          topCount = dest.count;
          topName = dest.name;
          topKind = dest.kind;
        }
      }
      return {
        user_id: u.user_id,
        email: u.email,
        name: u.name,
        role: u.role,
        office: u.office,
        launches: u.launches,
        last_launch: u.last_launch,
        top_destination: topName,
        top_destination_kind: topKind,
        top_destination_launches: topCount,
      };
    })
    .sort((a, b) => b.launches - a.launches);

  const recent = events.slice(0, 50).map((e) => {
    const p = profileById.get(e.user_id);
    const isLink = e.event_type === "link_click";
    const destId = isLink ? e.link_id : e.app_id;
    const destName = isLink
      ? linkById.get(destId ?? "")?.name ?? "(deleted link)"
      : appById.get(destId ?? "")?.name ?? "(deleted app)";
    return {
      created_at: e.created_at,
      user_id: e.user_id,
      email: p?.email ?? "(unknown user)",
      name: p?.full_name ?? null,
      destination: destName,
      kind: isLink ? ("link" as const) : ("app" as const),
    };
  });

  const topDest = [...appsStats, ...linksStats].sort(
    (a, b) => b.launches - a.launches
  )[0];

  return NextResponse.json({
    range: rangeParam,
    since: sinceIso,
    totals: {
      launches: events.length,
      unique_users: perUser.size,
      unique_destinations: perApp.size + perLink.size,
      app_launches: [...perApp.values()].reduce((s, a) => s + a.launches, 0),
      link_clicks: [...perLink.values()].reduce((s, l) => s + l.launches, 0),
      top_destination: topDest?.name ?? null,
      top_destination_kind: topDest?.kind ?? null,
      top_destination_launches: topDest?.launches ?? 0,
    },
    apps: appsStats,
    links: linksStats,
    users: usersStats,
    recent,
  });
}
