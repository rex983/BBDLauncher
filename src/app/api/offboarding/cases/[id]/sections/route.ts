import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { requireOpenCase } from "@/lib/offboarding/guard";
import { requireOffboarder } from "@/lib/offboarding/service";

const schema = z.object({ name: z.string().trim().min(1).max(100) });

// Removes a section from the case page: the checklist section (and its
// checklist tasks) is deleted so future offboardings don't get it, and this
// case's unfinished tasks in it are removed. Finished tasks are kept as record.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const open = await requireOpenCase(id);
  if (open instanceof NextResponse) return open;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name } = parsed.data;

  const supabase = createAdminClient();
  const { data: tasks } = await supabase
    .from("offboarding_tasks")
    .select("id, title, status")
    .eq("case_id", id)
    .eq("section", name)
    .in("status", ["pending", "in_progress"]);

  const [tasksDel, sectionDel] = await Promise.all([
    tasks?.length
      ? supabase.from("offboarding_tasks").delete().in("id", tasks.map((t) => t.id))
      : Promise.resolve({ error: null }),
    supabase.from("offboarding_sections").delete().eq("name", name),
  ]);
  const failed = tasksDel.error ?? sectionDel.error;
  if (failed) return NextResponse.json({ error: failed.message }, { status: 500 });

  await logOffboardingEvent({
    caseId: id,
    eventType: "section_removed",
    session,
    req,
    details: { section: name, removed: (tasks || []).map((t) => t.title) },
  });
  return NextResponse.json({ ok: true });
}
