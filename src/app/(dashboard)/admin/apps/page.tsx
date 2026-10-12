import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { loadAdminApps } from "@/lib/launcher/admin-apps";
import { AppsShell } from "./AppsShell";

// Server-rendered first paint: same data and gating as GET /api/apps (the
// admin layout already limits this page to admins + managers; SSO configs
// only load for admins). The shell refetches the API after mutations.
export default async function AdminAppsPage() {
  const session = await auth();
  const { data } = await loadAdminApps(isAdmin(session?.user?.role));
  return <AppsShell initial={data} />;
}
