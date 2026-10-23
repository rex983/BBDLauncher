import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { isKnownOffice } from "@/lib/org/lists";
import { peopleProblem, setTeamMembers } from "@/lib/teams";
import { dbError, teamGate } from "../_gate";

const patchSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60).optional(),
  /** Admins only; managers' teams stay in their office. */
  office: z.string().min(1).optional(),
  leader_id: z.string().uuid().nullable().optional(),
  /** The whole member list (replaces it). */
  member_ids: z.array(z.string().uuid()).max(200).optional(),
});

async function loadTeam(gate: Extract<Awaited<ReturnType<typeof teamGate>>, { ok: true }>, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data } = await gate.supabase
    .from("launcher_teams")
    .select("id, office, leader_id, launcher_team_members(profile_id)")
    .eq("id", id)
    .maybeSingle();
  // Outside a manager's office reads as missing.
  if (!data || (gate.office && data.office !== gate.office)) return null;
  return data;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await teamGate();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const team = await loadTeam(gate, id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const body = parsed.data;

  if (body.office && body.office !== team.office) {
    if (gate.office) return NextResponse.json({ error: "Only admins can move a team to another office." }, { status: 403 });
    if (!(await isKnownOffice(body.office))) {
      return NextResponse.json({ error: `Unknown office "${body.office}".` }, { status: 400 });
    }
  }
  const office = body.office ?? (team.office as string);
  const leader = body.leader_id !== undefined ? body.leader_id : (team.leader_id as string | null);
  const members =
    body.member_ids ??
    ((team.launcher_team_members as { profile_id: string }[] | null) ?? []).map((m) => m.profile_id);
  // Everyone the team ends up with must be in its office (checked again
  // when the office changes, for the people already on it).
  const problem = await peopleProblem(gate.supabase, office, [...(leader ? [leader] : []), ...members]);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) update.name = body.name;
  if (body.office !== undefined) update.office = body.office;
  if (body.leader_id !== undefined) update.leader_id = body.leader_id;
  const { error } = await gate.supabase.from("launcher_teams").update(update).eq("id", id);
  if (error) return dbError(error.message, error.code);

  if (body.member_ids) {
    const memberErr = await setTeamMembers(gate.supabase, id, body.member_ids, gate.session.user.profileId || null);
    if (memberErr) return dbError(memberErr);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await teamGate();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const team = await loadTeam(gate, id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  const { error } = await gate.supabase.from("launcher_teams").delete().eq("id", id);
  if (error) return dbError(error.message, error.code);
  return NextResponse.json({ ok: true });
}
