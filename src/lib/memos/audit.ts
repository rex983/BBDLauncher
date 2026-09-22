// Append-only audit log for office_memos. Fire-and-forget by convention —
// the primary action (publish, edit, ack) succeeds even if the audit
// write fails.

import { createAdminClient } from "@/lib/supabase/admin";

export type MemoEventType =
  | "draft_saved"
  | "published"
  | "edited"
  | "archived"
  | "recipient_read"
  | "recipient_acknowledged";

export interface LogMemoEventParams {
  memoId: string;
  eventType: MemoEventType;
  actorProfileId: string | null;
  actorIp?: string | null;
  actorUa?: string | null;
  details?: Record<string, unknown>;
}

export async function logMemoEvent(params: LogMemoEventParams): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("office_memo_events").insert({
    memo_id: params.memoId,
    event_type: params.eventType,
    actor_profile_id: params.actorProfileId,
    actor_ip: params.actorIp ?? null,
    actor_ua: params.actorUa ?? null,
    details: params.details ?? null,
  });
  if (error) {
    console.error("[memo-audit] log failed:", params.eventType, error.message);
  }
}

export const MEMO_EVENT_LABEL: Record<MemoEventType, string> = {
  draft_saved: "Draft saved",
  published: "Published & fanned out to recipients",
  edited: "Edited",
  archived: "Archived",
  recipient_read: "Recipient opened the memo",
  recipient_acknowledged: "Recipient acknowledged & signed",
};
