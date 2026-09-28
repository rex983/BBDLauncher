import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { NextResponse } from "next/server";

// Public to any signed-in launcher user. Returns the currently active quote
// (or null if none is active). Used by the dashboard banner.
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("launcher_motivational_quotes")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
