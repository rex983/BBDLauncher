import { requireTimeDataAccess } from "@/lib/auth/scope-check";
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
  const gate = await requireTimeDataAccess(null, "edit");
  if (!gate.ok) return gate.response;
  const { session, supabase, scope, viewerIsAdmin } = gate;

  const parsed = decideSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Join in the requester's department + office so scope check + row fetch
  // is one round trip. is_active is also carried so a manager can't approve
  // time off for a deactivated employee.
  const { data: reqRow } = await supabase
    .from("time_off_requests")
    .select("profile_id, status, profiles!inner(department, office, is_active)")
    .eq("id", id)
    .single<{
      profile_id: string;
      status: string;
      profiles: { department: string | null; office: string | null; is_active: boolean };
    }>();
  if (!reqRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (reqRow.status !== "pending") {
    return NextResponse.json({ error: "Already decided" }, { status: 409 });
  }
  if (!viewerIsAdmin) {
    if (reqRow.profiles.is_active === false) {
      return NextResponse.json({ error: "Employee is inactive" }, { status: 403 });
    }
    if (scope.department && reqRow.profiles.department !== scope.department) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.office && reqRow.profiles.office !== scope.office) {
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
