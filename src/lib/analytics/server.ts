import { createAdminClient } from "@/lib/supabase/admin";
import { sinceIsoForRange, type AnalyticsRange } from "@/lib/analytics/ranges";

export {
  ANALYTICS_RANGES,
  isAnalyticsRange,
  type AnalyticsRange,
} from "@/lib/analytics/ranges";

export type AnalyticsDestStat = {
  id: string;
  name: string;
  kind: "app" | "link";
  launches: number;
  unique_users: number;
  last_launch: string;
};

export type AnalyticsUserStat = {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
  launches: number;
  last_launch: string;
  top_destination: string | null;
  top_destination_kind: "app" | "link" | null;
  top_destination_launches: number;
};

export type AnalyticsRecentEvent = {
  created_at: string;
  user_id: string;
  email: string;
  name: string | null;
  destination: string;
  kind: "app" | "link";
};

export type AnalyticsTotals = {
  launches: number;
  unique_users: number;
  unique_destinations: number;
  app_launches: number;
  link_clicks: number;
  top_destination: string | null;
  top_destination_kind: "app" | "link" | null;
  top_destination_launches: number;
};

// Time spent in the apps (launcher migration 063, launcher_usage_report): the
// kit's once-a-minute heartbeat. Minutes come from pm_usage_daily (since Oct
// 2026); visits and time of day from launcher_usage_hourly (since
// tracked_since). Opens are launcher clicks (launcher_sso_audit_log). Eastern.
export interface UsageReport {
  tracked_since: string | null;
  totals: { minutes: number; people: number; person_days: number; visits: number; visit_minutes: number; opens: number };
  daily: { day: string; minutes: number; people: number; visits: number; opens: number }[];
  hours: { dow: number; hour: number; minutes: number; visits: number; opens: number }[];
  apps: {
    app_id: string;
    name: string;
    minutes: number;
    people: number;
    days: number;
    visits: number;
    visit_minutes: number;
    last_seen: string;
  }[];
  users: {
    profile_id: string;
    email: string;
    name: string | null;
    role: string;
    office: string | null;
    minutes: number;
    days: number;
    visits: number;
    visit_minutes: number;
    apps: number;
    top_app: string | null;
    top_app_minutes: number | null;
    last_seen: string;
  }[];
}

export interface AnalyticsData {
  range: AnalyticsRange;
  since: string | null;
  totals: AnalyticsTotals;
  apps: AnalyticsDestStat[];
  links: AnalyticsDestStat[];
  users: AnalyticsUserStat[];
  recent: AnalyticsRecentEvent[];
  /** null: migration 063 isn't applied yet. */
  usage: UsageReport | null;
}

// Payload returned by the get_launcher_analytics RPC — everything except
// `range` / `since` / `usage`, which the caller decorates.
type AnalyticsRpcPayload = Omit<AnalyticsData, "range" | "since" | "usage">;

function emptyAnalytics(range: AnalyticsRange, since: string | null): AnalyticsData {
  return {
    range,
    since,
    totals: {
      launches: 0,
      unique_users: 0,
      unique_destinations: 0,
      app_launches: 0,
      link_clicks: 0,
      top_destination: null,
      top_destination_kind: null,
      top_destination_launches: 0,
    },
    apps: [],
    links: [],
    users: [],
    recent: [],
    usage: null,
  };
}

export async function getLauncherAnalytics(
  range: AnalyticsRange,
  scope: { office: string | null },
): Promise<AnalyticsData> {
  const sinceIso = sinceIsoForRange(range);

  const supabase = createAdminClient();

  // Office-scoped viewers (non-BST managers) only see activity by users in
  // their office. Look up the allowed profile IDs up-front so the RPC can
  // filter events directly and we don't leak cross-office rows through the
  // (deleted profile) branch.
  let allowedUserIds: string[] | null = null;
  if (scope.office !== null) {
    const { data: officeProfiles, error: officeErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("office", scope.office);
    if (officeErr) {
      throw new Error(officeErr.message);
    }
    allowedUserIds = (officeProfiles ?? []).map((p) => p.id);
    if (allowedUserIds.length === 0) {
      return emptyAnalytics(range, sinceIso);
    }
  }

  // The RPCs do the aggregation server-side and return already-shaped payloads.
  const [{ data, error }, usage] = await Promise.all([
    supabase.rpc("get_launcher_analytics", {
      p_since: sinceIso,
      p_allowed_user_ids: allowedUserIds,
    }),
    supabase.rpc("launcher_usage_report", { p_since: sinceIso, p_allowed: allowedUserIds }),
  ]);

  if (error) {
    throw new Error(error.message);
  }
  // Missing function (migration 063 not applied): the page says so.
  if (usage.error && usage.error.code !== "PGRST202" && usage.error.code !== "42883") {
    throw new Error(usage.error.message);
  }

  // The RPC contract guarantees this shape; if the audit log was empty for
  // the requested window, `data` will still be an object with zero totals
  // and empty arrays. Defend against a null return anyway just in case.
  if (!data) {
    return emptyAnalytics(range, sinceIso);
  }

  const payload = data as AnalyticsRpcPayload;

  return {
    range,
    since: sinceIso,
    totals: payload.totals,
    apps: payload.apps,
    links: payload.links,
    users: payload.users,
    recent: payload.recent,
    usage: usage.error ? null : (usage.data as UsageReport),
  };
}
