// Attendance report for /management/attendance: who arrived late, who
// stayed past their shift, who left early, who never showed. Everything is
// derived from the punch log + work schedules + approved time off, so it
// covers history from before the late-reason prompt existed. Schedules
// have no history: past days are judged against today's schedule.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopeProfilesQuery } from "@/lib/auth/scope-check";
import { computeState, type TimePunch } from "./state";
import { fetchPunchesPaged } from "./punches";
import { localDateInZone, scheduledTimeInZone } from "./tz";
import { buildWeekView, LATE_GRACE_MS, minutesLate, WEEKDAY_LABELS, type WorkScheduleRow } from "./schedule";
import { buildWeekStarts, computeDayWorkedMs, computeWeeklyBreakdown } from "./weekly";
import type { Department, Office } from "@/types/auth";

import type { AttendanceRange } from "./attendance-ranges";
export { ATTENDANCE_RANGES, type AttendanceRange } from "./attendance-ranges";

export type AttendanceEventKind =
  | "late"
  | "absent"
  | "early_leave"
  | "overtime"
  | "missed_clockout"
  | "unscheduled"
  | "weekly_overtime";

export interface AttendanceEvent {
  id: string;
  kind: AttendanceEventKind;
  date: string; // ET calendar day (week start for weekly_overtime)
  at: string | null; // the punch behind the event, if any
  profile_id: string;
  name: string;
  minutes: number; // late / early / over by; worked minutes for unscheduled days
  scheduled: string | null; // the schedule edge it's measured against, "HH:MM"
  reason: string | null; // late reason (the clock-in punch note)
  live?: boolean; // still on the clock past their shift
}

export interface EmployeeAttendance {
  profile_id: string;
  name: string;
  office: Office | null;
  department: Department | null;
  scheduled_days: number;
  on_time: number;
  late: number;
  absent: number;
  time_off: number;
  late_minutes: number;
  early_leaves: number;
  overtime_minutes: number;
  weekly_overtime_minutes: number;
  missed_clockouts: number;
  unscheduled_days: number;
  worked_ms: number;
}

// One scheduled person on one day, for the per-day breakdown.
export interface AttendanceDayPerson {
  profile_id: string;
  name: string;
  status: "on_time" | "late" | "absent" | "time_off" | "not_in"; // not_in: today, shift started, no clock-in yet
  at: string | null; // first clock-in
  minutes: number; // clock-in vs. shift start: negative = early, positive = late
  scheduled: string | null; // shift start, "HH:MM"
  reason: string | null; // late reason
  partial_off?: boolean; // partial-day time off covered the start
}

export interface AttendanceDay {
  date: string;
  on_time: number;
  late: number;
  absent: number;
  time_off: number;
  people: AttendanceDayPerson[];
}

export interface AttendanceReport {
  from: string;
  to: string;
  days: number;
  employees: EmployeeAttendance[];
  events: AttendanceEvent[];
  daily: AttendanceDay[];
  arrivals: { label: string; count: number; late: boolean }[];
  weekdays: { day: string; on_time: number; late: number }[];
  today: {
    scheduled: number;
    on_time: number;
    late: number;
    not_in: number;
    time_off: number;
    on_clock: number;
    on_clock_people: { profile_id: string; name: string }[];
  };
}

const MIN = 60_000;

// Clock-in offset from the scheduled start, bucketed for the histogram.
const ARRIVAL_BUCKETS: { label: string; upTo: number; late: boolean }[] = [
  { label: "5+ min early", upTo: -5 * MIN, late: false },
  { label: "0–5 min early", upTo: 0, late: false },
  { label: "On time", upTo: LATE_GRACE_MS, late: false },
  { label: "1–5 min late", upTo: 5 * MIN, late: true },
  { label: "5–15 min late", upTo: 15 * MIN, late: true },
  { label: "15–30 min late", upTo: 30 * MIN, late: true },
  { label: "30+ min late", upTo: Infinity, late: true },
];

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Mid-day UTC sits on the same ET calendar day year-round.
function anchor(key: string): Date {
  return new Date(`${key}T16:00:00Z`);
}

// Clock-outs the system inserted because nobody clocked out that day.
function isMissedClockout(p: TimePunch): boolean {
  return p.source === "auto" && /nightly|backfill/i.test(p.note ?? "");
}

interface LoadParams {
  supabase: SupabaseClient;
  scope: { department: string | null; office: string | null };
  departmentOverride?: string | null;
  officeOverride?: string | null;
  days: AttendanceRange;
  now?: Date;
}

export async function loadAttendance(params: LoadParams): Promise<AttendanceReport> {
  const { supabase, days } = params;
  const now = params.now ?? new Date();
  const todayKey = localDateInZone(now);
  const fromKey = addDays(todayKey, -(days - 1));
  const keys = Array.from({ length: days }, (_, i) => addDays(fromKey, i));

  const empty: AttendanceReport = {
    from: fromKey,
    to: todayKey,
    days,
    employees: [],
    events: [],
    daily: keys.map((date) => ({ date, on_time: 0, late: 0, absent: 0, time_off: 0, people: [] })),
    arrivals: ARRIVAL_BUCKETS.map((b) => ({ label: b.label, count: 0, late: b.late })),
    weekdays: [],
    today: { scheduled: 0, on_time: 0, late: 0, not_in: 0, time_off: 0, on_clock: 0, on_clock_people: [] },
  };

  const { data: profiles } = await scopeProfilesQuery(
    supabase
      .from("profiles")
      .select("id, name:full_name, email, office, department"),
    params.scope,
    { department: params.departmentOverride, office: params.officeOverride },
  ).order("full_name");
  if (!profiles?.length) return empty;
  const ids = profiles.map((p) => p.id as string);

  // Weekly overtime needs whole weeks, so punches start at the Sunday on or
  // before the range.
  const weekStarts = buildWeekStarts(anchor(fromKey), now);
  const [punchesRes, schedulesRes, timeOffRes] = await Promise.all([
    fetchPunchesPaged(supabase, ids, weekStarts[0].toISOString()),
    supabase
      .from("work_schedules")
      .select("profile_id, weekday, start_time, end_time, timezone")
      .in("profile_id", ids),
    supabase
      .from("time_off_requests")
      .select("profile_id, start_date, end_date, full_day")
      .in("profile_id", ids)
      .eq("status", "approved")
      .lte("start_date", todayKey)
      .gte("end_date", fromKey),
  ]);

  const schedulesBy = new Map<string, WorkScheduleRow[]>();
  for (const s of schedulesRes.data ?? []) {
    const list = schedulesBy.get(s.profile_id) ?? [];
    list.push(s);
    schedulesBy.set(s.profile_id, list);
  }
  const timeOffBy = new Map<string, { start_date: string; end_date: string; full_day: boolean }[]>();
  for (const t of timeOffRes.data ?? []) {
    const list = timeOffBy.get(t.profile_id) ?? [];
    list.push(t);
    timeOffBy.set(t.profile_id, list);
  }
  const punchesBy = new Map<string, TimePunch[]>();
  for (const p of punchesRes.data) {
    const list = punchesBy.get(p.profile_id) ?? [];
    list.push(p);
    punchesBy.set(p.profile_id, list);
  }

  // Absences only count from someone's first-ever clock-in: before that
  // they weren't on the time clock yet (new hire, or an account that
  // doesn't clock in at all). Only people with no punch on or before their
  // first scheduled day in the range need the extra look back.
  const countsFromBy = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      const first = punchesBy.get(id)?.[0];
      const firstKey = first ? localDateInZone(new Date(first.occurred_at)) : null;
      const week = buildWeekView(schedulesBy.get(id) ?? []);
      const firstScheduled = keys.find((k) => week[new Date(`${k}T00:00:00Z`).getUTCDay()].scheduled);
      if (!firstScheduled || (firstKey && firstKey <= firstScheduled)) return;
      const { data } = await supabase
        .from("time_punches")
        .select("id")
        .eq("profile_id", id)
        .lt("occurred_at", weekStarts[0].toISOString())
        .limit(1);
      if (!data?.length) countsFromBy.set(id, firstKey ?? "9999-12-31");
    }),
  );

  const report = empty;
  const dailyBy = new Map(report.daily.map((d) => [d.date, d]));
  const weekdayCounts = WEEKDAY_LABELS.map(() => ({ on_time: 0, late: 0, scheduled: 0 }));

  for (const profile of profiles) {
    const id = profile.id as string;
    const name = (profile.name as string | null) || (profile.email as string);
    const week = buildWeekView(schedulesBy.get(id) ?? []);
    const timeOff = timeOffBy.get(id) ?? [];
    const all = punchesBy.get(id) ?? [];
    const countsFrom = countsFromBy.get(id) ?? fromKey;

    const byDay = new Map<string, TimePunch[]>();
    for (const p of all) {
      const k = localDateInZone(new Date(p.occurred_at));
      const list = byDay.get(k) ?? [];
      list.push(p);
      byDay.set(k, list);
    }

    const emp: EmployeeAttendance = {
      profile_id: id,
      name,
      office: profile.office as Office | null,
      department: profile.department as Department | null,
      scheduled_days: 0,
      on_time: 0,
      late: 0,
      absent: 0,
      time_off: 0,
      late_minutes: 0,
      early_leaves: 0,
      overtime_minutes: 0,
      weekly_overtime_minutes: 0,
      missed_clockouts: 0,
      unscheduled_days: 0,
      worked_ms: 0,
    };
    const event = (kind: AttendanceEventKind, date: string, e: Partial<AttendanceEvent> = {}) =>
      report.events.push({
        id: `${kind}:${id}:${date}`,
        kind,
        date,
        at: null,
        profile_id: id,
        name,
        minutes: 0,
        scheduled: null,
        reason: null,
        ...e,
      });

    for (const key of keys) {
      const dayPunches = byDay.get(key) ?? [];
      const isToday = key === todayKey;
      if (dayPunches.length) emp.worked_ms += computeDayWorkedMs(dayPunches, key, now);
      if (isToday && computeState(dayPunches, now).status !== "clocked_out") {
        report.today.on_clock++;
        report.today.on_clock_people.push({ profile_id: id, name });
      }

      const last = dayPunches.at(-1);
      const missed = !!last && last.event_type === "clock_out" && isMissedClockout(last);
      if (missed) {
        emp.missed_clockouts++;
        event("missed_clockout", key, { at: last!.occurred_at });
      }

      const day = week[new Date(`${key}T00:00:00Z`).getUTCDay()];
      const firstIn = dayPunches.find((p) => p.event_type === "clock_in");
      if (!day.scheduled) {
        if (firstIn) {
          emp.unscheduled_days++;
          event("unscheduled", key, {
            at: firstIn.occurred_at,
            minutes: Math.round(computeDayWorkedMs(dayPunches, key, now) / MIN),
          });
        }
        continue;
      }
      if (key < countsFrom) continue;

      const start = scheduledTimeInZone(anchor(key), day.start);
      const end = scheduledTimeInZone(anchor(key), day.end);
      const off = timeOff.find((t) => t.start_date <= key && key <= t.end_date);
      const daily = dailyBy.get(key)!;
      const wd = weekdayCounts[new Date(`${key}T00:00:00Z`).getUTCDay()];
      if (isToday) report.today.scheduled++;
      const person = (status: AttendanceDayPerson["status"], e: Partial<AttendanceDayPerson> = {}) =>
        daily.people.push({ profile_id: id, name, status, at: null, minutes: 0, scheduled: day.start, reason: null, ...e });

      if (off?.full_day) {
        emp.time_off++;
        daily.time_off++;
        person("time_off");
        if (isToday) report.today.time_off++;
        continue;
      }

      if (!firstIn) {
        if (!isToday || now > end) {
          emp.scheduled_days++;
          emp.absent++;
          daily.absent++;
          person("absent");
          event("absent", key, { scheduled: day.start });
        } else if (now.getTime() >= start.getTime() + LATE_GRACE_MS) {
          report.today.not_in++;
          person("not_in");
        }
        continue;
      }

      emp.scheduled_days++;
      wd.scheduled++;
      const inAt = new Date(firstIn.occurred_at);
      const offset = inAt.getTime() - start.getTime();
      const bucket = ARRIVAL_BUCKETS.findIndex((b) => offset < b.upTo);
      report.arrivals[bucket].count++;

      // Partial-day time off covers a late start or an early finish.
      const lateBy = off ? 0 : minutesLate(inAt, start);
      person(lateBy > 0 ? "late" : "on_time", {
        at: firstIn.occurred_at,
        minutes: lateBy > 0 ? lateBy : Math.round(offset / MIN),
        reason: lateBy > 0 ? firstIn.note : null,
        ...(off && offset >= LATE_GRACE_MS ? { partial_off: true } : {}),
      });
      if (lateBy > 0) {
        emp.late++;
        emp.late_minutes += lateBy;
        daily.late++;
        wd.late++;
        if (isToday) report.today.late++;
        event("late", key, {
          at: firstIn.occurred_at,
          minutes: lateBy,
          scheduled: day.start,
          reason: firstIn.note,
        });
      } else {
        emp.on_time++;
        daily.on_time++;
        wd.on_time++;
        if (isToday) report.today.on_time++;
      }

      if (!last || missed) continue;
      if (last.event_type === "clock_out") {
        const diff = new Date(last.occurred_at).getTime() - end.getTime();
        if (diff >= LATE_GRACE_MS) {
          const minutes = Math.floor(diff / MIN);
          emp.overtime_minutes += minutes;
          event("overtime", key, { at: last.occurred_at, minutes, scheduled: day.end });
        } else if (!off && -diff >= LATE_GRACE_MS) {
          emp.early_leaves++;
          event("early_leave", key, {
            at: last.occurred_at,
            minutes: Math.floor(-diff / MIN),
            scheduled: day.end,
          });
        }
      } else if (isToday && now.getTime() - end.getTime() >= LATE_GRACE_MS) {
        const minutes = Math.floor((now.getTime() - end.getTime()) / MIN);
        emp.overtime_minutes += minutes;
        event("overtime", key, { at: null, minutes, scheduled: day.end, live: true });
      }
    }

    for (const w of computeWeeklyBreakdown(all, weekStarts, now)) {
      if (w.overtime_ms <= 0) continue;
      const minutes = Math.round(w.overtime_ms / MIN);
      emp.weekly_overtime_minutes += minutes;
      event("weekly_overtime", localDateInZone(new Date(w.week_start)), { minutes });
    }

    // People who never clock in would only add empty rows.
    if (all.length) report.employees.push(emp);
  }

  report.weekdays = weekdayCounts
    .map((c, i) => ({ day: WEEKDAY_LABELS[i], on_time: c.on_time, late: c.late, scheduled: c.scheduled }))
    .filter((c) => c.scheduled > 0)
    .map(({ day, on_time, late }) => ({ day, on_time, late }));
  const rank = { late: 0, not_in: 1, absent: 2, time_off: 3, on_time: 4 } as const;
  for (const d of report.daily) {
    d.people.sort((a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.status === "late" ? b.minutes - a.minutes : (a.at ?? "").localeCompare(b.at ?? "")) ||
      a.name.localeCompare(b.name),
    );
  }
  report.today.on_clock_people.sort((a, b) => a.name.localeCompare(b.name));
  report.events.sort((a, b) =>
    a.date === b.date ? (b.at ?? "").localeCompare(a.at ?? "") : b.date.localeCompare(a.date),
  );
  return report;
}
