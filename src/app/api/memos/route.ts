import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMemosForEmployee } from "@/lib/memos/queries";
import { NextResponse } from "next/server";

// GET /api/memos — employee's memo list. Only memos where the caller is
// a recipient AND the memo is published (drafts show only to their
// author via /api/management/memos, never here). Single embedded-select
// query — see src/lib/memos/queries.ts.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const rows = await listMemosForEmployee({
    supabase,
    profileId: session.user.profileId,
  });
  return NextResponse.json(rows);
}
