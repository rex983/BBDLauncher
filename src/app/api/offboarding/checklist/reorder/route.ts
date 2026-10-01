import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOffboarder } from "@/lib/offboarding/service";
import { reorderSchema } from "@/lib/offboarding/schemas";

// Saves a drag: section order, and each item's section + position (its index
// within the list for that section).
export async function PUT(req: NextRequest) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const parsed = reorderSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const position = new Map<string, number>();
  const results = await Promise.all([
    ...parsed.data.sections.map((id, i) =>
      supabase.from("offboarding_sections").update({ display_order: i }).eq("id", id),
    ),
    ...parsed.data.items.map((it) => {
      const n = position.get(it.section_id) ?? 0;
      position.set(it.section_id, n + 1);
      return supabase
        .from("offboarding_checklist_items")
        .update({ section_id: it.section_id, display_order: n })
        .eq("id", it.id);
    }),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
