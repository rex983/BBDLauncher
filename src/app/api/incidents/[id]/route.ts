import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
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
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("incident_reports")
    .select(
      // NOTE: manager_notes is intentionally omitted — it's the private
      // section employees must never see. Adding it here would leak
      // through the /api/incidents/[id] response.
      // The reporter's display name rides along so the employee can see who
      // signed it. No other reporter info exposed.
      "id, number, employee_profile_id, reporter_profile_id, title, severity, category, status, occurred_at, document, problem, proposed_solution, acknowledgement_text, attachments, manager_signed_at, manager_signature_text, employee_signed_at, employee_signature_text, document_hash, manager_signature_hash, employee_signature_hash, created_at, reporter:profiles!reporter_profile_id(full_name)",
    )
    .eq("id", id)
    .eq("employee_profile_id", session.user.profileId)
    .in("status", ["awaiting_employee_sig", "completed"])
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { reporter, ...report } = data as typeof data & {
    reporter: { full_name: string | null } | null;
  };
  return NextResponse.json({
    ...report,
    reporter_name: reporter?.full_name || null,
  });
}
