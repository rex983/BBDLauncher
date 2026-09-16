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

  // Split fetch: time_off_requests has TWO FKs to profiles (profile_id
  // and decided_by), so `profiles!inner(...)` is ambiguous and returns no
  // row. Fetch the request first; only join the profile when we actually
  // need it for scope checks (i.e., non-admin viewers).
  const { data: reqRow } = await supabase
    .from("time_off_requests")
    .select("profile_id, status")
    .eq("id", id)
    .single<{ profile_id: string; status: string }>();
  if (!reqRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (reqRow.status !== "pending") {
    return NextResponse.json({ error: "Already decided" }, { status: 409 });
  }
  // Segregation of duties: manager-tier users can't approve or deny their
  // own request — the two-person rule for HR decisions. Admins have full
  // authority and can self-approve, since they may be the only signer with
  // scope over themselves.
  if (!viewerIsAdmin && reqRow.profile_id === session.user.profileId) {
    return NextResponse.json(
      { error: "You cannot decide your own time-off request" },
      { status: 403 }
    );
  }
  if (!viewerIsAdmin) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", reqRow.profile_id)
      .single<{ department: string | null; office: string | null; is_active: boolean }>();
    if (!prof) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (prof.is_active === false) {
      return NextResponse.json({ error: "Employee is inactive" }, { status: 403 });
    }
    if (scope.department && prof.department !== scope.department) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.office && prof.office !== scope.office) {
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
