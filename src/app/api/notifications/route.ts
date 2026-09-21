import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

// GET /api/notifications — return the current user's non-dismissed
// notifications, newest first. Optional ?unread=1 restricts to unread only
// so the bell dropdown can render a filtered view without a second call.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 200);

  const supabase = createAdminClient();
  let query = supabase
    .from("notifications")
    .select(
      "id, type, title, body, href, reference_type, reference_id, metadata, read_at, created_at",
    )
    .eq("user_id", session.user.profileId)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreadOnly) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
