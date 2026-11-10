import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent } from "@/lib/auth/permissions";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { NextRequest, NextResponse } from "next/server";
import { validationError } from "@/app/api/_lib/validation";
import { z } from "zod";

const reorderSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().uuid(),
      display_order: z.number().int(),
    })
  ),
});

export async function POST(req: NextRequest) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const supabase = createAdminClient();
  const results = await Promise.all(
    parsed.data.updates.map(({ id, display_order }) =>
      supabase.from("launcher_links").update({ display_order }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }
  bustLauncherCache("links");
  return NextResponse.json({ success: true });
}
