import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppGrid } from "@/components/features/launcher/app-grid";
import { ImportantLinks } from "@/components/features/launcher/important-links";
import { ViewAsRole } from "@/components/features/launcher/view-as-role";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { LauncherApp } from "@/types/app";
import type { ImportantLink } from "@/types/link";

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { viewAs } = await searchParams;
  const isAdmin = session.user.role === "admin";
  const effectiveRole = isAdmin && viewAs ? viewAs : session.user.role;

  // Try loading apps and links from Supabase
  let apps: LauncherApp[] = [];
  let links: ImportantLink[] = [];
  let roles: { name: string; display_name: string }[] = [];
  try {
    const supabase = createAdminClient();

    // Fetch roles for the selector (admin only)
    if (isAdmin) {
      const { data: rolesData } = await supabase
        .from("launcher_roles")
        .select("name, display_name")
        .order("name");
      roles = rolesData || [];
    }

    const { data: accessibleAppIds } = await supabase
      .from("launcher_role_app_access")
      .select("app_id")
      .eq("role_name", effectiveRole);

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

    // Fetch important links
    const { data: linksData, error: linksError } = await supabase
      .from("launcher_links")
      .select("*")
      .order("display_order", { ascending: true });
    if (linksError) {
      console.error("Links fetch error:", linksError.message);
    }
    links = (linksData as ImportantLink[]) || [];
  } catch (err) {
    console.error("Dashboard data fetch error:", err);
  }

  // If no apps from DB, show hardcoded apps
  if (apps.length === 0 && !viewAs) {
    apps = devApps;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-muted-foreground">
            Welcome back, {session.user.name || session.user.email}
          </p>
        </div>
        {isAdmin && roles.length > 0 && (
          <Suspense>
            <ViewAsRole roles={roles} currentRole={session.user.role} />
          </Suspense>
        )}
      </div>
      {viewAs && viewAs !== session.user.role && (
        <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded">
          Viewing as <span className="font-medium">{viewAs}</span> role
        </div>
      )}
      <AppGrid apps={apps} />
      {links.length > 0 && (
        <>
          <hr className="border-border" />
          <ImportantLinks links={links} />
        </>
      )}
    </div>
  );
}
