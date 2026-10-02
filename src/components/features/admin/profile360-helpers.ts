// Shared types, constants, and pure helpers for the admin user-profile 360
// shell. Split out so the shell + its per-tab sub-components can import
// from one canonical spot without pulling the whole shell file.

export interface AnalyticsPayload {
  totals: {
    events: number;
    unique_destinations: number;
    app_launches: number;
    link_clicks: number;
    first_event: string | null;
    last_event: string | null;
  };
  destinations: {
    id: string;
    name: string;
    kind: "app" | "link";
    count: number;
    first_used: string;
    last_used: string;
  }[];
  audit_log: {
    id: string;
    created_at: string;
    destination_id: string | null;
    destination_name: string;
    kind: "app" | "link";
    ip_address: string | null;
    user_agent: string | null;
  }[];
  audit_log_truncated: boolean;
}

export function shortenAgent(ua: string | null) {
  if (!ua) return "—";
  const m = ua.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/);
  if (m) return m[0];
  return ua.slice(0, 60) + (ua.length > 60 ? "…" : "");
}

// Map the analytics range picker to a punches window. The timesheet loader
// tops out at 30 days for direct fetch, so 90d/all fall back to 30d for the
// punches section — analytics side handles the wider windows independently.
export function rangeToDays(range: string): number {
  switch (range) {
    case "24h":
      return 1;
    case "7d":
      return 7;
    case "30d":
    case "90d":
    case "all":
      return 30;
    default:
      return 30;
  }
}
