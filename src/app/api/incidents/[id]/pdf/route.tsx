import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canViewTimeData,
  isAdmin,
  timeDataScope,
} from "@/lib/auth/permissions";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  IncidentReportPdfDoc,
  type IncidentPdfData,
} from "@/lib/incidents/pdf";
import { formatIncidentNumber } from "@/lib/incidents/types";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// PDF generation can take a few seconds — bump above the default so
// bigger reports don't time out on Vercel.
export const maxDuration = 30;

// GET /api/incidents/[id]/pdf — returns a legal-format PDF of the
// incident report. Access rules:
//   - Subject employee (report is theirs AND status is
//     awaiting_employee_sig or completed) → PDF WITHOUT manager_notes
//   - Admin OR scoped manager-tier viewer → PDF WITH manager_notes
//   - Anyone else → 404
//
// Content-Disposition is `inline` so clicking the link opens the PDF in
// a new tab; the browser's built-in viewer still exposes a download
// button, so users can save to disk from there.
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
  const { data: report, error } = await supabase
    .from("incident_reports")
    .select(
      "id, number, employee_profile_id, reporter_profile_id, title, severity, category, status, occurred_at, document, problem, proposed_solution, manager_notes, acknowledgement_text, attachments, manager_signed_at, manager_signature_text, employee_signed_at, employee_signature_text, document_hash, manager_signature_hash, employee_signature_hash, created_at",
    )
    .eq("id", id)
    .single();
  if (error || !report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const viewerId = session.user.profileId;
  const isSubject = report.employee_profile_id === viewerId;

  // Decide access + whether to include manager_notes.
  let includeManagerNotes = false;
  if (isSubject) {
    if (!["awaiting_employee_sig", "completed"].includes(report.status)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    includeManagerNotes = false;
  } else {
    if (!canViewTimeData(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!isAdmin(session.user.role)) {
      // Manager scope check against the employee this report is about.
      const scope = timeDataScope(
        session.user.role,
        session.user.department,
        session.user.office,
      );
      if (!scope.allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const { data: target } = await supabase
        .from("profiles")
        .select("department, office, is_active")
        .eq("id", report.employee_profile_id)
        .single();
      if (!target) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (target.is_active === false) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (scope.department && target.department !== scope.department) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (scope.office && target.office !== scope.office) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    includeManagerNotes = true;
  }

  // Resolve reporter + employee display names for the header.
  const profileIds = [
    report.employee_profile_id,
    report.reporter_profile_id,
  ].filter((x): x is string => !!x);
  const nameMap = new Map<string, { full_name: string | null; email: string | null }>();
  if (profileIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", profileIds);
    for (const p of profs || []) {
      nameMap.set(p.id, { full_name: p.full_name, email: p.email });
    }
  }
  const employee = nameMap.get(report.employee_profile_id) || null;
  const reporter = report.reporter_profile_id
    ? nameMap.get(report.reporter_profile_id)
    : null;

  const data: IncidentPdfData = {
    number: report.number,
    title: report.title,
    severity: report.severity,
    category: report.category,
    status: report.status,
    occurred_at: report.occurred_at,
    problem: report.problem,
    proposed_solution: report.proposed_solution,
    manager_notes: includeManagerNotes ? report.manager_notes : null,
    document: report.document,
    acknowledgement_text: report.acknowledgement_text,
    attachments: report.attachments,
    manager_signed_at: report.manager_signed_at,
    manager_signature_text: report.manager_signature_text,
    manager_signature_hash: report.manager_signature_hash,
    employee_signed_at: report.employee_signed_at,
    employee_signature_text: report.employee_signature_text,
    employee_signature_hash: report.employee_signature_hash,
    document_hash: report.document_hash,
    created_at: report.created_at,
    reporter_name: reporter?.full_name || null,
    employee_name: employee?.full_name || null,
    employee_email: employee?.email || null,
  };

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(
      <IncidentReportPdfDoc data={data} includeManagerNotes={includeManagerNotes} />,
    );
  } catch (e) {
    // Surface the underlying render error so 500s are diagnosable in
    // Vercel logs rather than being swallowed by Next's generic
    // error page.
    console.error(
      "[incident-pdf] render failed:",
      id,
      e instanceof Error ? e.stack || e.message : e,
    );
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "PDF rendering failed",
      },
      { status: 500 },
    );
  }

  const filename = `Incident-${formatIncidentNumber(report.number).replace("#", "")}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
