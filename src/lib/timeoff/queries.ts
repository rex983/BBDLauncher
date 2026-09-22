// Shared server-side loader for the management time-off queue. Used by
// both /management/timeoff (server page, initial paint) and
// /api/management/timeoff GET (client refetch on filter change /
// decision). Same one-place-for-scope pattern as
// src/lib/incidents/queries.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TimeOffAttachment,
  TimeOffStatus,
  TimeOffType,
} from "@/lib/timeoff/types";

export interface TimeOffProfileSlice {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
  department: string | null;
}

export interface TimeOffQueueRow {
  id: string;
  profile_id: string;
  profile: TimeOffProfileSlice | null;
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  status: TimeOffStatus;
  reason: string | null;
  decided_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  attachments: TimeOffAttachment[] | null;
}

export interface ListParams {
  supabase: SupabaseClient;
  scope: { department: string | null; office: string | null };
  statuses?: string[]; // defaults to pending only, matching prior API behavior
  departmentOverride?: string | null;
  officeOverride?: string | null;
}

export async function loadTimeoffQueue(
  params: ListParams,
): Promise<TimeOffQueueRow[]> {
  const { supabase, scope, statuses = ["pending"] } = params;

  const departmentTarget = scope.department ?? params.departmentOverride ?? null;
  const officeTarget = scope.office ?? params.officeOverride ?? null;

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department")
    .eq("is_active", true);
  if (departmentTarget) profileQuery = profileQuery.eq("department", departmentTarget);
  if (officeTarget) profileQuery = profileQuery.eq("office", officeTarget);

  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return [];

  const { data: requests } = await supabase
    .from("time_off_requests")
    .select(
      "id, profile_id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_by, decided_at, created_at, attachments",
    )
    .in("profile_id", profileIds)
    .in("status", statuses)
    .order("start_date", { ascending: true });

  const profileMap = new Map<string, TimeOffProfileSlice>(
    (profiles || []).map((p) => [p.id, p as TimeOffProfileSlice]),
  );
  return (requests || []).map((r) => ({
    ...(r as Omit<TimeOffQueueRow, "profile">),
    profile: profileMap.get(r.profile_id) || null,
  }));
}
