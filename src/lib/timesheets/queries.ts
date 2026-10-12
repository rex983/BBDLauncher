// Shared server-side loaders for /management/timesheets and its API
// route. Same reason as src/lib/incidents/queries.ts: one place for the
// scope + join logic so the server-rendered page and the client-refresh
// API both use it and can't drift.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopeProfilesQuery } from "@/lib/auth/scope-check";
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

const PUNCH_PAGE_SIZE = 1000;

// Same paging as fetchPunchesPaged (see src/lib/timesheets/punches.ts —
// PostgREST caps rows, so page on a stable (occurred_at, id) order), but
// scoped through an inner-join on profiles instead of `.in("profile_id",
// ids)`, so it doesn't have to wait on the profiles read.
async function fetchScopedPunchesPaged(
  supabase: SupabaseClient,
  dept: string | null | undefined,
  off: string | null | undefined,
  fromISO: string,
): Promise<TimePunch[]> {
  const page = (from: number) => {
    let q = supabase
      .from("time_punches")
      .select("id, profile_id, event_type, occurred_at, source, note, profile:profiles!profile_id!inner(id)")
      .gte("occurred_at", fromISO)
      .eq("profile.is_active", true);
    if (dept) q = q.eq("profile.department", dept);
    if (off) q = q.eq("profile.office", off);
    return q
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PUNCH_PAGE_SIZE - 1);
  };

  const out: TimePunch[] = [];
  // First page alone (the common single-page case), then small batches.
  for (let next = 0, batch = 1; ; batch = 4) {
    const offsets = Array.from({ length: batch }, (_, i) => next + i * PUNCH_PAGE_SIZE);
    next += batch * PUNCH_PAGE_SIZE;
    for (const res of await Promise.all(offsets.map(page))) {
      if (res.error) return [];
      const rows = res.data || [];
      // Drop the join-only `profile` embed so rows match fetchPunchesPaged's.
      for (const r of rows) {
        out.push({
          id: r.id,
          profile_id: r.profile_id,
          event_type: r.event_type,
          occurred_at: r.occurred_at,
          source: r.source,
          note: r.note,
        } as TimePunch);
      }
      if (rows.length < PUNCH_PAGE_SIZE) return out;
    }
  }
}

// Profiles-in-scope and time_punches-for-those-profiles run in parallel:
// the punch read applies the same scope via an inner-join on profiles
// rather than waiting for the profile IDs.
export async function loadTimesheetsToday(
  params: TodayParams,
): Promise<TimesheetTodayRow[]> {
  const { supabase, scope } = params;
  const now = params.now ?? new Date();
  const startOfDay = startOfDayInZone(now);
  const weekStart = startOfWeekSundayInZone(now);

  const [{ data: profiles }, punches] = await Promise.all([
    scopeProfilesQuery(
      supabase.from("profiles").select("id, email, name:full_name, role, office, department"),
      scope,
      { department: params.departmentOverride, office: params.officeOverride },
    ).order("email"),
    fetchScopedPunchesPaged(
      supabase,
      scope.department ?? params.departmentOverride,
      scope.office ?? params.officeOverride,
      weekStart.toISOString(),
    ),
  ]);
  if ((profiles || []).length === 0) return [];

  const punchesByProfile = new Map<string, TimePunch[]>();
  for (const p of punches) {
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
