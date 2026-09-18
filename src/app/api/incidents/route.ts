import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// GET /api/incidents — list incident reports filed against the current user.
// Drafts and awaiting-manager-sig reports are hidden — an employee shouldn't
// see a report about themselves until the manager has actually signed it.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("incident_reports")
    .select(
      "id, title, severity, category, status, occurred_at, manager_signed_at, employee_signed_at, attachments, created_at, updated_at",
    )
    .eq("employee_profile_id", session.user.profileId)
    .in("status", ["awaiting_employee_sig", "completed"])
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
