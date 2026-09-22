// Server-side memo helpers. `publishMemo` is the fan-out worker used by
// manual publish (POST /api/management/memos/[id]/publish) — the only
// path from draft → published. Idempotent: publishing an
// already-published memo returns the existing recipient list without
// re-inserting rows.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMemoAudience } from "@/lib/memos/audience";
import { logMemoEvent } from "@/lib/memos/audit";
import { createNotification } from "@/lib/notifications/service";
import { notifyMemoPublished } from "@/lib/slack/notify";
import {
  formatMemoNumber,
  type MemoAcknowledgementMode,
  type MemoAudienceScope,
  type MemoCategory,
  type MemoPriority,
} from "@/lib/memos/types";

interface MemoRow {
  id: string;
  number: number | null;
  author_profile_id: string | null;
  title: string;
  body: string;
  category: MemoCategory;
  priority: MemoPriority;
  acknowledgement_mode: MemoAcknowledgementMode;
  audience_scope: MemoAudienceScope;
  audience_office: string | null;
  audience_department: string | null;
  attachments: unknown;
  status: string;
  published_at: string | null;
  document_hash: string | null;
  author_signature_hash: string | null;
}

export interface PublishResult {
  memoId: string;
  recipientCount: number;
  alreadyPublished: boolean;
}

export async function publishMemo(params: {
  supabase: SupabaseClient;
  memoId: string;
  actorProfileId: string | null;
  actorIp: string | null;
  actorUa: string | null;
  customProfileIds?: string[];
}): Promise<PublishResult> {
  const { supabase, memoId, actorProfileId, actorIp, actorUa } = params;

  const { data: memo, error: fetchErr } = await supabase
    .from("office_memos")
    .select(
      "id, number, author_profile_id, title, body, category, priority, acknowledgement_mode, audience_scope, audience_office, audience_department, attachments, status, published_at, document_hash, author_signature_hash",
    )
    .eq("id", memoId)
    .single<MemoRow>();
  if (fetchErr || !memo) {
    throw new Error(fetchErr?.message || "Memo not found");
  }

  if (memo.status === "published") {
    const { count } = await supabase
      .from("office_memo_recipients")
      .select("id", { count: "exact", head: true })
      .eq("memo_id", memoId);
    return {
      memoId,
      recipientCount: count ?? 0,
      alreadyPublished: true,
    };
  }

  const { profileIds, audienceLabel } = await resolveMemoAudience({
    supabase,
    scope: memo.audience_scope,
    office: memo.audience_office,
    department: memo.audience_department,
    customProfileIds: params.customProfileIds ?? [],
  });

  const now = new Date().toISOString();

  if (profileIds.length > 0) {
    const rows = profileIds.map((profile_id) => ({
      memo_id: memoId,
      profile_id,
      delivered_at: now,
    }));
    const { error: insertErr } = await supabase
      .from("office_memo_recipients")
      .upsert(rows, { onConflict: "memo_id,profile_id", ignoreDuplicates: true });
    if (insertErr) {
      throw new Error(`Recipient fan-out failed: ${insertErr.message}`);
    }
  }

  const { error: updateErr } = await supabase
    .from("office_memos")
    .update({ status: "published", published_at: now })
    .eq("id", memoId);
  if (updateErr) {
    throw new Error(`Publish status update failed: ${updateErr.message}`);
  }

  logMemoEvent({
    memoId,
    eventType: "published",
    actorProfileId,
    actorIp,
    actorUa,
    details: {
      recipient_count: profileIds.length,
      audience_label: audienceLabel,
    },
  }).catch(() => undefined);

  // Bell notifications — one per recipient. Fire-and-forget, batched
  // through the same createNotification helper the incident flow uses.
  const numberLabel = formatMemoNumber(memo.number);
  const bodyLine = numberLabel ? `${numberLabel} · ${memo.title}` : memo.title;
  await Promise.all(
    profileIds.map((profileId) =>
      createNotification({
        userId: profileId,
        type: "office_memo_published",
        title: "New memo from BBD management.",
        body: bodyLine,
        href: `/memos/${memoId}`,
        referenceType: "office_memo",
        referenceId: memoId,
      }).catch(() => undefined),
    ),
  );

  // Slack: fire-and-forget notification with author + audience summary.
  let authorName: string | null = null;
  if (memo.author_profile_id) {
    const { data: authorRow } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", memo.author_profile_id)
      .single<{ full_name: string | null }>();
    authorName = authorRow?.full_name ?? null;
  }
  notifyMemoPublished({
    memoId,
    numberLabel,
    title: memo.title,
    category: memo.category,
    priority: memo.priority,
    audienceLabel,
    recipientCount: profileIds.length,
    authorName: authorName || "Unknown",
    ackMode: memo.acknowledgement_mode,
  }).catch(() => undefined);

  return {
    memoId,
    recipientCount: profileIds.length,
    alreadyPublished: false,
  };
}
