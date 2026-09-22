import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/permissions";
import { formatMemoNumber } from "@/lib/memos/types";
import { notifyMemoPurged } from "@/lib/slack/notify";
import { NextRequest, NextResponse } from "next/server";

// POST /api/management/memos/[id]/purge — HARD delete a memo. Admin
// only. Removes the memo row (recipients + events cascade), attachment
// files, and any pending bell notifications. Distinct from DELETE
// (which sets status='archived' for audit).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = createAdminClient();

  const { data: memo, error: fetchErr } = await supabase
    .from("office_memos")
    .select(
      "id, number, author_profile_id, title, status, audience_scope, audience_office, audience_department, attachments, created_at",
    )
    .eq("id", id)
    .single();
  if (fetchErr || !memo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Recipient count snapshot for the Slack payload — after the delete
  // the roster is gone.
  const { count: recipientCount } = await supabase
    .from("office_memo_recipients")
    .select("id", { count: "exact", head: true })
    .eq("memo_id", id);

  const { data: author } = memo.author_profile_id
    ? await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", memo.author_profile_id)
        .single()
    : { data: null };

  const numberLabel = formatMemoNumber(memo.number);
  const attachmentPaths = Array.isArray(memo.attachments)
    ? (memo.attachments as { path: string }[]).map((a) => a.path).filter(Boolean)
    : [];

  notifyMemoPurged({
    numberLabel,
    title: memo.title,
    authorName: author?.full_name || null,
    authorEmail: author?.email || null,
    actorName: session.user.name || session.user.email || "Unknown admin",
    attachmentCount: attachmentPaths.length,
    recipientCount: recipientCount ?? 0,
    createdAt: memo.created_at,
    priorStatus: memo.status,
  }).catch(() => undefined);

  if (attachmentPaths.length > 0) {
    const { error: storageErr } = await supabase.storage
      .from("office-memo-attachments")
      .remove(attachmentPaths);
    if (storageErr) {
      console.error(
        "[memo-purge] storage cleanup failed:",
        id,
        attachmentPaths,
        storageErr.message,
      );
    }
  }

  await supabase
    .from("notifications")
    .delete()
    .eq("reference_type", "office_memo")
    .eq("reference_id", id);

  const { error: deleteErr } = await supabase
    .from("office_memos")
    .delete()
    .eq("id", id);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, numberLabel });
}
