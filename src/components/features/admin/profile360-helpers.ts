// Shared types, constants, and pure helpers for the admin user-profile 360
// shell. Split out so the shell + its per-tab sub-components can import
// from one canonical spot without pulling the whole shell file.

import { computeState, type PunchEventType, type TimePunch } from "@/lib/timesheets/state";
import { computeDayWorkedMs } from "@/lib/timesheets/weekly";
import { localDateInZone, startOfDayInZone } from "@/lib/timesheets/tz";
import type { IncidentSeverity } from "@/lib/incidents/types";
import type { YtdBreakdown } from "@/lib/timesheets/detail";

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

export const RANGES = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DEFAULT_WORKDAYS = new Set([1, 2, 3, 4, 5]);
export const DEFAULT_START = "10:00";
export const DEFAULT_END = "18:00";

export const SEVERITY_VARIANT: Record<
  IncidentSeverity,
  "default" | "secondary" | "outline" | "destructive"
> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  critical: "destructive",
};

export const EVENT_LABEL: Record<PunchEventType, string> = {
  clock_in: "Clock in",
  clock_out: "Clock out",
  lunch_start: "Lunch start",
  lunch_end: "Lunch end",
  break_start: "Break start",
  break_end: "Break end",
};

export function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}

export function fmtTime(t: string) {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

export function fmtDays(d: number): string {
  return d === 0 ? "0" : (Math.round(d * 10) / 10).toString();
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

// Bucketed totals across the punches window. Same math as the /profile page.
export function aggregatePunches(punches: TimePunch[]): {
  worked_ms: number;
  lunch_ms: number;
  break_ms: number;
  days: number;
} {
  if (punches.length === 0) return { worked_ms: 0, lunch_ms: 0, break_ms: 0, days: 0 };
  const now = new Date();
  const startOfToday = startOfDayInZone(now);
  const todayKey = localDateInZone(now);

  const dayBuckets = new Map<string, TimePunch[]>();
  for (const p of punches) {
    const key = localDateInZone(new Date(p.occurred_at));
    const list = dayBuckets.get(key) || [];
    list.push(p);
    dayBuckets.set(key, list);
  }

  let worked_ms = 0;
  let lunch_ms = 0;
  let break_ms = 0;
  for (const [dayKey, list] of dayBuckets) {
    worked_ms += computeDayWorkedMs(list, dayKey, now);
    const capNow = dayKey === todayKey ? now : new Date(startOfToday);
    if (dayKey !== todayKey) {
      const [y, m, d] = dayKey.split("-").map(Number);
      const dayEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
      capNow.setTime(dayEnd.getTime());
    }
    const s = computeState(list, capNow);
    lunch_ms += s.lunch_ms;
    break_ms += s.break_ms;
  }
  return { worked_ms, lunch_ms, break_ms, days: dayBuckets.size };
}

export function emptyYtd(): YtdBreakdown {
  return { vacation: 0, sick: 0, personal: 0, parental: 0, other: 0, total: 0 };
}
