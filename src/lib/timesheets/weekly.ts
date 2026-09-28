import { computeState, type TimePunch } from "./state";
import {
  localDateInZone,
  scheduledTimeInZone,
  startOfWeekSundayInZone,
} from "./tz";

export const OVERTIME_THRESHOLD_MS = 40 * 60 * 60 * 1000; // 40h
const DAY_MS = 24 * 60 * 60 * 1000;

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

// Current Sun–Sat ET week only. Callers pass punches from the week start.
export function computeWeeklyHours(
  punches: TimePunch[],
  now: Date = new Date(),
): WeeklyHours {
  const [week] = computeWeeklyBreakdown(punches, [startOfWeekSundayInZone(now)], now);
  return {
    worked_ms: week.worked_ms,
    overtime_ms: week.overtime_ms,
    is_overtime: week.overtime_ms > 0,
  };
}

export interface WeekTotals {
  week_start: string;
  worked_ms: number;
  overtime_ms: number;
  lunch_ms: number;
  break_ms: number;
}

// Sunday-anchored ET week starts, oldest → newest, from the week containing
// `from` through the week containing `now`. Walks back one zone-local week
// at a time instead of subtracting 7×24h so DST transitions can't drift a
// boundary off midnight.
export function buildWeekStarts(from: Date, now: Date = new Date()): Date[] {
  const first = startOfWeekSundayInZone(from).getTime();
  const starts: Date[] = [];
  let cur = startOfWeekSundayInZone(now);
  while (cur.getTime() >= first) {
    starts.unshift(cur);
    cur = startOfWeekSundayInZone(new Date(cur.getTime() - DAY_MS));
  }
  return starts;
}

// Week start of the week containing Jan 1 (ET) of `now`'s year. YTD
// overtime counts every Sunday-anchored week from here on, so the week
// that straddles New Year's is attributed to the new year.
export function startOfYearWeekInZone(now: Date = new Date()): Date {
  const year = localDateInZone(now).slice(0, 4);
  return startOfWeekSundayInZone(new Date(`${year}-01-01T12:00:00Z`));
}

// One profile's punches → per-week worked/overtime/lunch/break, one entry
// per `weekStarts` (zeros for weeks with no punches). Punches outside the
// given weeks are ignored. Each ET day folds independently via
// computeDayTotals so a stranded open shift can't bleed into later days.
export function computeWeeklyBreakdown(
  punches: TimePunch[],
  weekStarts: Date[],
  now: Date = new Date(),
): WeekTotals[] {
  const weekIndex = new Map<string, number>();
  weekStarts.forEach((d, i) => weekIndex.set(d.toISOString(), i));
  const dayToWeek = new Map<string, number>();
  const days: Map<string, TimePunch[]>[] = weekStarts.map(() => new Map());

  for (const p of punches) {
    const at = new Date(p.occurred_at);
    const dayKey = localDateInZone(at);
    let idx = dayToWeek.get(dayKey);
    if (idx === undefined) {
      idx = weekIndex.get(startOfWeekSundayInZone(at).toISOString()) ?? -1;
      dayToWeek.set(dayKey, idx);
    }
    if (idx < 0) continue;
    const list = days[idx].get(dayKey) || [];
    list.push(p);
    days[idx].set(dayKey, list);
  }

  return weekStarts.map((ws, i) => {
    let worked = 0;
    let lunch = 0;
    let brk = 0;
    for (const [dayKey, list] of days[i]) {
      const t = computeDayTotals(list, dayKey, now);
      worked += t.worked_ms;
      lunch += t.lunch_ms;
      brk += t.break_ms;
    }
    return {
      week_start: ws.toISOString(),
      worked_ms: worked,
      overtime_ms: Math.max(0, worked - OVERTIME_THRESHOLD_MS),
      lunch_ms: lunch,
      break_ms: brk,
    };
  });
}

export interface WeeksSummary {
  worked_ms: number;
  overtime_ms: number;
  overtime_weeks: number; // weeks with any time past 40h
  lunch_ms: number;
  break_ms: number;
}

// Roll a run of weeks (one employee's range/YTD, or one week across a team)
// into totals — the single definition of "weeks over 40h".
export function summarizeWeeks(weeks: WeekTotals[]): WeeksSummary {
  const out: WeeksSummary = { worked_ms: 0, overtime_ms: 0, overtime_weeks: 0, lunch_ms: 0, break_ms: 0 };
  for (const w of weeks) {
    out.worked_ms += w.worked_ms;
    out.overtime_ms += w.overtime_ms;
    out.lunch_ms += w.lunch_ms;
    out.break_ms += w.break_ms;
    if (w.overtime_ms > 0) out.overtime_weeks++;
  }
  return out;
}
