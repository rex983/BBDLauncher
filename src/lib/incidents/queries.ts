// Shared server-side data loaders for incident reports. Used by both the
// GET /api/management/incidents route and the /management/incidents page
// (which server-renders the initial rows so first paint has data instead
// of a "Loading…" flash + client-side round-trip).

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IncidentAttachment,
  IncidentCategory,
  IncidentSeverity,
  IncidentStatus,
} from "@/lib/incidents/types";

export interface IncidentEmployeeSlice {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
  department: string | null;
}

export interface IncidentSummary {
  id: string;
  number: number | null;
  employee_profile_id: string;
  reporter_profile_id: string | null;
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  status: IncidentStatus;
  occurred_at: string | null;
  attachments: IncidentAttachment[] | null;
  manager_signed_at: string | null;
  employee_signed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  employee: IncidentEmployeeSlice | null;
}

export interface ScopeFilter {
  department: string | null;
  office: string | null;
}

export interface ListParams {
  supabase: SupabaseClient;
  scope: ScopeFilter;
  statuses?: string[];
  // Admin overlay filters — ignored when scope.department / scope.office are
  // already narrowed (managers can't override their own scope).
  departmentOverride?: string | null;
  officeOverride?: string | null;
}

const DEFAULT_STATUSES = [
  "draft",
  "awaiting_manager_sig",
  "awaiting_employee_sig",
  "completed",
  "cancelled",
];

// Runs the two queries incidents management needs (profiles-in-scope +
// incidents-for-those-profiles) in parallel where possible, folds the
// profile map into each row, and returns the enriched summary list.
//
// The two queries can't be a single JOIN cleanly because the profile
// scope drives which incidents are visible — but the profile fetch and
// the initial incident fetch don't depend on each other's data, so we
// still gain by kicking them off together and intersecting in memory.
export async function listScopedIncidentSummaries(
  params: ListParams,
): Promise<IncidentSummary[]> {
  const { supabase, scope, statuses = DEFAULT_STATUSES } = params;

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

  const { data: reports } = await supabase
    .from("incident_reports")
    .select(
      "id, number, employee_profile_id, reporter_profile_id, title, severity, category, status, occurred_at, attachments, manager_signed_at, employee_signed_at, cancelled_at, created_at, updated_at",
    )
    .in("employee_profile_id", profileIds)
    .in("status", statuses)
    .order("created_at", { ascending: false });

  const profileMap = new Map<string, IncidentEmployeeSlice>(
    (profiles || []).map((p) => [p.id, p as IncidentEmployeeSlice]),
  );
  return (reports || []).map((r) => ({
    ...(r as Omit<IncidentSummary, "employee">),
    employee: profileMap.get(r.employee_profile_id) || null,
  }));
}
