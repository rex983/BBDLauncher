// Client-safe analytics range taxonomy. server.ts re-exports these; keep
// this file free of server imports so client components can use it.

export type AnalyticsRange = "24h" | "7d" | "30d" | "90d" | "all";

export const RANGE_DAYS: Record<AnalyticsRange, number | null> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

export const ANALYTICS_RANGES = Object.keys(RANGE_DAYS) as AnalyticsRange[];

export const ANALYTICS_RANGE_OPTIONS: { value: AnalyticsRange; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return typeof value === "string" && (ANALYTICS_RANGES as string[]).includes(value);
}

// ISO lower bound for a range (null = all time). Unknown values fall back
// to 30 days.
export function sinceIsoForRange(range: string, now = Date.now()): string | null {
  const days = isAnalyticsRange(range) ? RANGE_DAYS[range] : 30;
  return days === null ? null : new Date(now - days * 86400_000).toISOString();
}
