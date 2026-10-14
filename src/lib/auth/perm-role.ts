// Resolves a role's permission role (acts_as ?? role, migration 051) on the
// server from the cached launcher_roles list. /api/roles busts that cache, so
// an acts_as change reaches every session on its next request.

import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedRoles } from "@/lib/launcher/cache";
import { permRoleFor } from "@/lib/auth/permissions";
import type { UserRole } from "@/types/auth";

async function loadRoles(): Promise<Array<{ name: string; acts_as?: string | null }>> {
  try {
    return await getCachedRoles();
  } catch {
    // No data cache outside a request: read it directly.
    const { data } = await createAdminClient().from("launcher_roles").select("*");
    return (data ?? []) as Array<{ name: string; acts_as?: string | null }>;
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
  let roles: Array<{ name: string; acts_as?: string | null }> = [];
  try {
    roles = await loadRoles();
  } catch {
    // least privilege
  }
  return (role) => permRoleFor(role, roles);
}
