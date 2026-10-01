import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { getCaseDetail, requireOffboarder } from "@/lib/offboarding/service";
import { OFFBOARDING_REASON_VALUES } from "@/lib/offboarding/types";

const updateSchema = z.object({
  last_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.enum(OFFBOARDING_REASON_VALUES).optional(),
  notes: z.string().max(4000).nullable().optional(),
  status: z.enum(["open", "completed", "cancelled"]).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const detail = await getCaseDetail(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: current } = await supabase
    .from("offboarding_cases")
    .select("status, last_day, reason, notes")
    .eq("id", id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { status, ...fields } = parsed.data;
  const updates: Record<string, unknown> = {};
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const next = field === "notes" ? (value as string | null)?.trim() || null : value;
    if (next !== current[field as keyof typeof current]) {
      updates[field] = next;
      changes.push({ field, from: current[field as keyof typeof current], to: next });
    }
  }

  let eventType: string | null = changes.length ? "case_updated" : null;
  if (status && status !== current.status) {
    if (status === "completed") {
      const { count } = await supabase
        .from("offboarding_tasks")
        .select("id", { count: "exact", head: true })
        .eq("case_id", id)
        .eq("status", "pending");
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: `${count} task(s) are still pending. Finish them or mark them N/A first.` },
          { status: 400 },
        );
      }
    }
    updates.status = status;
    const closing = status !== "open";
    updates.closed_at = closing ? new Date().toISOString() : null;
    updates.closed_by = closing ? session.user.profileId : null;
    eventType = status === "open" ? "case_reopened" : `case_${status}`;
  }

  if (!eventType) return NextResponse.json({ ok: true });

  const { error } = await supabase.from("offboarding_cases").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logOffboardingEvent({
    caseId: id,
    eventType,
    session,
    req,
    details: changes.length ? { changes } : undefined,
  });
  return NextResponse.json({ ok: true });
}
