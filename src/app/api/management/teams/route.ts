import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { isKnownOffice } from "@/lib/org/lists";
import { loadTeamPeople, loadTeams, peopleProblem, setTeamMembers, TeamsMissingError } from "@/lib/teams";
import { dbError, teamGate } from "./_gate";

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  office: z.string().min(1).optional(),
  leader_id: z.string().uuid().nullable().optional(),
  member_ids: z.array(z.string().uuid()).max(200).default([]),
});

// Teams in the viewer's scope and the people who can be on them. Admins may
// pass ?office= to narrow (the page's office picker).
export async function GET(req: NextRequest) {
  const gate = await teamGate();
  if (!gate.ok) return gate.response;
  const office = gate.office ?? (req.nextUrl.searchParams.get("office") || null);
  try {
    const [teams, people] = await Promise.all([
      loadTeams(gate.supabase, office),
      loadTeamPeople(gate.supabase, office),
    ]);
    return NextResponse.json({ teams, people });
  } catch (e) {
    const status = e instanceof TeamsMissingError ? 503 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function POST(req: NextRequest) {
  const gate = await teamGate();
  if (!gate.ok) return gate.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const { name, leader_id, member_ids } = parsed.data;

  // Managers always create in their own office.
  const office = gate.office ?? parsed.data.office ?? null;
  if (!office) return NextResponse.json({ error: "Pick an office for the team." }, { status: 400 });
  if (!gate.office && !(await isKnownOffice(office))) {
    return NextResponse.json({ error: `Unknown office "${office}".` }, { status: 400 });
  }
  const problem = await peopleProblem(gate.supabase, office, [...(leader_id ? [leader_id] : []), ...member_ids]);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const { data, error } = await gate.supabase
    .from("launcher_teams")
    .insert({ name, office, leader_id: leader_id ?? null, created_by: gate.session.user.profileId || null })
    .select("id")
    .single();
  if (error) return dbError(error.message, error.code);

  const memberErr = await setTeamMembers(gate.supabase, data.id, member_ids, gate.session.user.profileId || null);
  if (memberErr) return dbError(memberErr);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
