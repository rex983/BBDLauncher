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

  // Inner-join on profiles applies the scope (is_active, department,
  // office) in the same roundtrip as the request read — same pattern as
  // /api/management/timeoff/pending-count — instead of fetching scoped
  // profile IDs first and then `.in("profile_id", ids)`.
  const dept = scope.department ?? params.departmentOverride;
  const off = scope.office ?? params.officeOverride;
  let query = supabase
    .from("time_off_requests")
    .select(
      "id, profile_id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_by, decided_at, created_at, attachments, profile:profiles!profile_id!inner(id, email, name:full_name, office, department)",
    )
    .in("status", statuses)
    .eq("profile.is_active", true);
  if (dept) query = query.eq("profile.department", dept);
  if (off) query = query.eq("profile.office", off);

  const { data: requests } = await query.order("start_date", { ascending: true });
  return (requests || []) as unknown as TimeOffQueueRow[];
}
