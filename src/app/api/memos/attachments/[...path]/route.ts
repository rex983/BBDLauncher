import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, isAdmin } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";

const BUCKET = "office-memo-attachments";

// GET /api/memos/attachments/{authorProfileId}/{uuid}-{filename}
// Resolves to a short-lived signed URL and redirects. Access rules:
//   1. Admins bypass
//   2. Author of the attachment (uploader = the profileId prefix)
//   3. Any recipient of a memo referencing this attachment
//   4. Any manager-tier user whose scope covers a memo referencing it
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  if (!path || path.length < 2) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const [authorId, ...rest] = path;
  const objectPath = [authorId, ...rest].join("/");

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const admin = isAdmin(session.user.role);
  const isAuthor = session.user.profileId === authorId;

  let allowed = admin || isAuthor;

  if (!allowed) {
    // Attachments are uploaded per-author (see POST), so any memo
    // referencing this object was authored by `authorId`. Filter the
    // scan to that author's memos, then look for a matching path.
    const { data: candidateMemos } = await supabase
      .from("office_memos")
      .select("id, audience_scope, audience_office, audience_department, attachments, status")
      .eq("author_profile_id", authorId)
      .eq("status", "published");
    const referencingMemos = (candidateMemos || []).filter((m) => {
      const arr = Array.isArray(m.attachments) ? m.attachments : [];
      return arr.some((a: { path?: string }) => a?.path === objectPath);
    });

    if (referencingMemos.length > 0) {
      const memoIds = referencingMemos.map((m) => m.id);
      const { data: recipRow } = await supabase
        .from("office_memo_recipients")
        .select("id")
        .eq("profile_id", session.user.profileId)
        .in("memo_id", memoIds)
        .limit(1);
      if (recipRow && recipRow.length > 0) allowed = true;

      if (!allowed && canViewTimeData(session.user.role)) {
        allowed = referencingMemos.some(
          (m) =>
            m.audience_scope === "company" ||
            (m.audience_scope === "office" && m.audience_office === session.user.office) ||
            (m.audience_scope === "department" && m.audience_department === session.user.department),
        );
      }
    }
  }

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, 60);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, 302);
}
