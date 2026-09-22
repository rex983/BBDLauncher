// Append-only audit log for incident_reports. Every state-changing endpoint
// wraps its business-logic work with a call to logIncidentEvent(...) at the
// end. Fire-and-forget by convention — the primary action (sign, edit,
// cancel) succeeds even if the audit write fails; we log the failure to
// server console instead of unwinding the state change.

import { createAdminClient } from "@/lib/supabase/admin";

export type IncidentEventType =
  | "filed"
  | "edited"
  | "manager_signed"
  | "employee_signed"
  | "cancelled"
  | "admin_override_edit"
  | "admin_override_delete";

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface LogIncidentEventParams {
  incidentReportId: string;
  eventType: IncidentEventType;
  actorProfileId: string | null;
  actorIp?: string | null;
  actorUa?: string | null;
  details?: Record<string, unknown>;
}

export async function logIncidentEvent(params: LogIncidentEventParams): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("incident_report_events").insert({
    incident_report_id: params.incidentReportId,
    event_type: params.eventType,
    actor_profile_id: params.actorProfileId,
    actor_ip: params.actorIp ?? null,
    actor_ua: params.actorUa ?? null,
    details: params.details ?? null,
  });
  if (error) {
    console.error("[incident-audit] log failed:", params.eventType, error.message);
  }
}

// Human-readable label for the UI Activity timeline. Falls back to the raw
// event_type string so unknown/future types don't render blank.
export const EVENT_LABEL: Record<IncidentEventType, string> = {
  filed: "Filed",
  edited: "Edited",
  manager_signed: "Manager signed & sent to employee",
  employee_signed: "Employee acknowledged & signed",
  cancelled: "Cancelled",
  admin_override_edit: "Admin override — edited after signing",
  admin_override_delete: "Admin override — deleted after completion",
};
