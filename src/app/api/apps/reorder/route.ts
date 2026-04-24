import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const reorderSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().uuid(),
      section_id: z.string().uuid().nullable(),
      display_order: z.number().int(),
    })
  ),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  for (const { id, section_id, display_order } of parsed.data.updates) {
    const { error } = await supabase
      .from("launcher_apps")
      .update({ section_id, display_order })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ success: true });
}
