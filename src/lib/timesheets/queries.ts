// Shared server-side loaders for /management/timesheets and its API
// route. Same reason as src/lib/incidents/queries.ts: one place for the
// scope + join logic so the server-rendered page and the client-refresh
// API both use it and can't drift.

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeState, type TimePunch, type LiveState } from "@/lib/timesheets/state";
import { computeWeeklyHours } from "@/lib/timesheets/weekly";
import { startOfDayInZone, startOfWeekSundayInZone } from "@/lib/timesheets/tz";
import type { Department, Office } from "@/types/auth";

export interface TimesheetTodayRow {
  profile: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    office: Office | null;
    department: Department | null;
  };
  state: LiveState;
  weekly: {
    worked_ms: number;
    overtime_ms: number;
    is_overtime: boolean;
  };
}

export interface TodayParams {
  supabase: SupabaseClient;
  scope: {
    department: string | null;
    office: string | null;
  };
  departmentOverride?: string | null;
  officeOverride?: string | null;
  now?: Date;
}

// Two DB reads: profiles-in-scope, then time_punches-for-those-profiles.
// Can't collapse to one query cleanly — the second filter depends on the
// first's output — but keeping it in a helper means the two callers
// (server page + API) each pay one function call, not two ad-hoc reads.
export async function loadTimesheetsToday(
  params: TodayParams,
): Promise<TimesheetTodayRow[]> {
  const { supabase, scope } = params;
  const now = params.now ?? new Date();
  const startOfDay = startOfDayInZone(now);
  const weekStart = startOfWeekSundayInZone(now);

  const departmentTarget = scope.department ?? params.departmentOverride ?? null;
  const officeTarget = scope.office ?? params.officeOverride ?? null;

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, role, office, department")
    .eq("is_active", true)
    .order("email");
  if (departmentTarget) profileQuery = profileQuery.eq("department", departmentTarget);
  if (officeTarget) profileQuery = profileQuery.eq("office", officeTarget);

  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return [];

  const { data: punches } = await supabase
    .from("time_punches")
    .select("id, profile_id, event_type, occurred_at, source, note")
    .in("profile_id", profileIds)
    .gte("occurred_at", weekStart.toISOString())
    .order("occurred_at", { ascending: true });

  const punchesByProfile = new Map<string, TimePunch[]>();
  for (const p of (punches || []) as TimePunch[]) {
    const list = punchesByProfile.get(p.profile_id) || [];
    list.push(p);
    punchesByProfile.set(p.profile_id, list);
  }

  return (profiles || []).map((profile) => {
    const all = punchesByProfile.get(profile.id) || [];
    const today = all.filter((p) => new Date(p.occurred_at) >= startOfDay);
    const state = computeState(today, now);
    const weekly = computeWeeklyHours(all, now);
    return { profile, state, weekly } as TimesheetTodayRow;
  });
}
