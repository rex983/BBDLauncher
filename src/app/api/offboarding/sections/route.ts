import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOffboarder } from "@/lib/offboarding/service";
import { sectionSchema } from "@/lib/offboarding/schemas";

// New checklist section, added at the bottom.
export async function POST(req: NextRequest) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const parsed = sectionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { data: last } = await supabase
    .from("offboarding_sections")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("offboarding_sections")
    .insert({ name: parsed.data.name, display_order: (last?.display_order ?? -1) + 1 })
    .select("id, name, display_order")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
