import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { requireOpenCase } from "@/lib/offboarding/guard";
import { listOffboarders, notifyAssignee, requireOffboarder } from "@/lib/offboarding/service";
import { TASK_STATUSES } from "@/lib/offboarding/types";

const updateSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  note: z.string().max(4000).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
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
    .select("id, title, status, note, assigned_to, requires_note, auto_action")
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

  if (parsed.data.assigned_to !== undefined && parsed.data.assigned_to !== task.assigned_to) {
    if (parsed.data.assigned_to) {
      const allowed = await listOffboarders();
      if (!allowed.some((p) => p.id === parsed.data.assigned_to)) {
        return NextResponse.json(
          { error: "Tasks can only be assigned to admins or IT users." },
          { status: 400 },
        );
      }
    }
    updates.assigned_to = parsed.data.assigned_to;
    events.push({ type: "task_assigned", details: { from: task.assigned_to, to: parsed.data.assigned_to } });
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

  if (updates.assigned_to && updates.assigned_to !== session.user.profileId) {
    notifyAssignee({
      assigneeId: updates.assigned_to as string,
      caseId: id,
      employeeLabel: open.employee_name || open.employee_email,
      taskTitle: task.title,
    }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
