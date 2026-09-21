import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import {
  EMPLOYEE_ACKNOWLEDGEMENT_TEMPLATE,
  formatIncidentNumber,
} from "@/lib/incidents/types";
import { extractActorHeaders, logIncidentEvent } from "@/lib/incidents/audit";
import { hashDocument, hashManagerSignature } from "@/lib/incidents/hashing";
import { createNotification } from "@/lib/notifications/service";
import {
  notifyIncidentSubmitted,
  type IncidentSubmittedPayload,
} from "@/lib/slack/notify";
import type {
  IncidentCategory,
  IncidentSeverity,
} from "@/lib/incidents/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const VALID_OFFICES = new Set(["Harbor", "Marion", "BST", "RnD"]);
const VALID_DEPARTMENTS = new Set(["SALES TEAM", "BST", "RnD"]);

const attachmentSchema = z.object({
  path: z.string().min(1),
  filename: z.string().min(1),
  size: z.number().nonnegative(),
  mime: z.string().min(1),
});

// Manager creates a new incident report. Body carries the AI-generated
// document text (or the manager's edited version) — the /generate endpoint
// produces it separately so drafts can be regenerated without persisting a
// row every time.
const createSchema = z.object({
  employee_profile_id: z.string().uuid(),
  title: z.string().min(3).max(200),
  severity: z.enum(["low", "medium", "high", "critical"]),
  category: z.enum([
    "attendance",
    "performance",
    "conduct",
    "safety",
    "policy",
    "other",
  ]),
  occurred_at: z.string().datetime().nullable().optional(),
  description: z.string().min(10).max(10_000),
  document: z.string().min(10).max(30_000),
  acknowledgement_text: z.string().max(5_000).optional(),
  attachments: z.array(attachmentSchema).max(10).default([]),
});

// GET /api/management/incidents — list incidents visible to the viewer.
// Query params:
//   status         (optional) — comma-separated statuses to include
//   office         (admin overlay) — filter by employee's office
//   department     (admin overlay) — filter by employee's department
export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope } = gate;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("statuses") || url.searchParams.get("status");
  const statuses = statusParam
    ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
    : ["draft", "awaiting_manager_sig", "awaiting_employee_sig", "completed", "cancelled"];

  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  if (officeFilter && !VALID_OFFICES.has(officeFilter)) {
    return NextResponse.json({ error: "Invalid office" }, { status: 400 });
  }
  if (departmentFilter && !VALID_DEPARTMENTS.has(departmentFilter)) {
    return NextResponse.json({ error: "Invalid department" }, { status: 400 });
  }

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department")
    .eq("is_active", true);
  if (scope.department) profileQuery = profileQuery.eq("department", scope.department);
  else if (departmentFilter) profileQuery = profileQuery.eq("department", departmentFilter);
  if (scope.office) profileQuery = profileQuery.eq("office", scope.office);
  else if (officeFilter) profileQuery = profileQuery.eq("office", officeFilter);

  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json([]);

  const { data: reports, error } = await supabase
    .from("incident_reports")
    .select(
      "id, number, employee_profile_id, reporter_profile_id, title, severity, category, status, occurred_at, attachments, manager_signed_at, employee_signed_at, cancelled_at, created_at, updated_at",
    )
    .in("employee_profile_id", profileIds)
    .in("status", statuses)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  return NextResponse.json(
    (reports || []).map((r) => ({
      ...r,
      employee: profileMap.get(r.employee_profile_id) || null,
    })),
  );
}

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const gate = await requireTimeDataAccess(parsed.data.employee_profile_id, "edit");
  if (!gate.ok) return gate.response;
  const { session, supabase } = gate;

  // Prevent managers from filing on themselves — admins can override.
  if (
    parsed.data.employee_profile_id === session.user.profileId &&
    session.user.role !== "admin"
  ) {
    return NextResponse.json(
      { error: "Cannot file an incident report on yourself" },
      { status: 400 },
    );
  }

  // Validate attachment paths are prefixed with the target employee's id —
  // stops a manager smuggling in files uploaded against a different employee.
  for (const a of parsed.data.attachments) {
    if (!a.path.startsWith(`${parsed.data.employee_profile_id}/`)) {
      return NextResponse.json({ error: "Invalid attachment path" }, { status: 400 });
    }
  }

  const acknowledgement =
    parsed.data.acknowledgement_text?.trim() || EMPLOYEE_ACKNOWLEDGEMENT_TEMPLATE;

  // The file action IS the manager's signature — clicking "File & send for
  // signature" while authenticated as the reporter constitutes the manager's
  // intent to sign, identical in evidentiary weight to a click-to-sign
  // flow. Their signature_text is their on-file name; the hash + IP + UA
  // capture matches the two-step sign endpoint exactly so downstream
  // verification treats them the same.
  const { data: reporterProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.user.profileId)
    .single<{ full_name: string | null }>();
  const signatureText = (reporterProfile?.full_name || "").trim();
  if (!signatureText) {
    return NextResponse.json(
      { error: "Missing your name on file — contact an admin before filing." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const { ip, ua } = extractActorHeaders(req);
  const documentHash = hashDocument(parsed.data.document);
  const managerSignatureHash = hashManagerSignature({
    documentHash,
    signatureText,
    signedAt: now,
    ip,
    ua,
  });

  const { data, error } = await supabase
    .from("incident_reports")
    .insert({
      employee_profile_id: parsed.data.employee_profile_id,
      reporter_profile_id: session.user.profileId,
      title: parsed.data.title,
      severity: parsed.data.severity,
      category: parsed.data.category,
      occurred_at: parsed.data.occurred_at ?? null,
      description: parsed.data.description,
      document: parsed.data.document,
      acknowledgement_text: acknowledgement,
      attachments: parsed.data.attachments,
      // Filing == manager signing. Land directly at awaiting_employee_sig
      // with the manager's signature captured, so the employee gets pinged
      // immediately.
      status: "awaiting_employee_sig",
      manager_signed_at: now,
      manager_signature_text: signatureText,
      manager_signature_ip: ip,
      manager_signature_ua: ua,
      document_hash: documentHash,
      manager_signature_hash: managerSignatureHash,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logIncidentEvent({
    incidentReportId: data.id,
    eventType: "filed",
    actorProfileId: session.user.profileId,
    actorIp: ip,
    actorUa: ua,
    details: {
      title: data.title,
      severity: data.severity,
      category: data.category,
      attachment_count: parsed.data.attachments.length,
    },
  }).catch(() => undefined);

  // Second event so the audit trail still shows a distinct signature
  // moment — merged UX doesn't mean merged evidence.
  logIncidentEvent({
    incidentReportId: data.id,
    eventType: "manager_signed",
    actorProfileId: session.user.profileId,
    actorIp: ip,
    actorUa: ua,
    details: {
      signature_text: signatureText,
      document_hash: documentHash,
      manager_signature_hash: managerSignatureHash,
      via: "auto_sign_on_file",
    },
  }).catch(() => undefined);

  // Slack: identical payload to what the separate sign endpoint fires so
  // HR sees the same notification format regardless of which path a report
  // came in on.
  const { data: employeeProfile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", parsed.data.employee_profile_id)
    .single<{ full_name: string | null; email: string | null }>();
  const slackPayload: IncidentSubmittedPayload = {
    incidentId: data.id,
    employeeName: employeeProfile?.full_name || "Unknown",
    employeeEmail: employeeProfile?.email || "",
    reporterName: signatureText,
    title: data.title,
    severity: data.severity as IncidentSeverity,
    category: data.category as IncidentCategory,
    attachmentCount: parsed.data.attachments.length,
  };
  notifyIncidentSubmitted(slackPayload).catch(() => undefined);

  // Employee bell notification — same wording + deep-link as the sign
  // endpoint uses so the two paths are indistinguishable for the recipient.
  const numberLabel = formatIncidentNumber(data.number);
  createNotification({
    userId: data.employee_profile_id,
    type: "incident_report_awaiting",
    title: "BBD management has sent you an incident report.",
    body: numberLabel ? `${numberLabel} · ${data.title}` : data.title,
    href: `/profile?openIncident=${data.id}#incidents`,
    referenceType: "incident_report",
    referenceId: data.id,
  }).catch(() => undefined);

  return NextResponse.json(data, { status: 201 });
}
