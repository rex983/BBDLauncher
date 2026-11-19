import "server-only";
import type { Session } from "next-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyticsScope, canManageContent, isAdmin, isAppsOnlyRole, permRoleFor } from "@/lib/auth/permissions";
import { managerTargetError } from "@/lib/auth/user-admin";
import { isTargetInScope, resolveTimeDataScope } from "@/lib/auth/scope-check";
import { getCachedRoles, type CachedRole } from "@/lib/launcher/cache";
import { getOrgLists } from "@/lib/org/lists";
import { orgLabel } from "@/lib/org/constants";
import { canViewAs } from "@/lib/launcher/view-as";
import { getMyStateToday } from "@/lib/timesheets/server";
import { STATUS_LABEL, type LiveStatus } from "@/lib/timesheets/state";
import type { PreviewUser } from "@/components/features/launcher/role-preview-context";

// One person, as an admin or manager may see them: the card behind every
// clickable name (PersonLink → /api/people/[id]) and the header of their
// full profile (/admin/users/[id]).
//
// Who sees what:
//   - the basics (photo, role, office, department, team): anyone who can open
//     the Users page. Managers only see active people, as in that list.
//   - clock status: only inside the viewer's time-data scope.
//   - last launcher activity: only inside the viewer's analytics scope.

export interface PersonSummary {
  id: string;
  email: string;
  name: string | null;
  role: string;
  role_label: string;
  office: string | null;
  office_label: string | null;
  department: string | null;
  department_label: string | null;
  is_it: boolean;
  can_offboard: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  has_photo: boolean;
  /** The team they're on, and who leads it. */
  team: { name: string; leader_id: string | null; leader_name: string | null } | null;
  /** Teams they lead. */
  leads: string[];
  /** Time clock right now; null when the viewer can't see their time data. */
  clock: { status: LiveStatus; label: string } | null;
  /** Last app launch or link click; null when hidden or never. */
  last_activity: string | null;
  can: {
    /** Edit, deactivate or remove them on the Users page. */
    manage: boolean;
    /** Launcher activity (apps, audit log). */
    activity: boolean;
    /** Timesheet, time off and incidents. */
    time: boolean;
  };
  /** Set when the viewer may View as them. */
  view_as: PreviewUser | null;
}

const COLUMNS =
  "id, email, name:full_name, role, office, department, is_it, can_offboard, is_active, created_at, updated_at, avatar_url";

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
  department: string | null;
  is_it: boolean | null;
  can_offboard: boolean | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
  avatar_url: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Viewer = Session["user"];

/** May this manager-or-admin edit / deactivate / remove the target? */
export function canManagePerson(
  viewer: Pick<Viewer, "permRole" | "office">,
  target: { role: string; office: string | null },
  roles: ReadonlyArray<CachedRole>,
): boolean {
  if (isAdmin(viewer.permRole)) return true;
  return (
    managerTargetError(
      { role: viewer.permRole, office: viewer.office },
      { role: permRoleFor(target.role, roles), office: target.office },
    ) === null
  );
}

async function loadTeams(id: string): Promise<Pick<PersonSummary, "team" | "leads">> {
  const supabase = createAdminClient();
  try {
    const [memberRes, leadsRes] = await Promise.all([
      supabase.from("launcher_team_members").select("launcher_teams(name, leader_id)").eq("profile_id", id).maybeSingle(),
      supabase.from("launcher_teams").select("name").eq("leader_id", id).order("name"),
    ]);
    const raw = memberRes.data?.launcher_teams as
      | { name: string; leader_id: string | null }
      | { name: string; leader_id: string | null }[]
      | null
      | undefined;
    const t = Array.isArray(raw) ? raw[0] : raw;
    let team: PersonSummary["team"] = null;
    if (t) {
      let leaderName: string | null = null;
      if (t.leader_id && t.leader_id !== id) {
        const { data } = await supabase.from("profiles").select("full_name, email").eq("id", t.leader_id).maybeSingle();
        leaderName = (data?.full_name as string | null) || (data?.email as string | null) || null;
      }
      team = { name: t.name, leader_id: t.leader_id, leader_name: leaderName };
    }
    return { team, leads: (leadsRes.data ?? []).map((r) => r.name as string) };
  } catch {
    // Teams not set up (migration 056): the card just has no team line.
    return { team: null, leads: [] };
  }
}

/**
 * The person as `viewer` may see them, or null when there's no such person
 * or the viewer may not see them.
 */
export async function loadPersonSummary(viewer: Viewer, id: string): Promise<PersonSummary | null> {
  if (!canManageContent(viewer.permRole) || !UUID.test(id)) return null;
  const supabase = createAdminClient();
  const viewerIsAdmin = isAdmin(viewer.permRole);

  const [{ data }, roles, { offices, departments }] = await Promise.all([
    supabase.from("profiles").select(COLUMNS).eq("id", id).maybeSingle(),
    getCachedRoles().catch(() => [] as CachedRole[]),
    getOrgLists(),
  ]);
  const p = data as Row | null;
  if (!p) return null;
  const active = p.is_active !== false;
  // Managers only ever see active people (same as the Users list).
  if (!active && !viewerIsAdmin) return null;

  const isSelf = id === viewer.profileId;
  const aScope = analyticsScope(viewer.permRole, viewer.office ?? null);
  const canActivity = aScope.allowed && (aScope.office === null || aScope.office === p.office);
  const tScope = resolveTimeDataScope(viewer, "view");
  const canTime =
    tScope.ok &&
    (tScope.viewerIsAdmin ||
      (!isSelf && isTargetInScope(tScope.scope, { department: p.department, office: p.office, is_active: active })));

  const [teams, clock, lastRes, mayViewAs] = await Promise.all([
    loadTeams(id),
    canTime && active
      ? getMyStateToday(id)
          .then((s) => ({ status: s.state.status, label: STATUS_LABEL[s.state.status] }))
          .catch(() => null)
      : null,
    canActivity
      ? supabase
          .from("launcher_sso_audit_log")
          .select("created_at")
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : null,
    !isSelf && active ? canViewAs(viewer.profileId, id) : false,
  ]);

  const roleLabel = roles.find((r) => r.name === p.role)?.display_name ?? p.role;
  return {
    id: p.id,
    email: p.email,
    name: p.name,
    role: p.role,
    role_label: roleLabel,
    office: p.office,
    office_label: p.office ? orgLabel(offices, p.office) : null,
    department: p.department,
    department_label: p.department ? orgLabel(departments, p.department) : null,
    is_it: !!p.is_it,
    can_offboard: !!p.can_offboard,
    is_active: active,
    created_at: p.created_at,
    updated_at: p.updated_at,
    has_photo: !!p.avatar_url,
    ...teams,
    clock,
    last_activity: (lastRes?.data?.created_at as string | undefined) ?? null,
    can: {
      manage: canManagePerson(viewer, p, roles),
      activity: canActivity,
      time: canTime,
    },
    view_as:
      mayViewAs === true
        ? {
            id: p.id,
            name: p.name || p.email,
            role: p.role,
            perm_role: permRoleFor(p.role, roles),
            role_label: roleLabel,
            office: p.office,
            department: p.department,
            can_offboard: !!p.can_offboard,
            apps_only: isAppsOnlyRole(p.role, roles),
          }
        : null,
  };
}
