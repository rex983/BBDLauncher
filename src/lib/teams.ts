import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Teams (migration 056): a leader and the reps on their team, one office per
// team, a person on at most one team. Managed on /management/teams; other
// apps read them through the launcher kit (getLauncherTeams).

export interface Team {
  id: string;
  name: string;
  office: string;
  leader_id: string | null;
  member_ids: string[];
  updated_at: string;
}

export interface TeamPerson {
  id: string;
  name: string | null;
  email: string;
  role: string;
  office: string | null;
}

const TABLE_MISSING = new Set(["PGRST205", "42P01"]);

export class TeamsMissingError extends Error {
  constructor() {
    super("Teams aren't set up yet: apply migration 056_teams.sql in the Supabase SQL Editor.");
  }
}

/** Teams in an office (null = every office), with their member ids. */
export async function loadTeams(supabase: SupabaseClient, office: string | null): Promise<Team[]> {
  let q = supabase
    .from("launcher_teams")
    .select("id, name, office, leader_id, updated_at, launcher_team_members(profile_id)")
    .order("name");
  if (office) q = q.eq("office", office);
  const { data, error } = await q;
  if (error) {
    if (TABLE_MISSING.has(error.code ?? "")) throw new TeamsMissingError();
    throw new Error(error.message);
  }
  return (data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    office: t.office as string,
    leader_id: (t.leader_id as string | null) ?? null,
    updated_at: t.updated_at as string,
    member_ids: ((t.launcher_team_members as { profile_id: string }[] | null) ?? []).map((m) => m.profile_id),
  }));
}

/** Active people in an office (null = every office): who can lead or be on a team. */
export async function loadTeamPeople(supabase: SupabaseClient, office: string | null): Promise<TeamPerson[]> {
  let q = supabase
    .from("profiles")
    .select("id, name:full_name, email, role, office")
    .eq("is_active", true)
    .order("full_name");
  if (office) q = q.eq("office", office);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamPerson[];
}

/**
 * Why these people can't lead or be on a team in `office`, or null when they
 * all can: each must be an active profile in that office.
 */
export async function peopleProblem(
  supabase: SupabaseClient,
  office: string,
  ids: string[],
): Promise<string | null> {
  const unique = [...new Set(ids)];
  if (!unique.length) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name:full_name, email, office, is_active")
    .in("id", unique);
  if (error) return error.message;
  const found = new Map((data ?? []).map((p) => [p.id as string, p]));
  for (const id of unique) {
    const p = found.get(id);
    if (!p) return "Someone picked no longer exists. Reload and try again.";
    const who = (p.name as string | null) || (p.email as string);
    if (p.is_active === false) return `${who} is inactive.`;
    if (p.office !== office) return `${who} isn't in the ${office} office.`;
  }
  return null;
}

/**
 * Make `memberIds` exactly the team's members. People on another team move
 * here (a person is on one team at most).
 */
export async function setTeamMembers(
  supabase: SupabaseClient,
  teamId: string,
  memberIds: string[],
  actorId: string | null,
): Promise<string | null> {
  const ids = [...new Set(memberIds)];
  let del = supabase.from("launcher_team_members").delete().eq("team_id", teamId);
  if (ids.length) del = del.not("profile_id", "in", `(${ids.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) return delErr.message;
  if (!ids.length) return null;

  // Keep added_at for people already on this team.
  const { data: existing } = await supabase
    .from("launcher_team_members")
    .select("profile_id, team_id")
    .in("profile_id", ids);
  const already = new Set((existing ?? []).filter((r) => r.team_id === teamId).map((r) => r.profile_id as string));
  const rows = ids
    .filter((id) => !already.has(id))
    .map((id) => ({ profile_id: id, team_id: teamId, added_by: actorId, added_at: new Date().toISOString() }));
  if (!rows.length) return null;
  const { error } = await supabase.from("launcher_team_members").upsert(rows, { onConflict: "profile_id" });
  return error?.message ?? null;
}
