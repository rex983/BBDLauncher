import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// GET /api/memos — employee's memo list. Only memos where the caller is
// a recipient AND the memo is published (drafts show only to their
// author via /api/management/memos, never here).
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: recips, error } = await supabase
    .from("office_memo_recipients")
    .select("id, memo_id, delivered_at, read_at, acknowledged_at")
    .eq("profile_id", session.user.profileId)
    .order("delivered_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!recips || recips.length === 0) return NextResponse.json([]);

  const memoIds = recips.map((r) => r.memo_id);
  const { data: memos } = await supabase
    .from("office_memos")
    .select(
      "id, number, title, category, priority, acknowledgement_mode, effective_date, published_at, author_profile_id",
    )
    .in("id", memoIds)
    .eq("status", "published");

  const authorIds = Array.from(
    new Set(
      (memos || [])
        .map((m) => m.author_profile_id)
        .filter((id): id is string => !!id),
    ),
  );
  const authorMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: authors } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    for (const a of authors || []) authorMap.set(a.id, a.full_name || "");
  }

  const memoMap = new Map((memos || []).map((m) => [m.id, m]));
  return NextResponse.json(
    recips
      .filter((r) => memoMap.has(r.memo_id))
      .map((r) => {
        const memo = memoMap.get(r.memo_id)!;
        return {
          recipient_id: r.id,
          memo_id: r.memo_id,
          delivered_at: r.delivered_at,
          read_at: r.read_at,
          acknowledged_at: r.acknowledged_at,
          number: memo.number,
          title: memo.title,
          category: memo.category,
          priority: memo.priority,
          acknowledgement_mode: memo.acknowledgement_mode,
          effective_date: memo.effective_date,
          published_at: memo.published_at,
          author_name: memo.author_profile_id
            ? authorMap.get(memo.author_profile_id) || null
            : null,
        };
      }),
  );
}
