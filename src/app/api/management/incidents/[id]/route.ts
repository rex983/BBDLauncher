import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// GET one report with full body + signatures. Scope-gated on the subject
// employee — same access rules as list, plus the incident row must belong
// to someone the viewer can see.
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
      "id, employee_profile_id, reporter_profile_id, title, severity, category, status, occurred_at, description, document, acknowledgement_text, attachments, manager_signed_at, manager_signature_text, employee_signed_at, employee_signature_text, cancelled_at, cancelled_reason, created_at, updated_at",
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

  // Fetch profile blurbs for the reporter + employee in one hit.
  const ids = [row.employee_profile_id, row.reporter_profile_id].filter(
    (v): v is string => !!v,
  );
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department")
    .in("id", ids);
  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));

  return NextResponse.json({
    ...row,
    employee: profileMap.get(row.employee_profile_id) || null,
    reporter: row.reporter_profile_id
      ? profileMap.get(row.reporter_profile_id) || null
      : null,
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

// PATCH — edit an unsigned draft. Once the manager signs, the doc is locked
// (any material edit would invalidate the signatures) so we hard-reject.
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
  const { supabase, scope, viewerIsAdmin } = gate;

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
    if (emp.is_active === false) return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    if (scope.department && emp.department !== scope.department) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.office && emp.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  // A signed document is legally frozen — edits would invalidate the
  // signatures. Cancel + refile is the correct remedy.
  if (
    existing.status !== "draft" &&
    existing.status !== "awaiting_manager_sig"
  ) {
    return NextResponse.json(
      { error: "Cannot edit a report after signing has begun" },
      { status: 409 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.severity !== undefined) update.severity = parsed.data.severity;
  if (parsed.data.category !== undefined) update.category = parsed.data.category;
  if (parsed.data.document !== undefined) update.document = parsed.data.document;
  if (parsed.data.acknowledgement_text !== undefined) {
    update.acknowledgement_text = parsed.data.acknowledgement_text;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("incident_reports")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE — soft-cancel. The row stays for audit history; status flips to
// 'cancelled' with a timestamp + who did it. Only pre-completion reports
// can be cancelled; a fully signed record is permanent.
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

  if (existing.status === "completed") {
    return NextResponse.json(
      { error: "Cannot cancel a completed incident report" },
      { status: 409 },
    );
  }
  if (existing.status === "cancelled") {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

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
  return NextResponse.json({ ok: true });
}
