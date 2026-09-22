import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logMemoEvent } from "@/lib/memos/audit";
import { hashRecipientSignature } from "@/lib/memos/hashing";
import { dismissNotificationsByReference } from "@/lib/notifications/service";
import { extractActorHeaders } from "@/lib/http";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ackSchema = z.object({
  signature_text: z.string().optional(),
  acknowledged: z.boolean().default(false),
});

// POST /api/memos/[id]/ack — recipient acknowledges the memo. For
// informational + read_receipt modes, this just clears the pending
// notification (opening the memo already stamped read_at). For signed
// mode, records the recipient's typed-name signature + hash chain +
// IP/UA and marks acknowledged_at.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = ackSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: memo } = await supabase
    .from("office_memos")
    .select(
      "id, acknowledgement_mode, document_hash, author_signature_hash, status",
    )
    .eq("id", id)
    .single();
  if (!memo || memo.status !== "published") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: recipient } = await supabase
    .from("office_memo_recipients")
    .select("id, acknowledged_at")
    .eq("memo_id", id)
    .eq("profile_id", session.user.profileId)
    .single();
  if (!recipient) {
    return NextResponse.json({ error: "Not a recipient" }, { status: 404 });
  }
  if (recipient.acknowledged_at) {
    return NextResponse.json({ ok: true, already: true });
  }

  const now = new Date().toISOString();
  const { ip, ua } = extractActorHeaders(req);

  const update: Record<string, unknown> = { acknowledged_at: now };
  if (!recipient.acknowledged_at) update.read_at = now;

  if (memo.acknowledgement_mode === "signed") {
    if (!parsed.data.acknowledged) {
      return NextResponse.json(
        { error: "Please confirm the acknowledgement checkbox." },
        { status: 400 },
      );
    }
    const signatureText = (parsed.data.signature_text || "").trim();
    if (signatureText.length < 3) {
      return NextResponse.json(
        { error: "Type your full name to sign." },
        { status: 400 },
      );
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", session.user.profileId)
      .single<{ full_name: string | null }>();
    const expected = (profile?.full_name || "").trim().toLowerCase().replace(/\s+/g, " ");
    const normalized = signatureText.toLowerCase().replace(/\s+/g, " ");
    if (!expected || normalized !== expected) {
      return NextResponse.json(
        { error: "Type your full name exactly as it appears on your profile." },
        { status: 400 },
      );
    }
    if (!memo.document_hash || !memo.author_signature_hash) {
      return NextResponse.json(
        { error: "Memo missing signature evidence chain." },
        { status: 500 },
      );
    }
    const signatureHash = hashRecipientSignature({
      documentHash: memo.document_hash,
      authorSignatureHash: memo.author_signature_hash,
      signatureText,
      signedAt: now,
      ip,
      ua,
    });
    update.signature_text = signatureText;
    update.signature_hash = signatureHash;
    update.signature_ip = ip;
    update.signature_ua = ua;
  }

  const { error: updateErr } = await supabase
    .from("office_memo_recipients")
    .update(update)
    .eq("id", recipient.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  logMemoEvent({
    memoId: id,
    eventType: "recipient_acknowledged",
    actorProfileId: session.user.profileId,
    actorIp: ip,
    actorUa: ua,
    details: { mode: memo.acknowledgement_mode },
  }).catch(() => undefined);

  dismissNotificationsByReference("office_memo", id).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
