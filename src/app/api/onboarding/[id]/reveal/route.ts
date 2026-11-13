import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPassword } from "@/lib/onboarding/crypto";
import { getRequest, requireOnboardingUser } from "@/lib/onboarding/service";

// Show the saved login: the manager who opened the request and admins, as
// often as they like, open or closed. The password stays stored (encrypted)
// until the request is deleted. The manager's views are stamped so the list
// can show "Login ready" until they've looked.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const current = await getRequest(session, id);
  if (!current || current.role === "assignee") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("onboarding_requests")
    .select("created_by, account_email, password_cipher")
    .eq("id", id)
    .maybeSingle();
  if (!row?.password_cipher) return NextResponse.json({ error: "No password is saved." }, { status: 404 });

  if (row.created_by === session.user.profileId) {
    await supabase.from("onboarding_requests").update({ password_viewed_at: new Date().toISOString() }).eq("id", id);
  }
  return NextResponse.json(
    { account_email: row.account_email, password: decryptPassword(row.password_cipher) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
