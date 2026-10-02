import { createAdminClient } from "@/lib/supabase/admin";
import { computeState, type TimePunch, type LiveState } from "./state";
import {
  DEFAULT_ZONE,
  localDateInZone,
  scheduledTimeInZone,
  startOfDayInZone,
  weekdayInZone,
} from "./tz";
import { DEFAULT_END, DEFAULT_START, DEFAULT_WORKDAYS } from "./schedule";

export interface TodayScheduleData {
  scheduled: boolean;
  start_time: string;
  end_time: string;
  timezone: string;
  end_of_day_iso: string | null;
  extension_until_iso: string | null;
  effective_end_iso: string | null;
}

// Fetches today's (ET-day) punches for a profile and folds them into
// current state.
export async function getMyStateToday(profileId: string): Promise<{
  state: LiveState;
  punches: TimePunch[];
}> {
  const supabase = createAdminClient();
  const startOfDay = startOfDayInZone(new Date());

  const { data } = await supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at, source, note")
    .eq("profile_id", profileId)
    .gte("occurred_at", startOfDay.toISOString())
    .order("occurred_at", { ascending: true });

  const punches = (data || []) as TimePunch[];
  return { state: computeState(punches), punches };
}

// Today's schedule + effective end-of-day (for the T-5 prompt and the
// auto-clockout cron). Served by /api/timeclock/schedule and used directly
// by /dashboard to hydrate TimeClockShell without a client round-trip.
export async function getMyScheduleToday(
  profileId: string,
): Promise<TodayScheduleData> {
  const supabase = createAdminClient();
  const now = new Date();
  const weekday = weekdayInZone(now);

  // All of the profile's schedule rows (at most one per weekday) answer both
  // "is there an override for today" and "has any override at all".
  const [schedulesRes, extensionRes] = await Promise.all([
    supabase
      .from("work_schedules")
      .select("weekday, start_time, end_time")
      .eq("profile_id", profileId),
    supabase
      .from("time_extensions")
      .select("extension_until, requested_minutes")
      .eq("profile_id", profileId)
      .eq("local_date", localDateInZone(now))
      .maybeSingle(),
  ]);

  const schedules = schedulesRes.data || [];
  const override = schedules.find((s) => s.weekday === weekday);
  const extension = extensionRes.data;

  let start = DEFAULT_START;
  let end = DEFAULT_END;
  let scheduled = DEFAULT_WORKDAYS.has(weekday);

  if (override) {
    start = override.start_time.slice(0, 5);
    end = override.end_time.slice(0, 5);
    scheduled = true;
  } else if (schedules.length > 0) {
    scheduled = false;
  }

  const scheduledEndIso = scheduled ? scheduledTimeInZone(now, end).toISOString() : null;
  const extensionUntilIso = extension?.extension_until ?? null;
  const effectiveEndIso =
    extensionUntilIso && scheduledEndIso
      ? new Date(extensionUntilIso) > new Date(scheduledEndIso)
        ? extensionUntilIso
        : scheduledEndIso
      : extensionUntilIso ?? scheduledEndIso;

  return {
    scheduled,
    start_time: start,
    end_time: end,
    timezone: DEFAULT_ZONE,
    end_of_day_iso: scheduledEndIso,
    extension_until_iso: extensionUntilIso,
    effective_end_iso: effectiveEndIso,
  };
}

// Returns true if the profile is currently clocked in (working / lunch / break).
// Reads only the single latest punch — no day-fold needed for a boolean.
export async function isClockedIn(profileId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("time_punches")
    .select("event_type")
    .eq("profile_id", profileId)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  return data.event_type !== "clock_out";
}
