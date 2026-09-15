import { computeState, type TimePunch } from "./state";

export const OVERTIME_THRESHOLD_MS = 40 * 60 * 60 * 1000; // 40h

// Sunday 00:00 in server-local time for whatever week `date` falls in. We
// don't try to be tz-aware yet — the whole timesheet stack assumes ET,
// which is what Vercel's cron runs in.
export function startOfWeekSunday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function endOfWeekSaturday(date: Date): Date {
  const start = startOfWeekSunday(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export interface WeeklyHours {
  worked_ms: number;
  overtime_ms: number;
  is_overtime: boolean;
}

// Bucket punches by local day and fold each day into its own state so an
// open shift at week-end can't leak into a sibling day. Then sum daily
// worked_ms and derive overtime = max(0, total - 40h).
export function computeWeeklyHours(
  punches: TimePunch[],
  now: Date = new Date(),
): WeeklyHours {
  const buckets = new Map<string, TimePunch[]>();
  for (const p of punches) {
    const key = new Date(p.occurred_at).toLocaleDateString();
    const list = buckets.get(key) || [];
    list.push(p);
    buckets.set(key, list);
  }
  let total = 0;
  for (const list of buckets.values()) {
    total += computeState(list, now).worked_ms;
  }
  const overtime = Math.max(0, total - OVERTIME_THRESHOLD_MS);
  return {
    worked_ms: total,
    overtime_ms: overtime,
    is_overtime: overtime > 0,
  };
}
