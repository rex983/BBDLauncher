import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditTimeData, isAdmin } from "@/lib/auth/permissions";
import { publishMemo } from "@/lib/memos/service";
import { extractActorHeaders } from "@/lib/http";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const publishSchema = z.object({
  custom_profile_ids: z.array(z.string().uuid()).max(500).optional(),
});

// POST /api/management/memos/[id]/publish — manually publish a draft.
// Author or admin only. For custom-scope memos, the caller supplies
// the recipient list here (since drafts don't store it).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user || !canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const parsed = publishSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const admin = isAdmin(session.user.role);

  const { data: memo } = await supabase
    .from("office_memos")
    .select("id, author_profile_id, status, audience_scope")
    .eq("id", id)
    .single();
  if (!memo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!admin && memo.author_profile_id !== session.user.profileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (memo.status === "archived") {
    return NextResponse.json({ error: "Cannot publish archived memo" }, { status: 400 });
  }
  if (memo.audience_scope === "custom" && !parsed.data.custom_profile_ids?.length) {
    return NextResponse.json(
      { error: "Custom-audience memos require custom_profile_ids." },
      { status: 400 },
    );
  }

  const { ip, ua } = extractActorHeaders(req);

  try {
    const result = await publishMemo({
      supabase,
      memoId: id,
      actorProfileId: session.user.profileId,
      actorIp: ip,
      actorUa: ua,
      customProfileIds: parsed.data.custom_profile_ids,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Publish failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
