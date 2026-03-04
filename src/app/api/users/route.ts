import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, avatar_url, created_at, updated_at")
    .order("email");

  return NextResponse.json(users || []);
}
