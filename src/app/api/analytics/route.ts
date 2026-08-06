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
  app_id: string;
  created_at: string;
};

type AppRow = { id: string; name: string };
type ProfileRow = { id: string; email: string; full_name: string | null; role: string; office: string | null };

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
    .select("user_id, app_id, created_at")
    .eq("event_type", "app_launch")
    .order("created_at", { ascending: false })
    .limit(50000);

  if (sinceIso) query = query.gte("created_at", sinceIso);

  const { data: eventsRaw, error: eventsErr } = await query;
  if (eventsErr) {
    return NextResponse.json({ error: eventsErr.message }, { status: 500 });
  }
  const events = (eventsRaw ?? []) as AuditRow[];

  const appIds = [...new Set(events.map((e) => e.app_id))];
  const userIds = [...new Set(events.map((e) => e.user_id))];

  const [{ data: appsRaw }, { data: profilesRaw }] = await Promise.all([
    appIds.length
      ? supabase.from("launcher_apps").select("id, name").in("id", appIds)
      : Promise.resolve({ data: [] as AppRow[] }),
    userIds.length
      ? supabase
          .from("profiles")
          .select("id, email, full_name, role, office")
          .in("id", userIds)
      : Promise.resolve({ data: [] as ProfileRow[] }),
  ]);

  const appById = new Map<string, AppRow>((appsRaw ?? []).map((a) => [a.id, a]));
  const profileById = new Map<string, ProfileRow>(
    (profilesRaw ?? []).map((p) => [p.id, p])
  );

  // Per-app aggregation
  const perApp = new Map<
    string,
    { app_id: string; app_name: string; launches: number; users: Set<string>; last_launch: string }
  >();
  // Per-user aggregation
  const perUser = new Map<
    string,
    {
      user_id: string;
      email: string;
      name: string | null;
      role: string;
      office: string | null;
      launches: number;
      last_launch: string;
      appCounts: Map<string, number>;
    }
  >();

  for (const e of events) {
    const app = appById.get(e.app_id);
    const appName = app?.name ?? "(deleted app)";
    const a = perApp.get(e.app_id);
    if (a) {
      a.launches += 1;
      a.users.add(e.user_id);
      if (e.created_at > a.last_launch) a.last_launch = e.created_at;
    } else {
      perApp.set(e.app_id, {
        app_id: e.app_id,
        app_name: appName,
        launches: 1,
        users: new Set([e.user_id]),
        last_launch: e.created_at,
      });
    }

    const profile = profileById.get(e.user_id);
    const u = perUser.get(e.user_id);
    if (u) {
      u.launches += 1;
      if (e.created_at > u.last_launch) u.last_launch = e.created_at;
      u.appCounts.set(e.app_id, (u.appCounts.get(e.app_id) ?? 0) + 1);
    } else {
      perUser.set(e.user_id, {
        user_id: e.user_id,
        email: profile?.email ?? "(unknown user)",
        name: profile?.full_name ?? null,
        role: profile?.role ?? "unknown",
        office: profile?.office ?? null,
        launches: 1,
        last_launch: e.created_at,
        appCounts: new Map([[e.app_id, 1]]),
      });
    }
  }

  const appsStats = [...perApp.values()]
    .map((a) => ({
      app_id: a.app_id,
      app_name: a.app_name,
      launches: a.launches,
      unique_users: a.users.size,
      last_launch: a.last_launch,
    }))
    .sort((a, b) => b.launches - a.launches);

  const usersStats = [...perUser.values()]
    .map((u) => {
      let topAppId: string | null = null;
      let topAppCount = 0;
      for (const [appId, count] of u.appCounts) {
        if (count > topAppCount) {
          topAppCount = count;
          topAppId = appId;
        }
      }
      const topAppName = topAppId ? appById.get(topAppId)?.name ?? "(deleted app)" : null;
      return {
        user_id: u.user_id,
        email: u.email,
        name: u.name,
        role: u.role,
        office: u.office,
        launches: u.launches,
        last_launch: u.last_launch,
        top_app: topAppName,
        top_app_launches: topAppCount,
      };
    })
    .sort((a, b) => b.launches - a.launches);

  const recent = events.slice(0, 50).map((e) => {
    const p = profileById.get(e.user_id);
    return {
      created_at: e.created_at,
      user_id: e.user_id,
      email: p?.email ?? "(unknown user)",
      name: p?.full_name ?? null,
      app_id: e.app_id,
      app_name: appById.get(e.app_id)?.name ?? "(deleted app)",
    };
  });

  return NextResponse.json({
    range: rangeParam,
    since: sinceIso,
    totals: {
      launches: events.length,
      unique_users: perUser.size,
      unique_apps: perApp.size,
      top_app: appsStats[0]?.app_name ?? null,
      top_app_launches: appsStats[0]?.launches ?? 0,
    },
    apps: appsStats,
    users: usersStats,
    recent,
  });
}
