import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Unread bell-badge count. Polled/refetched from the bell hook on any
// realtime signal from the notifications table. Kept a separate endpoint
// (rather than deriving from the list) so we can eventually cache it if
// notification volume warrants.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ count: 0 });
  }

  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.user.profileId)
    .is("dismissed_at", null)
    .is("read_at", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 });
}
