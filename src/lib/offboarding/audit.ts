// Append-only audit log for offboarding cases — the "who did what, where
// and when" record. Same fire-and-forget convention as incidents/audit.ts:
// the primary action succeeds even if the log write fails; the failure is
// logged to the server console.

import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractActorHeaders } from "@/lib/http";

export interface LogOffboardingEventParams {
  caseId: string;
  taskId?: string | null;
  eventType: string;
  session: Session;
  req: NextRequest;
  details?: Record<string, unknown>;
}

export async function logOffboardingEvent(params: LogOffboardingEventParams): Promise<void> {
  const { ip, ua } = extractActorHeaders(params.req);
  const user = params.session.user;
  const supabase = createAdminClient();
  const { error } = await supabase.from("offboarding_events").insert({
    case_id: params.caseId,
    task_id: params.taskId ?? null,
    event_type: params.eventType,
    actor_profile_id: user.profileId,
    actor_name: user.name || user.email,
    actor_ip: ip,
    actor_ua: ua,
    details: params.details ?? null,
  });
  if (error) {
    console.error("[offboarding-audit] log failed:", params.eventType, error.message);
  }
}
