import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { requireOpenCase } from "@/lib/offboarding/guard";
import { requireOffboarder, saveCaseLayout } from "@/lib/offboarding/service";

const schema = z.object({
  sections: z.array(z.string().trim().min(1).max(100)).max(200),
  tasks: z.array(z.object({ id: z.string().uuid(), section: z.string().trim().min(1).max(100) })).max(2000),
});

// Saves a drag on the case page (and mirrors it to the checklist).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const open = await requireOpenCase(id);
  if (open instanceof NextResponse) return open;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await saveCaseLayout(id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  for (const m of result.moved) {
    await logOffboardingEvent({
      caseId: id,
      eventType: "task_moved",
      session,
      req,
      details: { task: m.title, from: m.from, to: m.to },
    });
  }
  return NextResponse.json({ ok: true });
}
