import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { requireOpenCase } from "@/lib/offboarding/guard";
import { requireOffboarder } from "@/lib/offboarding/service";
import { OFFBOARDING_CATEGORY_VALUES } from "@/lib/offboarding/types";

// Ad-hoc task for something the template doesn't cover (a one-off vendor
// portal, a personal device to wipe, …). Only affects this case.
const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  system: z.string().trim().min(1).max(100),
  category: z.enum(OFFBOARDING_CATEGORY_VALUES),
  instructions: z.string().max(2000).nullable().optional(),
  requires_note: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const open = await requireOpenCase(id);
  if (open instanceof NextResponse) return open;

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("offboarding_tasks")
    .insert({
      case_id: id,
      title: parsed.data.title,
      system: parsed.data.system,
      category: parsed.data.category,
      instructions: parsed.data.instructions?.trim() || null,
      requires_note: parsed.data.requires_note ?? false,
      display_order: 5000,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logOffboardingEvent({
    caseId: id,
    taskId: data.id,
    eventType: "task_added",
    session,
    req,
    details: { title: parsed.data.title, system: parsed.data.system },
  });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
