import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { requireOpenCase } from "@/lib/offboarding/guard";
import { requireOffboarder } from "@/lib/offboarding/service";
import { TASK_STATUSES } from "@/lib/offboarding/types";

const updateSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  note: z.string().max(4000).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id, taskId } = await params;

  const open = await requireOpenCase(id);
  if (open instanceof NextResponse) return open;

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: task } = await supabase
    .from("offboarding_tasks")
    .select("id, title, status, note, requires_note, auto_action")
    .eq("id", taskId)
    .eq("case_id", id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  const events: Array<{ type: string; details?: Record<string, unknown> }> = [];

  const note = parsed.data.note !== undefined ? parsed.data.note?.trim() || null : task.note;
  if (note !== task.note) {
    updates.note = note;
    events.push({ type: "task_note", details: { note } });
  }

  const status = parsed.data.status;
  if (status && status !== task.status) {
    if (status === "done" && task.auto_action) {
      return NextResponse.json(
        { error: "Use the action button on this task — it completes itself when it runs." },
        { status: 400 },
      );
    }
    // Backup / rotation tasks must say WHERE the data went or WHAT changed.
    if (status !== "pending" && task.requires_note && !note) {
      return NextResponse.json(
        { error: "This task needs a note (e.g. where the backup was saved) before it can be closed." },
        { status: 400 },
      );
    }
    updates.status = status;
    updates.completed_by = status === "pending" ? null : session.user.profileId;
    updates.completed_at = status === "pending" ? null : new Date().toISOString();
    events.push({ type: status === "pending" ? "task_reopened" : `task_${status}` });
  }

  if (events.length === 0) return NextResponse.json({ ok: true });

  const { error } = await supabase.from("offboarding_tasks").update(updates).eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const e of events) {
    await logOffboardingEvent({
      caseId: id,
      taskId,
      eventType: e.type,
      session,
      req,
      details: { task: task.title, ...e.details },
    });
  }

  return NextResponse.json({ ok: true });
}

// Remove a task from this case. The log keeps a "Deleted task" row with its
// title, so the record still shows it existed.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id, taskId } = await params;

  const open = await requireOpenCase(id);
  if (open instanceof NextResponse) return open;

  const supabase = createAdminClient();
  const { data: task } = await supabase
    .from("offboarding_tasks")
    .select("id, title, section, status")
    .eq("id", taskId)
    .eq("case_id", id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabase.from("offboarding_tasks").delete().eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logOffboardingEvent({
    caseId: id,
    eventType: "task_deleted",
    session,
    req,
    details: { task: task.title, section: task.section, status: task.status },
  });
  return NextResponse.json({ ok: true });
}
