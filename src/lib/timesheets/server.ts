import { createAdminClient } from "@/lib/supabase/admin";
import { computeState, type TimePunch, type LiveState } from "./state";
import { startOfDayInZone } from "./tz";

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
