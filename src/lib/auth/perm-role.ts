// Resolves a role's permission role (acts_as ?? role, migration 051) on the
// server from the cached launcher_roles list. /api/roles busts that cache, so
// an acts_as change reaches every session on its next request.

import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedRoles } from "@/lib/launcher/cache";
import { isAppsOnlyRole, permRoleFor } from "@/lib/auth/permissions";
import type { UserRole } from "@/types/auth";

type RoleRow = { name: string; acts_as?: string | null; apps_only?: boolean | null };

async function loadRoles(): Promise<RoleRow[]> {
  try {
    return await getCachedRoles();
  } catch {
    // No data cache outside a request: read it directly.
    const { data } = await createAdminClient().from("launcher_roles").select("*");
    return (data ?? []) as RoleRow[];
  }
}

export async function resolvePermRole(role: UserRole | null | undefined): Promise<UserRole> {
  if (!role || role === "admin") return role ?? "";
  try {
    return permRoleFor(role, await loadRoles());
  } catch {
    // Can't read roles: least privilege is the role itself.
    return role;
  }
}

/** Permission-role lookup for many roles at once (e.g. user lists). */
export async function permRoleResolver(): Promise<(role: UserRole | null | undefined) => UserRole> {
  let roles: RoleRow[] = [];
  try {
    roles = await loadRoles();
  } catch {
    // least privilege
  }
  return (role) => permRoleFor(role, roles);
}

/** Whether this role is "apps only" (migration 062). False when roles can't be read. */
export async function resolveAppsOnly(role: UserRole | null | undefined): Promise<boolean> {
  if (!role || role === "admin") return false;
  try {
    return isAppsOnlyRole(role, await loadRoles());
  } catch {
    return false;
  }
}
