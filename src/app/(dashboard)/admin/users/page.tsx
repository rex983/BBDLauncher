import { getCachedRoles } from "@/lib/launcher/cache";
import { getOrgLists } from "@/lib/org/lists";
import { UsersShell } from "./UsersShell";

// The admin layout limits this page to admins + manager-tier; the user list
// itself loads client-side from /api/users.
export default async function AdminUsersPage() {
  const [roles, { offices, departments }] = await Promise.all([getCachedRoles(), getOrgLists()]);
  return (
    <UsersShell
      roles={roles.map((r) => ({ name: r.name, display_name: r.display_name }))}
      offices={offices}
      departments={departments}
    />
  );
}
