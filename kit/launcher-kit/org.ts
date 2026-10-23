import { unstable_cache } from "next/cache";
import { adminClient } from "./config";

// Offices, departments and roles are created and named only in the launcher
// (launcher_offices, launcher_departments, launcher_roles). Server-side
// reads, cached 60s. If the tables are missing the built-in lists are used.
// Unknown values always render as their raw name.

export interface OrgOption {
  name: string;
  display_name: string;
}

export interface RoleOption extends OrgOption {
  /** "Permissions like": the built-in role this role's in-app permissions follow. */
  acts_as: string | null;
}

const FALLBACK_OFFICES: OrgOption[] = [
  { name: "Sales", display_name: "Sales" },
  { name: "BST", display_name: "BST" },
  { name: "RnD", display_name: "R&D" },
];

const FALLBACK_DEPARTMENTS: OrgOption[] = [
  { name: "SALES TEAM", display_name: "SALES TEAM" },
  { name: "BST", display_name: "BST" },
  { name: "RnD", display_name: "RnD" },
];

const TABLE_MISSING = new Set(["PGRST205", "42P01"]);

async function readList(table: "launcher_offices" | "launcher_departments", fallback: OrgOption[]) {
  const { data, error } = await adminClient()
    .from(table)
    .select("name, display_name")
    .order("sort_order")
    .order("name");
  if (error) {
    if (!TABLE_MISSING.has(error.code ?? "")) {
      console.warn(`[launcher-kit] ${table} read failed; using built-in list`, error.message);
    }
    return fallback;
  }
  return (data ?? []).map((r) => ({
    name: String(r.name),
    display_name: (r.display_name as string | null) || String(r.name),
  }));
}

async function readRoles(): Promise<RoleOption[]> {
  const client = adminClient();
  let res = await client.from("launcher_roles").select("name, display_name, acts_as").order("name");
  // acts_as arrived in migration 051.
  if (res.error && res.error.code === "42703") {
    res = (await client.from("launcher_roles").select("name, display_name").order("name")) as typeof res;
  }
  if (res.error) {
    console.warn("[launcher-kit] launcher_roles read failed", res.error.message);
    return [];
  }
  return (res.data ?? []).map((r) => ({
    name: String(r.name),
    display_name: (r.display_name as string | null) || String(r.name),
    acts_as: ((r as { acts_as?: string | null }).acts_as as string | null) ?? null,
  }));
}

export const getLauncherOffices = unstable_cache(
  () => readList("launcher_offices", FALLBACK_OFFICES),
  ["launcher-kit-offices"],
  { revalidate: 60 },
);

export const getLauncherDepartments = unstable_cache(
  () => readList("launcher_departments", FALLBACK_DEPARTMENTS),
  ["launcher-kit-departments"],
  { revalidate: 60 },
);

export const getLauncherRoles = unstable_cache(readRoles, ["launcher-kit-roles"], { revalidate: 60 });

/** Label for a name from one of the lists; the raw name if it isn't there. */
export function displayName(options: OrgOption[], name: string | null | undefined): string {
  if (!name) return "";
  return options.find((o) => o.name === name)?.display_name || name;
}

/** Values that aren't an office in the launcher. */
export async function invalidOffices(values: unknown[]): Promise<unknown[]> {
  const known = new Set((await getLauncherOffices()).map((o) => o.name));
  return values.filter((v) => typeof v !== "string" || !known.has(v));
}

/** Values that aren't a department in the launcher. */
export async function invalidDepartments(values: unknown[]): Promise<unknown[]> {
  const known = new Set((await getLauncherDepartments()).map((o) => o.name));
  return values.filter((v) => typeof v !== "string" || !known.has(v));
}

// ---------------------------------------------------------------------------
// Teams (launcher migration 056), managed on the launcher's /management/teams:
// a leader and the reps on their team, one office per team, a person on at
// most one team. Ids are launcher profile ids. Empty until the migration is
// applied.
// ---------------------------------------------------------------------------

export interface LauncherTeam {
  id: string;
  name: string;
  office: string;
  /** Profile id of the team leader, if there is one. Not in member_ids. */
  leader_id: string | null;
  /** Profile ids of the reps on the team. */
  member_ids: string[];
}

async function readTeams(): Promise<LauncherTeam[]> {
  const { data, error } = await adminClient()
    .from("launcher_teams")
    .select("id, name, office, leader_id, launcher_team_members(profile_id)")
    .order("name");
  if (error) {
    if (!TABLE_MISSING.has(error.code ?? "")) {
      console.warn("[launcher-kit] launcher_teams read failed", error.message);
    }
    return [];
  }
  return (data ?? []).map((t) => ({
    id: String(t.id),
    name: String(t.name),
    office: String(t.office),
    leader_id: (t.leader_id as string | null) ?? null,
    member_ids: (((t as { launcher_team_members?: { profile_id: string }[] | null }).launcher_team_members) ?? []).map(
      (m) => m.profile_id,
    ),
  }));
}

/** Every team with its leader and members, cached 60s. */
export const getLauncherTeams = unstable_cache(readTeams, ["launcher-kit-teams"], { revalidate: 60 });

/** The team a profile is on as a rep, else the first one they lead; null if neither. */
export function teamOfProfile(teams: LauncherTeam[], profileId: string | null | undefined): LauncherTeam | null {
  if (!profileId) return null;
  return teams.find((t) => t.member_ids.includes(profileId)) ?? teams.find((t) => t.leader_id === profileId) ?? null;
}

/** Teams a profile leads. */
export function teamsLedBy(teams: LauncherTeam[], profileId: string | null | undefined): LauncherTeam[] {
  return profileId ? teams.filter((t) => t.leader_id === profileId) : [];
}
