import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { requireAdmin } from "@/lib/auth/require-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTemplate } from "@/lib/onboarding/service";

type Params = { params: Promise<{ taskId: string }> };

const patchSchema = z.union([
  z.object({ title: z.string().trim().min(1, "required").max(200) }),
  z.object({ move: z.enum(["up", "down"]) }),
]);

// Rename, or move one place up/down (positions are rewritten 0..n-1).
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const { taskId } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return validationError(parsed.error);
  const body = parsed.data;
  const supabase = createAdminClient();

  if ("title" in body) {
    const { error } = await supabase.from("onboarding_template_tasks").update({ title: body.title }).eq("id", taskId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(await getTemplate());
  }

  const list = await getTemplate();
  const i = list.findIndex((t) => t.id === taskId);
  if (i < 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const j = body.move === "up" ? i - 1 : i + 1;
  if (j >= 0 && j < list.length) {
    [list[i], list[j]] = [list[j], list[i]];
    const results = await Promise.all(
      list.map((t, position) => supabase.from("onboarding_template_tasks").update({ position }).eq("id", t.id)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }
  return NextResponse.json(await getTemplate());
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const { taskId } = await params;
  const { error } = await createAdminClient().from("onboarding_template_tasks").delete().eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(await getTemplate());
}
