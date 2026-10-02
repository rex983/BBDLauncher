import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { logMemoEvent } from "@/lib/memos/audit";
import { extractActorHeaders } from "@/lib/http";
import { NextRequest, NextResponse } from "next/server";

// GET /api/memos/[id] — employee's memo detail. Only accessible if the
// caller is a recipient of the memo. Automatically stamps read_at on the
// recipient row on first successful GET (for read_receipt + signed modes).
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const supabase = createAdminClient();
  const [{ data: recipient }, { data: memo, error }] = await Promise.all([
    supabase
      .from("office_memo_recipients")
      .select("id, delivered_at, read_at, acknowledged_at, signature_text, signature_hash")
      .eq("memo_id", id)
      .eq("profile_id", session.user.profileId)
      .single(),
    supabase
      .from("office_memos")
      .select(
        "id, number, title, body, category, priority, acknowledgement_mode, effective_date, published_at, attachments, author_profile_id, document_hash, author_signature_hash, edit_count, last_edited_at",
      )
      .eq("id", id)
      .eq("status", "published")
      .single(),
  ]);
  if (!recipient || error || !memo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Stamp read_at on first view (informational memos skip this — no
  // receipt required for those). Runs alongside the author lookup.
  const stampRead = !recipient.read_at && memo.acknowledgement_mode !== "informational";
  const now = new Date().toISOString();
  const [{ data: author }] = await Promise.all([
    memo.author_profile_id
      ? supabase
          .from("profiles")
          .select("full_name")
          .eq("id", memo.author_profile_id)
          .single()
      : Promise.resolve({ data: null }),
    stampRead &&
      supabase
        .from("office_memo_recipients")
        .update({ read_at: now })
        .eq("id", recipient.id),
  ]);
  if (stampRead) {
    const { ip, ua } = extractActorHeaders(req);
    logMemoEvent({
      memoId: id,
      eventType: "recipient_read",
      actorProfileId: session.user.profileId,
      actorIp: ip,
      actorUa: ua,
    }).catch(() => undefined);
    recipient.read_at = now;
  }

  return NextResponse.json({
    ...memo,
    author_name: author?.full_name || null,
    recipient,
  });
}
