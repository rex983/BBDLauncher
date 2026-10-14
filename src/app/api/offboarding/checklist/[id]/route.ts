import { NextRequest, NextResponse } from "next/server";
import { validationError } from "@/app/api/_lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOffboarder } from "@/lib/offboarding/service";
import { itemSchema } from "@/lib/offboarding/schemas";

// Template edits only affect cases opened afterwards — open cases keep the
// task snapshot they were created with.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const parsed = itemSchema.partial().safeParse(await req.json());
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.instructions !== undefined) {
    updates.instructions = parsed.data.instructions?.trim() || null;
  }
  if (parsed.data.system !== undefined) updates.system = parsed.data.system?.trim() || null;
  const supabase = createAdminClient();
  const { error } = await supabase.from("offboarding_checklist_items").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const supabase = createAdminClient();
  const { error } = await supabase.from("offboarding_checklist_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
