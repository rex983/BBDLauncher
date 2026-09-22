// Server-side helper for spawning bell notifications. Kept tiny and
// fire-and-forget by convention — every caller wraps the promise in
// `.catch(() => undefined)` so a broken row insert can't fail the primary
// action (e.g., signing a report should still work if notifications is
// misconfigured).

import { createAdminClient } from "@/lib/supabase/admin";

// Semantic tags for the `type` column. Add new ones as new workflows start
// sending notifications; the bell UI can render icons off this string.
export type NotificationType =
  | "incident_report_awaiting"
  | "incident_report_completed"
  | "office_memo_published"
  | "office_memo_acknowledged"
  | "time_off_decided"
  | "generic";

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}

export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("notifications").insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    href: params.href ?? null,
    reference_type: params.referenceType ?? null,
    reference_id: params.referenceId ?? null,
    metadata: params.metadata ?? null,
  });
  if (error) {
    console.error("[notifications] create failed:", error.message);
  }
}

// Soft-dismiss every non-dismissed notification pointing at a specific row.
// Used when a workflow closes itself — e.g. the employee signs the incident
// report, so the "awaiting your signature" ping is stale and should clear
// automatically instead of hanging around unread.
export async function dismissNotificationsByReference(
  referenceType: string,
  referenceId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("reference_type", referenceType)
    .eq("reference_id", referenceId)
    .is("dismissed_at", null);
  if (error) {
    console.error("[notifications] dismiss-by-reference failed:", error.message);
  }
}
