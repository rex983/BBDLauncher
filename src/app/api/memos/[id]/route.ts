import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logMemoEvent } from "@/lib/memos/audit";
import { NextRequest, NextResponse } from "next/server";

// GET /api/memos/[id] — employee's memo detail. Only accessible if the
// caller is a recipient of the memo. Automatically stamps read_at on the
// recipient row on first successful GET (for read_receipt + signed modes).
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: recipient } = await supabase
    .from("office_memo_recipients")
    .select("id, delivered_at, read_at, acknowledged_at, signature_text, signature_hash")
    .eq("memo_id", id)
    .eq("profile_id", session.user.profileId)
    .single();
  if (!recipient) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: memo, error } = await supabase
    .from("office_memos")
    .select(
      "id, number, title, body, category, priority, acknowledgement_mode, effective_date, published_at, attachments, author_profile_id, document_hash, author_signature_hash, edit_count, last_edited_at",
    )
    .eq("id", id)
    .eq("status", "published")
    .single();
  if (error || !memo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Stamp read_at on first view (informational memos skip this — no
  // receipt required for those).
  if (!recipient.read_at && memo.acknowledgement_mode !== "informational") {
    const now = new Date().toISOString();
    await supabase
      .from("office_memo_recipients")
      .update({ read_at: now })
      .eq("id", recipient.id);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const ua = req.headers.get("user-agent")?.slice(0, 512) || null;
    logMemoEvent({
      memoId: id,
      eventType: "recipient_read",
      actorProfileId: session.user.profileId,
      actorIp: ip,
      actorUa: ua,
    }).catch(() => undefined);
    recipient.read_at = now;
  }

  const { data: author } = memo.author_profile_id
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", memo.author_profile_id)
        .single()
    : { data: null };

  return NextResponse.json({
    ...memo,
    author_name: author?.full_name || null,
    recipient,
  });
}
