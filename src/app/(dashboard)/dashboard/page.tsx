import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppGrid } from "@/components/features/launcher/app-grid";
import { redirect } from "next/navigation";
import type { LauncherApp } from "@/types/app";

const devApps: LauncherApp[] = [
  {
    id: "dev-app-001",
    name: "Order Processing",
    description: "Manage and process customer orders",
    url: "https://order-processing.bigbuildings.app/",
    icon_url: null,
    sso_type: "jwt",
    status: "active",
    display_order: 1,
    open_in_new_tab: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "dev-app-002",
    name: "Auto Pricer / CRM",
    description: "Automated pricing and customer relationship management",
    url: "https://bigbuildings.app/",
    icon_url: null,
    sso_type: "jwt",
    status: "active",
    display_order: 2,
    open_in_new_tab: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Try loading apps from Supabase; fall back to hardcoded dev apps
  let apps: LauncherApp[] = [];
  try {
    const supabase = createAdminClient();
    const { data: accessibleAppIds } = await supabase
      .from("launcher_role_app_access")
      .select("app_id")
      .eq("role_name", session.user.role);

    const appIds = accessibleAppIds?.map((a) => a.app_id) || [];

    if (appIds.length > 0) {
      const { data } = await supabase
        .from("launcher_apps")
        .select("*")
        .in("id", appIds)
        .eq("status", "active")
        .order("display_order", { ascending: true });
      apps = (data as LauncherApp[]) || [];
    }
  } catch {
    // Supabase unavailable
  }

  // If no apps from DB, show hardcoded apps
  if (apps.length === 0) {
    apps = devApps;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Applications</h1>
        <p className="text-muted-foreground">
          Welcome back, {session.user.name || session.user.email}
        </p>
      </div>
      <AppGrid apps={apps} />
    </div>
  );
}
