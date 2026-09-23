import {
  requireTimeDataAccess,
  requireTimeDataAccessWithProfile,
} from "@/lib/auth/scope-check";
import { TIME_OFF_SUBCATEGORIES } from "@/lib/timeoff/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Decide payload — approve or deny a pending request.
const decideSchema = z.object({
  status: z.enum(["approved", "denied"]),
  decided_note: z.string().optional(),
});

// Edit payload — a manager updates the request's fields in-place. Any
// subset may be provided; omitted fields are left as-is. Status flips
// via decideSchema, not here.
const editSchema = z.object({
  type: z.enum(["vacation", "sick", "personal", "parental", "other"]).optional(),
  subcategory: z.string().max(64).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  full_day: z.boolean().optional(),
  hours: z.number().positive().max(24).nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
});

// Scope + row-fetch helper shared by PATCH and DELETE. Two-phase gate:
// (1) session/role check via requireTimeDataAccess so we have an admin
// client, (2) load the request row to learn its profile_id, (3) re-gate
// through requireTimeDataAccessWithProfile so the scope check on that
// target is contractual and shared with the rest of the time-off routes.
async function loadRowWithScope(id: string) {
  const initial = await requireTimeDataAccess(null, "edit");
  if (!initial.ok) return { fail: initial.response };

  // Split fetch to avoid the ambiguous profiles!inner(...) join — the table
  // has two FKs to profiles (profile_id and decided_by).
  const { data: reqRow } = await initial.supabase
    .from("time_off_requests")
    .select("profile_id, status")
    .eq("id", id)
    .single<{ profile_id: string; status: string }>();
  if (!reqRow) {
    return { fail: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const gate = await requireTimeDataAccessWithProfile<{
    department: string | null;
    office: string | null;
    is_active: boolean;
  }>(reqRow.profile_id, "edit", "department, office, is_active");
  if (!gate.ok) return { fail: gate.response };

  return { row: reqRow, gate };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await req.json();

  // Route on payload shape: if the client sent a `status`, it's a decide;
  // otherwise it's a field-level edit.
  const isDecide = body && typeof body === "object" && "status" in body;

  const scopeResult = await loadRowWithScope(id);
  if ("fail" in scopeResult) return scopeResult.fail;
  const { row: reqRow, gate } = scopeResult;
  const { session, supabase, viewerIsAdmin } = gate;

  if (isDecide) {
    const parsed = decideSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    if (reqRow.status !== "pending") {
      return NextResponse.json({ error: "Already decided" }, { status: 409 });
    }
    // Segregation of duties: manager-tier users can't approve or deny
    // their own request. Admins may (they might be the only signer with
    // scope over themselves).
    if (!viewerIsAdmin && reqRow.profile_id === session.user.profileId) {
      return NextResponse.json(
        { error: "You cannot decide your own time-off request" },
        { status: 403 },
      );
    }

    const { data, error } = await supabase
      .from("time_off_requests")
      .update({
        status: parsed.data.status,
        decided_by: session.user.profileId,
        decided_at: new Date().toISOString(),
        decided_note: parsed.data.decided_note ?? null,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Field edit path.
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const edits = parsed.data;

  // Validate cross-field invariants when the relevant fields are touched.
  // Only the final composite matters, so pull effective start/end/type.
  const effectiveStart = edits.start_date ?? undefined;
  const effectiveEnd = edits.end_date ?? undefined;
  if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
    return NextResponse.json(
      { error: "End date must be on or after start date" },
      { status: 400 },
    );
  }
  if (edits.full_day === false && edits.hours == null) {
    return NextResponse.json(
      { error: "Hours required for partial-day requests" },
      { status: 400 },
    );
  }

  // Subcategory must belong to the (possibly new) type. If the type isn't
  // being changed, we can't validate against the old type without a
  // re-read; fetch it lazily only when needed.
  if (edits.subcategory) {
    let effectiveType = edits.type;
    if (!effectiveType) {
      const { data: current } = await supabase
        .from("time_off_requests")
        .select("type")
        .eq("id", id)
        .single<{ type: keyof typeof TIME_OFF_SUBCATEGORIES }>();
      effectiveType = current?.type;
    }
    if (effectiveType) {
      const allowed = TIME_OFF_SUBCATEGORIES[effectiveType];
      if (!allowed.includes(edits.subcategory)) {
        return NextResponse.json(
          { error: `Invalid subcategory for ${effectiveType}` },
          { status: 400 },
        );
      }
    }
  }

  // Assemble the update object with only fields the client actually sent.
  const update: Record<string, unknown> = {};
  if ("type" in edits) update.type = edits.type;
  if ("subcategory" in edits) update.subcategory = edits.subcategory ?? null;
  if ("start_date" in edits) update.start_date = edits.start_date;
  if ("end_date" in edits) update.end_date = edits.end_date;
  if ("full_day" in edits) update.full_day = edits.full_day;
  if ("hours" in edits) update.hours = edits.hours ?? null;
  if ("reason" in edits) update.reason = edits.reason ?? null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("time_off_requests")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// Hard delete. Available to admins and to managers within their scope.
// Owners can already cancel their own pending requests via
// /api/timeoff/[id] — this endpoint is the manager-side counterpart.
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const scopeResult = await loadRowWithScope(id);
  if ("fail" in scopeResult) return scopeResult.fail;
  const { supabase } = scopeResult.gate;

  const { error } = await supabase
    .from("time_off_requests")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
