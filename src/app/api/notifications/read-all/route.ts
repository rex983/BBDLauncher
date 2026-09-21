import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// POST /api/notifications/read-all — flip every unread, non-dismissed
// notification for the current user to read. Powers the "Mark all read"
// button in the bell dropdown.
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.user.profileId)
    .is("read_at", null)
    .is("dismissed_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
