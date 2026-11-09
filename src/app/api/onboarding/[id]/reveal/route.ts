import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPassword } from "@/lib/onboarding/crypto";
import { requireOnboardingUser } from "@/lib/onboarding/service";

const GONE = "The password was already viewed, so it's gone.";

// One-time view: only the manager who opened the request, and only once.
// The cipher is wiped in the same compare-and-swap that hands it out, so
// two tabs can't both get it and nothing is left stored afterwards.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("onboarding_requests")
    .select("created_by, account_email, password_cipher")
    .eq("id", id)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!row || row.created_by !== session.user.profileId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!row.password_cipher) return NextResponse.json({ error: GONE }, { status: 410 });

  const { data: claimed, error } = await supabase
    .from("onboarding_requests")
    .update({ password_cipher: null, password_viewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("password_cipher", row.password_cipher)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!claimed?.length) return NextResponse.json({ error: GONE }, { status: 410 });

  return NextResponse.json(
    { account_email: row.account_email, password: decryptPassword(row.password_cipher) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
