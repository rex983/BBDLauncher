import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageContent } from "@/lib/auth/permissions";
import { bustLauncherCache } from "@/lib/launcher/cache";
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
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const results = await Promise.all(
    parsed.data.updates.map(({ id, section_id, display_order }) =>
      supabase
        .from("launcher_apps")
        .update({ section_id, display_order })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }
  bustLauncherCache("apps");
  return NextResponse.json({ success: true });
}
