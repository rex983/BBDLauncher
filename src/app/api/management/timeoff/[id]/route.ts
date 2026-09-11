import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditTimeData, timeDataScope } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const decideSchema = z.object({
  status: z.enum(["approved", "denied"]),
  decided_note: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user || !canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const scope = timeDataScope(session.user.role, session.user.office);
  if (!scope.allowed) return NextResponse.json({ error: "No scope" }, { status: 403 });

  const parsed = decideSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: reqRow } = await supabase
    .from("time_off_requests")
    .select("profile_id, status")
    .eq("id", id)
    .single();
  if (!reqRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (reqRow.status !== "pending") {
    return NextResponse.json({ error: "Already decided" }, { status: 409 });
  }

  if (scope.office) {
    const { data: profile } = await supabase
      .from("profiles").select("office").eq("id", reqRow.profile_id).single();
    if (!profile || profile.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  const { data, error } = await supabase
    .from("time_off_requests")
    .update({
      status: parsed.data.status,
      decided_by: session.user.profileId,
      decided_at: new Date().toISOString(),
      decided_note: parsed.data.decided_note ?? null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
