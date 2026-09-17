import { computeState, type TimePunch } from "./state";
import { localDateInZone, scheduledTimeInZone } from "./tz";

export const OVERTIME_THRESHOLD_MS = 40 * 60 * 60 * 1000; // 40h

export interface WeeklyHours {
  worked_ms: number;
  overtime_ms: number;
  is_overtime: boolean;
}

export interface DayTotals {
  worked_ms: number;
  lunch_ms: number;
  break_ms: number;
}

// Fold one ET-local day's punches into worked/lunch/break, capping the
// open-shift extension at end-of-that-day. Without the cap, a clock_in
// with no matching clock_out on the same day would accumulate hours all
// the way to `now` — which is how a single stranded shift turns into
// 93h/week. For today, the cap is `now` (live totals still tick).
export function computeDayTotals(
  dayPunches: TimePunch[],
  dayKey: string,
  now: Date = new Date(),
): DayTotals {
  const todayKey = localDateInZone(now);
  let dayNow: Date;
  if (dayKey === todayKey) {
    dayNow = now;
  } else {
    // End of that day = 00:00 ET of the NEXT calendar day, minus 1 ms.
    const [y, m, d] = dayKey.split("-").map(Number);
    const nextDayNoonUtc = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
    const nextDayMidnight = scheduledTimeInZone(nextDayNoonUtc, "00:00");
    dayNow = new Date(nextDayMidnight.getTime() - 1);
  }
  const s = computeState(dayPunches, dayNow);
  return { worked_ms: s.worked_ms, lunch_ms: s.lunch_ms, break_ms: s.break_ms };
}

// Convenience alias for callers that only care about worked time. Kept as
// a separate name so grepping for lunch/break totals still turns up the
// three-value helper above.
export function computeDayWorkedMs(
  dayPunches: TimePunch[],
  dayKey: string,
  now: Date = new Date(),
): number {
  return computeDayTotals(dayPunches, dayKey, now).worked_ms;
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
  for (const [dayKey, list] of buckets) {
    total += computeDayWorkedMs(list, dayKey, now);
  }
  const overtime = Math.max(0, total - OVERTIME_THRESHOLD_MS);
  return {
    worked_ms: total,
    overtime_ms: overtime,
    is_overtime: overtime > 0,
  };
}
