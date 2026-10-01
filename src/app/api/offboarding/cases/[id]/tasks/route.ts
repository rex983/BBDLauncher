import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { requireOpenCase } from "@/lib/offboarding/guard";
import { requireOffboarder } from "@/lib/offboarding/service";
import { sectionIdByName } from "@/lib/offboarding/checklist-link";

// Adds a task to this case. With add_to_checklist it is also added to the
// checklist (same section) so every future offboarding gets it.
const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  system: z.string().trim().max(100).nullable().optional(),
  section: z.string().trim().min(1).max(100),
  instructions: z.string().max(2000).nullable().optional(),
  requires_note: z.boolean().optional(),
  add_to_checklist: z.boolean().optional(),
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
  // Goes at the end of its section (or the end of the case for a new one).
  const { data: existing } = await supabase
    .from("offboarding_tasks")
    .select("section, display_order")
    .eq("case_id", id);
  const orders = (existing || []).map((t) => t.display_order as number);
  const inSection = (existing || [])
    .filter((t) => t.section === parsed.data.section)
    .map((t) => t.display_order as number);
  const displayOrder = inSection.length
    ? Math.max(...inSection) + 1
    : (orders.length ? Math.max(...orders) : 0) + 10;

  const title = parsed.data.title;
  const system = parsed.data.system?.trim() || null;
  const instructions = parsed.data.instructions?.trim() || null;
  const requiresNote = parsed.data.requires_note ?? false;

  let itemId: string | null = null;
  if (parsed.data.add_to_checklist) {
    const sectionId = await sectionIdByName(parsed.data.section);
    if (!sectionId) {
      return NextResponse.json(
        { error: `The checklist has no "${parsed.data.section}" section any more.` },
        { status: 400 },
      );
    }
    const { data: last } = await supabase
      .from("offboarding_checklist_items")
      .select("display_order")
      .eq("section_id", sectionId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: item, error: itemError } = await supabase
      .from("offboarding_checklist_items")
      .insert({
        section_id: sectionId,
        title,
        system,
        instructions,
        requires_note: requiresNote,
        display_order: (last?.display_order ?? -1) + 1,
      })
      .select("id")
      .single();
    if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
    itemId = item.id;
  }

  const { data, error } = await supabase
    .from("offboarding_tasks")
    .insert({
      case_id: id,
      item_id: itemId,
      title,
      system,
      section: parsed.data.section,
      instructions,
      requires_note: requiresNote,
      display_order: displayOrder,
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
    details: { title, section: parsed.data.section, added_to_checklist: !!itemId },
  });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
