import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import {
  EVENT_LABEL,
  extractActorHeaders,
  logIncidentEvent,
  type FieldChange,
} from "@/lib/incidents/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// GET one report with full body + signatures + activity timeline. Scope-
// gated on the subject employee — same access rules as list, plus the
// incident row must belong to someone the viewer can see.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope, viewerIsAdmin } = gate;

  const { data: row, error } = await supabase
    .from("incident_reports")
    .select(
      "id, number, employee_profile_id, reporter_profile_id, title, severity, category, status, occurred_at, description, document, acknowledgement_text, attachments, manager_signed_at, manager_signature_text, employee_signed_at, employee_signature_text, document_hash, manager_signature_hash, employee_signature_hash, cancelled_at, cancelled_reason, created_at, updated_at",
    )
    .eq("id", id)
    .single();
  if (error || !row) {
    return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  }

  if (!viewerIsAdmin) {
    const { data: emp } = await supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", row.employee_profile_id)
      .single();
    if (!emp) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (emp.is_active === false) return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    if (scope.department && emp.department !== scope.department) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.office && emp.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  // Profile blurbs for reporter + employee + all event actors in one round trip.
  const { data: events } = await supabase
    .from("incident_report_events")
    .select("id, event_type, actor_profile_id, actor_ip, actor_ua, details, created_at")
    .eq("incident_report_id", row.id)
    .order("created_at", { ascending: true });

  const actorIds = new Set<string>();
  if (row.reporter_profile_id) actorIds.add(row.reporter_profile_id);
  actorIds.add(row.employee_profile_id);
  for (const e of events || []) {
    if (e.actor_profile_id) actorIds.add(e.actor_profile_id as string);
  }
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department")
    .in("id", Array.from(actorIds));
  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));

  return NextResponse.json({
    ...row,
    employee: profileMap.get(row.employee_profile_id) || null,
    reporter: row.reporter_profile_id
      ? profileMap.get(row.reporter_profile_id) || null
      : null,
    events: (events || []).map((e) => ({
      ...e,
      event_label: EVENT_LABEL[e.event_type as keyof typeof EVENT_LABEL] ?? e.event_type,
      actor: e.actor_profile_id ? profileMap.get(e.actor_profile_id as string) || null : null,
    })),
  });
}

const editSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  category: z
    .enum(["attendance", "performance", "conduct", "safety", "policy", "other"])
    .optional(),
  document: z.string().min(10).max(30_000).optional(),
  acknowledgement_text: z.string().max(5_000).optional(),
});

// PATCH — edit an incident report.
//
//   * Managers can edit only while status is draft OR awaiting_manager_sig.
//   * Admins can also edit once the report is signed. When an admin edits
//     a signed row (awaiting_employee_sig / completed), we invalidate every
//     signature + hash on the row and roll the status back to
//     awaiting_manager_sig — substantive edits require re-signing. The
//     event is written to the audit log with type "admin_override_edit"
//     so HR can see later who touched what and when.
//   * Cancelled rows can't be edited (uncancel first via a separate flow —
//     not implemented; this is on purpose to keep terminal states terminal).
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const parsed = editSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const gate = await requireTimeDataAccess(null, "edit");
  if (!gate.ok) return gate.response;
  const { session, supabase, scope, viewerIsAdmin } = gate;

  const { data: existing } = await supabase
    .from("incident_reports")
    .select(
      "id, employee_profile_id, status, title, severity, category, document, acknowledgement_text, manager_signed_at, employee_signed_at",
    )
    .eq("id", id)
    .single<{
      id: string;
      employee_profile_id: string;
      status: string;
      title: string;
      severity: string;
      category: string;
      document: string;
      acknowledgement_text: string;
      manager_signed_at: string | null;
      employee_signed_at: string | null;
    }>();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!viewerIsAdmin) {
    const { data: emp } = await supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", existing.employee_profile_id)
      .single();
    if (!emp) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (emp.is_active === false) return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    if (scope.department && emp.department !== scope.department) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.office && emp.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  if (existing.status === "cancelled") {
    return NextResponse.json(
      { error: "Cannot edit a cancelled report" },
      { status: 409 },
    );
  }

  const preSigning =
    existing.status === "draft" || existing.status === "awaiting_manager_sig";
  const isAdminOverride = !preSigning;
  if (isAdminOverride && !viewerIsAdmin) {
    return NextResponse.json(
      { error: "Cannot edit a report after signing has begun" },
      { status: 409 },
    );
  }

  // Diff the incoming values against the current row so the audit log shows
  // exactly what changed. Fields absent from the request stay untouched.
  const changes: FieldChange[] = [];
  const update: Record<string, unknown> = {};
  const fields = [
    ["title", parsed.data.title],
    ["severity", parsed.data.severity],
    ["category", parsed.data.category],
    ["document", parsed.data.document],
    ["acknowledgement_text", parsed.data.acknowledgement_text],
  ] as const;
  for (const [field, incoming] of fields) {
    if (incoming === undefined) continue;
    const current = existing[field as keyof typeof existing] as string;
    if (incoming === current) continue;
    update[field] = incoming;
    changes.push({ field, from: current, to: incoming });
  }
  if (changes.length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  // Admin override on a signed report — nuke both signature blocks + hashes
  // and roll the status back to awaiting_manager_sig. The manager now needs
  // to re-sign; if it was already awaiting_employee_sig, the pending
  // notification stays in place (the employee will get a fresh one after
  // re-signing).
  if (isAdminOverride) {
    update.status = "awaiting_manager_sig";
    update.document_hash = null;
    update.manager_signed_at = null;
    update.manager_signature_text = null;
    update.manager_signature_ip = null;
    update.manager_signature_ua = null;
    update.manager_signature_hash = null;
    update.employee_signed_at = null;
    update.employee_signature_text = null;
    update.employee_signature_ip = null;
    update.employee_signature_ua = null;
    update.employee_signature_hash = null;
  }

  const { data, error } = await supabase
    .from("incident_reports")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { ip, ua } = extractActorHeaders(req);
  logIncidentEvent({
    incidentReportId: id,
    eventType: isAdminOverride ? "admin_override_edit" : "edited",
    actorProfileId: session.user.profileId,
    actorIp: ip,
    actorUa: ua,
    details: {
      previous_status: existing.status,
      changes,
      signatures_reset: isAdminOverride,
    },
  }).catch(() => undefined);

  return NextResponse.json(data);
}

// DELETE — soft-cancel. The row stays for audit history; status flips to
// 'cancelled' with a timestamp + who did it. Admins can cancel completed
// reports as an override (logged separately). Managers can only cancel
// while the report is still in flight.
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const reason = url.searchParams.get("reason")?.slice(0, 500) || null;

  const gate = await requireTimeDataAccess(null, "edit");
  if (!gate.ok) return gate.response;
  const { session, supabase, scope, viewerIsAdmin } = gate;

  const { data: existing } = await supabase
    .from("incident_reports")
    .select("id, employee_profile_id, status")
    .eq("id", id)
    .single();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!viewerIsAdmin) {
    const { data: emp } = await supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", existing.employee_profile_id)
      .single();
    if (!emp) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (scope.department && emp.department !== scope.department) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.office && emp.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  if (existing.status === "completed" && !viewerIsAdmin) {
    return NextResponse.json(
      { error: "Only admins can cancel a completed incident report" },
      { status: 409 },
    );
  }
  if (existing.status === "cancelled") {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  const isAdminOverride = existing.status === "completed";

  const { error } = await supabase
    .from("incident_reports")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: session.user.profileId,
      cancelled_reason: reason,
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { ip, ua } = extractActorHeaders(req);
  logIncidentEvent({
    incidentReportId: id,
    eventType: isAdminOverride ? "admin_override_delete" : "cancelled",
    actorProfileId: session.user.profileId,
    actorIp: ip,
    actorUa: ua,
    details: {
      previous_status: existing.status,
      reason: reason ?? undefined,
    },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
