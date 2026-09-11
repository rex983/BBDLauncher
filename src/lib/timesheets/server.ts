import { createAdminClient } from "@/lib/supabase/admin";
import { computeState, type TimePunch, type LiveState } from "./state";

// Fetches today's punches for a profile and folds them into current state.
export async function getMyStateToday(profileId: string): Promise<{
  state: LiveState;
  punches: TimePunch[];
}> {
  const supabase = createAdminClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

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
export async function isClockedIn(profileId: string): Promise<boolean> {
  const { state } = await getMyStateToday(profileId);
  return state.status !== "clocked_out";
}
