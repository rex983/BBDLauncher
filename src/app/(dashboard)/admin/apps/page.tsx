import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { loadAdminApps } from "@/lib/launcher/admin-apps";
import { AppsShell } from "./AppsShell";
import { getCachedRoles } from "@/lib/launcher/cache";
import { getOffices } from "@/lib/org/lists";

// Server-rendered first paint: same data and gating as GET /api/apps (the
// admin layout already limits this page to admins + managers; SSO configs
// only load for admins). The shell refetches the API after mutations.
export default async function AdminAppsPage() {
  const session = await auth();
  const [{ data }, roles, offices] = await Promise.all([
    loadAdminApps(isAdmin(session?.user?.permRole)),
    getCachedRoles(),
    getOffices(),
  ]);
  return <AppsShell initial={data} roles={roles} offices={offices} />;
}
