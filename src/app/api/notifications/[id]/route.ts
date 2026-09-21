import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const patchSchema = z.object({
  read: z.boolean().optional(),
});

// PATCH /api/notifications/[id] — mark a single notification read
// (`{"read": true}`) or explicitly unread (`{"read": false}`). Scoped to the
// current user's own rows so a client can't touch someone else's list.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notifications")
    .update({
      read_at: parsed.data.read === false ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", session.user.profileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/notifications/[id] — soft-dismiss so the bell drops it.
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", session.user.profileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
