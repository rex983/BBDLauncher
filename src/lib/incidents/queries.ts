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
  // Leave out reports filed against this person (the viewing manager).
  excludeProfileId?: string;
}

const DEFAULT_STATUSES = [
  "draft",
  "awaiting_manager_sig",
  "awaiting_employee_sig",
  "completed",
  "cancelled",
];

// Returns the enriched summary list in one roundtrip: an inner-join on
// profiles applies the scope (is_active, department, office) and embeds
// the employee slice — same pattern as
// /api/management/incidents/pending-count — instead of fetching scoped
// profile IDs first and then `.in("employee_profile_id", ids)`.
export async function listScopedIncidentSummaries(
  params: ListParams,
): Promise<IncidentSummary[]> {
  const { supabase, scope, statuses = DEFAULT_STATUSES } = params;

  const dept = scope.department ?? params.departmentOverride;
  const off = scope.office ?? params.officeOverride;
  let query = supabase
    .from("incident_reports")
    .select(
      "id, number, employee_profile_id, reporter_profile_id, title, severity, category, status, occurred_at, attachments, manager_signed_at, employee_signed_at, cancelled_at, created_at, updated_at, employee:profiles!employee_profile_id!inner(id, email, name:full_name, office, department)",
    )
    .in("status", statuses)
    .eq("employee.is_active", true);
  if (dept) query = query.eq("employee.department", dept);
  if (off) query = query.eq("employee.office", off);
  if (params.excludeProfileId) query = query.neq("employee_profile_id", params.excludeProfileId);

  const { data: reports } = await query.order("created_at", { ascending: false });
  return (reports || []) as unknown as IncidentSummary[];
}
