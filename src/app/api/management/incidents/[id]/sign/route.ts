import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import {
  notifyIncidentSubmitted,
  type IncidentSubmittedPayload,
} from "@/lib/slack/notify";
import type { IncidentSeverity, IncidentCategory } from "@/lib/incidents/types";
import { hashDocument, hashManagerSignature } from "@/lib/incidents/hashing";
import { createNotification } from "@/lib/notifications/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  // Typed signature — must match the manager's profile name exactly. UI
  // enforces this too, but the server is the authority.
  signature_text: z.string().min(2).max(200),
});

// POST /api/management/incidents/[id]/sign — manager signs the report.
// Only valid from awaiting_manager_sig; flips to awaiting_employee_sig and
// notifies HR via Slack (fire-and-forget).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const gate = await requireTimeDataAccess(null, "edit");
  if (!gate.ok) return gate.response;
  const { session, supabase, scope, viewerIsAdmin } = gate;

  const { data: row } = await supabase
    .from("incident_reports")
    .select(
      "id, employee_profile_id, reporter_profile_id, title, severity, category, status, document, attachments",
    )
    .eq("id", id)
    .single<{
      id: string;
      employee_profile_id: string;
      reporter_profile_id: string | null;
      title: string;
      severity: string;
      category: string;
      status: string;
      document: string;
      attachments: unknown;
    }>();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (row.status !== "awaiting_manager_sig") {
    return NextResponse.json(
      { error: `Cannot sign in status "${row.status}"` },
      { status: 409 },
    );
  }

  // Scope check on the subject employee.
  if (!viewerIsAdmin) {
    const { data: emp } = await supabase
      .from("profiles")
      .select("department, office")
      .eq("id", row.employee_profile_id)
      .single();
    if (!emp) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (scope.department && emp.department !== scope.department) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.office && emp.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  // Sanity check: manager can only sign a report they filed (or admin
  // override). Prevents random managers in the same scope from signing
  // someone else's draft.
  if (
    row.reporter_profile_id !== session.user.profileId &&
    !viewerIsAdmin
  ) {
    return NextResponse.json(
      { error: "Only the reporter can sign this report" },
      { status: 403 },
    );
  }

  // Confirm the typed name matches the manager's on-file full_name. Case-
  // insensitive because employees type "brandyn brumfield" as much as
  // "Brandyn Brumfield" — but whitespace must collapse identically.
  const { data: reporterProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.user.profileId)
    .single<{ full_name: string | null }>();
  const expected = (reporterProfile?.full_name || "").trim().toLowerCase().replace(/\s+/g, " ");
  const provided = parsed.data.signature_text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!expected || provided !== expected) {
    return NextResponse.json(
      { error: "Signature must match your full name on file" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent")?.slice(0, 512) || null;
  const signatureText = parsed.data.signature_text.trim();

  // Freeze the document at manager-sign time by hashing it. The employee
  // sign endpoint recomputes this same hash from the row's document to
  // verify no one edited the body between signatures.
  const documentHash = hashDocument(row.document);
  const managerSignatureHash = hashManagerSignature({
    documentHash,
    signatureText,
    signedAt: now,
    ip,
    ua,
  });

  const { data: updated, error } = await supabase
    .from("incident_reports")
    .update({
      status: "awaiting_employee_sig",
      manager_signed_at: now,
      manager_signature_text: signatureText,
      manager_signature_ip: ip,
      manager_signature_ua: ua,
      document_hash: documentHash,
      manager_signature_hash: managerSignatureHash,
    })
    .eq("id", id)
    .eq("status", "awaiting_manager_sig") // guard race
    .select()
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message || "Sign failed" },
      { status: 500 },
    );
  }

  // Notify HR channel. Fire-and-forget — if slack is down or the webhook is
  // misconfigured, the sign action still succeeds.
  const { data: employee } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", row.employee_profile_id)
    .single<{ full_name: string | null; email: string | null }>();
  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  const payload: IncidentSubmittedPayload = {
    incidentId: row.id,
    employeeName: employee?.full_name || "Unknown",
    employeeEmail: employee?.email || "",
    reporterName: reporterProfile?.full_name || "Unknown",
    title: row.title,
    severity: row.severity as IncidentSeverity,
    category: row.category as IncidentCategory,
    attachmentCount: attachments.length,
  };
  notifyIncidentSubmitted(payload).catch(() => undefined);

  // In-app bell: the employee sees "New incident report awaiting your
  // signature" the moment we return here — the notifications realtime
  // subscription on their session pushes it into the header immediately.
  // Href points at their profile page's incidents section (see /profile).
  createNotification({
    userId: row.employee_profile_id,
    type: "incident_report_awaiting",
    title: "New incident report awaiting your signature",
    body: row.title,
    href: `/profile#incidents`,
    referenceType: "incident_report",
    referenceId: row.id,
  }).catch(() => undefined);

  return NextResponse.json(updated);
}
