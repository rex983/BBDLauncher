import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  notifyIncidentCompleted,
  type IncidentCompletedPayload,
} from "@/lib/slack/notify";
import type { IncidentSeverity } from "@/lib/incidents/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  signature_text: z.string().min(2).max(200),
  acknowledged: z.literal(true),
});

// POST /api/incidents/[id]/sign — employee acknowledges the report. Locks
// the record (status = completed) with the typed name + timestamp + IP + UA
// for audit. Fires the completion Slack notification so HR knows the loop
// is closed.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("incident_reports")
    .select("id, employee_profile_id, title, severity, status")
    .eq("id", id)
    .single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.employee_profile_id !== session.user.profileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (row.status !== "awaiting_employee_sig") {
    return NextResponse.json(
      { error: `Cannot sign in status "${row.status}"` },
      { status: 409 },
    );
  }

  // Typed name must match the employee's on-file name (whitespace-collapsed,
  // case-insensitive). Same policy as the manager sign flow.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.user.profileId)
    .single<{ full_name: string | null }>();
  const expected = (profile?.full_name || "").trim().toLowerCase().replace(/\s+/g, " ");
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

  const { data: updated, error } = await supabase
    .from("incident_reports")
    .update({
      status: "completed",
      employee_signed_at: now,
      employee_signature_text: parsed.data.signature_text.trim(),
      employee_signature_ip: ip,
      employee_signature_ua: ua,
    })
    .eq("id", id)
    .eq("status", "awaiting_employee_sig")
    .select()
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message || "Sign failed" },
      { status: 500 },
    );
  }

  const payload: IncidentCompletedPayload = {
    incidentId: row.id,
    employeeName: profile?.full_name || "Unknown",
    title: row.title,
    severity: row.severity as IncidentSeverity,
  };
  notifyIncidentCompleted(payload).catch(() => undefined);

  return NextResponse.json(updated);
}
