import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOffboarder } from "@/lib/offboarding/service";
import { itemSchema } from "@/lib/offboarding/schemas";

const ITEM_COLUMNS =
  "id, title, system, category, instructions, requires_note, default_assignee, display_order, is_active";

export async function GET() {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("offboarding_checklist_items")
    .select(ITEM_COLUMNS)
    .order("display_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const parsed = itemSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("offboarding_checklist_items")
    .insert({ ...parsed.data, instructions: parsed.data.instructions?.trim() || null })
    .select(ITEM_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
