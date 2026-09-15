import { computeState, type TimePunch } from "./state";
import { localDateInZone, startOfWeekSundayInZone } from "./tz";

export const OVERTIME_THRESHOLD_MS = 40 * 60 * 60 * 1000; // 40h

// Sunday 00:00 ET of the calendar week containing `date`.
export function startOfWeekSunday(date: Date): Date {
  return startOfWeekSundayInZone(date);
}

export interface WeeklyHours {
  worked_ms: number;
  overtime_ms: number;
  is_overtime: boolean;
}

// Bucket punches by ET-local day and fold each day into its own state so
// an open shift at week-end can't leak into a sibling day. Then sum daily
// worked_ms and derive overtime = max(0, total - 40h).
export function computeWeeklyHours(
  punches: TimePunch[],
  now: Date = new Date(),
): WeeklyHours {
  const buckets = new Map<string, TimePunch[]>();
  for (const p of punches) {
    const key = localDateInZone(new Date(p.occurred_at));
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
