import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/permissions";
import { formatIncidentNumber } from "@/lib/incidents/types";
import { notifyIncidentPurged } from "@/lib/slack/notify";
import { NextRequest, NextResponse } from "next/server";

// POST /api/management/incidents/[id]/purge — HARD delete an incident
// report. Admin only. This is the escape hatch for records that need to
// be scrubbed entirely (accidental duplicates, PII cleanup, retention
// policy). Distinct from the DELETE endpoint which sets status='cancelled'
// (soft delete for audit purposes).
//
// Flow:
//   1. Verify admin
//   2. Snapshot the row + attachment paths for the Slack notification
//   3. Fire Slack alert with the snapshot (only audit trail that survives)
//   4. Delete storage attachments
//   5. Delete pending bell notifications pointing at this incident
//   6. Delete the row (event log cascades via FK)
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = createAdminClient();

  const { data: report, error: fetchErr } = await supabase
    .from("incident_reports")
    .select(
      "id, number, employee_profile_id, reporter_profile_id, title, severity, status, attachments, created_at",
    )
    .eq("id", id)
    .single();
  if (fetchErr || !report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch subject employee's name for the Slack payload — after the row
  // is gone this is the only trace of what was there.
  const { data: employee } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", report.employee_profile_id)
    .single();

  const numberLabel = formatIncidentNumber(report.number);
  const attachmentPaths = Array.isArray(report.attachments)
    ? (report.attachments as { path: string }[]).map((a) => a.path).filter(Boolean)
    : [];

  // Slack first — even if the delete fails partway, at least the
  // notification landed so admins know an attempt was made.
  notifyIncidentPurged({
    numberLabel,
    title: report.title,
    employeeName: employee?.full_name || null,
    employeeEmail: employee?.email || null,
    actorName: session.user.name || session.user.email || "Unknown admin",
    attachmentCount: attachmentPaths.length,
    createdAt: report.created_at,
    priorStatus: report.status,
  }).catch(() => undefined);

  // Storage: remove the actual files. If this fails we log + proceed —
  // orphaned files in the bucket are the lesser evil vs. leaving the
  // row around with a partially-successful purge.
  if (attachmentPaths.length > 0) {
    const { error: storageErr } = await supabase.storage
      .from("incident-attachments")
      .remove(attachmentPaths);
    if (storageErr) {
      console.error(
        "[incident-purge] storage cleanup failed:",
        id,
        attachmentPaths,
        storageErr.message,
      );
    }
  }

  // Kill any pending bell notifications so clicks don't 404.
  await supabase
    .from("notifications")
    .delete()
    .eq("reference_type", "incident_report")
    .eq("reference_id", id);

  // Hard delete the row. incident_report_events cascade via FK.
  const { error: deleteErr } = await supabase
    .from("incident_reports")
    .delete()
    .eq("id", id);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, numberLabel });
}
