import { createAdminClient } from "@/lib/supabase/admin";

export type AnalyticsRange = "24h" | "7d" | "30d" | "90d" | "all";

const RANGE_DAYS: Record<AnalyticsRange, number | null> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

export const ANALYTICS_RANGES: AnalyticsRange[] = [
  "24h",
  "7d",
  "30d",
  "90d",
  "all",
];

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return typeof value === "string" && (ANALYTICS_RANGES as string[]).includes(value);
}

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

export interface AnalyticsData {
  range: AnalyticsRange;
  since: string | null;
  totals: AnalyticsTotals;
  apps: AnalyticsDestStat[];
  links: AnalyticsDestStat[];
  users: AnalyticsUserStat[];
  recent: AnalyticsRecentEvent[];
}

// Payload returned by the get_launcher_analytics RPC — everything except
// `range` / `since`, which the caller decorates.
type AnalyticsRpcPayload = Omit<AnalyticsData, "range" | "since">;

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
  };
}

export async function getLauncherAnalytics(
  range: AnalyticsRange,
  scope: { office: string | null },
): Promise<AnalyticsData> {
  const days = RANGE_DAYS[range];
  const sinceIso =
    days === null ? null : new Date(Date.now() - days * 86400_000).toISOString();

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

  // Single round-trip: the RPC does the pagination + aggregation server-side
  // and returns the already-shaped payload.
  const { data, error } = await supabase.rpc("get_launcher_analytics", {
    p_since: sinceIso,
    p_allowed_user_ids: allowedUserIds,
  });

  if (error) {
    throw new Error(error.message);
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
  };
}
