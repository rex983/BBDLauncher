import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTemplate, requireOffboarder } from "@/lib/offboarding/service";
import { itemSchema } from "@/lib/offboarding/schemas";

const ITEM_COLUMNS =
  "id, section_id, title, system, instructions, requires_note, auto_action, display_order, is_active";

// The whole template: { sections, items }.
export async function GET() {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  return NextResponse.json(await getTemplate());
}

export async function POST(req: NextRequest) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const parsed = itemSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createAdminClient();
  // New items go at the end of their section unless an order was given.
  let displayOrder = parsed.data.display_order;
  if (displayOrder === undefined) {
    const { data: last } = await supabase
      .from("offboarding_checklist_items")
      .select("display_order")
      .eq("section_id", parsed.data.section_id)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    displayOrder = (last?.display_order ?? -1) + 1;
  }
  const { data, error } = await supabase
    .from("offboarding_checklist_items")
    .insert({
      ...parsed.data,
      system: parsed.data.system?.trim() || null,
      instructions: parsed.data.instructions?.trim() || null,
      display_order: displayOrder,
    })
    .select(ITEM_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
