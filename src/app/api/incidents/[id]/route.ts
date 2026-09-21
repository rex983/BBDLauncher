import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

// GET /api/incidents/[id] — single incident report, subject employee only.
// Same visibility gate as the list: hidden until awaiting_employee_sig.
// Returns the full document text so the employee can read the whole thing
// before signing.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("incident_reports")
    .select(
      // NOTE: manager_notes is intentionally omitted — it's the private
      // section employees must never see. Adding it here would leak
      // through the /api/incidents/[id] response.
      "id, number, employee_profile_id, reporter_profile_id, title, severity, category, status, occurred_at, document, problem, proposed_solution, acknowledgement_text, attachments, manager_signed_at, manager_signature_text, employee_signed_at, employee_signature_text, document_hash, manager_signature_hash, employee_signature_hash, created_at",
    )
    .eq("id", id)
    .eq("employee_profile_id", session.user.profileId)
    .in("status", ["awaiting_employee_sig", "completed"])
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Also return the reporter's display name so the employee can see who
  // signed it. No other reporter info exposed.
  const { data: reporter } = await supabase
    .from("profiles")
    .select("name:full_name")
    .eq("id", data.reporter_profile_id)
    .single();

  return NextResponse.json({
    ...data,
    reporter_name: reporter?.name || null,
  });
}
