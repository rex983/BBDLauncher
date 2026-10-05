// Work-schedule defaults + display helpers. Pure (no server imports) so
// client components, server pages, and the auto-clockout cron share one
// definition of the default workday.
import { DEFAULT_ZONE } from "./tz";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Profiles with no work_schedules rows work Mon–Fri 10:00–18:00 ET. Once a
// profile has ANY override row, weekdays without a row are days off.
export const DEFAULT_START = "10:00";
export const DEFAULT_END = "18:00";
export const DEFAULT_WORKDAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

export interface WorkScheduleRow {
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
}

export interface WeekViewDay {
  weekday: number;
  scheduled: boolean;
  start: string;
  end: string;
  tz: string;
}

// Full Sun–Sat schedule with the default fallback applied.
export function buildWeekView(schedules: WorkScheduleRow[]): WeekViewDay[] {
  const hasAnyOverride = schedules.length > 0;
  const byWeekday = new Map(schedules.map((s) => [s.weekday, s]));
  return WEEKDAY_LABELS.map((_, weekday) => {
    const override = byWeekday.get(weekday);
    if (override) {
      return {
        weekday,
        scheduled: true,
        start: override.start_time.slice(0, 5),
        end: override.end_time.slice(0, 5),
        tz: override.timezone,
      };
    }
    if (hasAnyOverride) {
      return { weekday, scheduled: false, start: "", end: "", tz: DEFAULT_ZONE };
    }
    return {
      weekday,
      scheduled: DEFAULT_WORKDAYS.has(weekday),
      start: DEFAULT_START,
      end: DEFAULT_END,
      tz: DEFAULT_ZONE,
    };
  });
}

// "HH:MM(:SS)" → "h:mm AM/PM".
export function formatClockTime(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

// Clock-ins up to 59s past the scheduled start are on time (10:00:59 is
// fine, 10:01:00 is late).
export const LATE_GRACE_MS = 60_000;

// Whole minutes late, or 0 when inside the grace window.
export function minutesLate(clockIn: Date, scheduledStart: Date): number {
  const diff = clockIn.getTime() - scheduledStart.getTime();
  return diff >= LATE_GRACE_MS ? Math.floor(diff / 60_000) : 0;
}
