import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { salesRepProfiles } from "@/lib/rep-checkins";

// The reps who get check-ins, for the admin "View as" picker in the check-in
// dialog (CheckInPrompt). Admins only.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.profileId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.permRole)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await salesRepProfiles(createAdminClient()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
