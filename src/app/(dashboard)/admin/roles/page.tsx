import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { getCachedRoleAppAccess, getCachedRoles } from "@/lib/launcher/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { RolesShell, type RoleCounts } from "./RolesShell";

// Admin-only (middleware enforces it too). Counts used to come from the
// full /api/users and /api/apps lists; now one role-only profiles read plus
// the cached role × app grid.
export default async function AdminRolesPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.permRole)) redirect("/dashboard");

  const [roles, accessRows, { data: profiles }] = await Promise.all([
    getCachedRoles(),
    getCachedRoleAppAccess(),
    createAdminClient().from("profiles").select("role").eq("is_active", true),
  ]);

  const counts: RoleCounts = { users: {}, apps: {} };
  for (const p of profiles || []) counts.users[p.role] = (counts.users[p.role] || 0) + 1;
  // Apps per role: distinct apps with any grid cell for that role.
  const appsByRole = new Map<string, Set<string>>();
  for (const r of accessRows) {
    const set = appsByRole.get(r.role_name) ?? new Set<string>();
    set.add(r.app_id);
    appsByRole.set(r.role_name, set);
  }
  for (const [role, set] of appsByRole) counts.apps[role] = set.size;

  return <RolesShell initial={roles} counts={counts} />;
}
