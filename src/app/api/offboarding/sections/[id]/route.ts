import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOffboarder } from "@/lib/offboarding/service";
import { sectionSchema } from "@/lib/offboarding/schemas";

// Rename. Open cases keep the section name they were created with.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const parsed = sectionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from("offboarding_sections").update({ name: parsed.data.name }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Deletes the section and its template items (cases already open are untouched).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const supabase = createAdminClient();
  const { error } = await supabase.from("offboarding_sections").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
