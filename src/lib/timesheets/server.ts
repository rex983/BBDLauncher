import { createAdminClient } from "@/lib/supabase/admin";
import { computeState, type TimePunch, type LiveState } from "./state";
import {
  DEFAULT_ZONE,
  localDateInZone,
  scheduledTimeInZone,
  startOfDayInZone,
  weekdayInZone,
} from "./tz";

const DEFAULT_START = "10:00";
const DEFAULT_END = "18:00";
const DEFAULT_WORKDAYS = new Set([1, 2, 3, 4, 5]); // Mon-Fri in ET

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

// Mirror of /api/timeclock/schedule so server components (namely /dashboard)
// can hydrate TimeClockShell without a client round-trip. Keep in sync
// with that route — both compute the effective end-of-day for the T-5
// prompt and the auto-clockout cron.
export async function getMyScheduleToday(
  profileId: string,
): Promise<TodayScheduleData> {
  const supabase = createAdminClient();
  const now = new Date();
  const weekday = weekdayInZone(now);

  const [overrideRes, anyOverrideRes, extensionRes] = await Promise.all([
    supabase
      .from("work_schedules")
      .select("weekday, start_time, end_time, timezone")
      .eq("profile_id", profileId)
      .eq("weekday", weekday)
      .maybeSingle(),
    supabase
      .from("work_schedules")
      .select("weekday")
      .eq("profile_id", profileId)
      .limit(1),
    supabase
      .from("time_extensions")
      .select("extension_until, requested_minutes")
      .eq("profile_id", profileId)
      .eq("local_date", localDateInZone(now))
      .maybeSingle(),
  ]);

  const override = overrideRes.data;
  const anyOverride = anyOverrideRes.data;
  const extension = extensionRes.data;

  let start = DEFAULT_START;
  let end = DEFAULT_END;
  let scheduled = DEFAULT_WORKDAYS.has(weekday);

  if (override) {
    start = override.start_time.slice(0, 5);
    end = override.end_time.slice(0, 5);
    scheduled = true;
  } else if (anyOverride && anyOverride.length > 0) {
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
