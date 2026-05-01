import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SectionedAppGrid } from "@/components/features/launcher/sectioned-app-grid";
import { ImportantLinks } from "@/components/features/launcher/important-links";
import { ViewAsRole } from "@/components/features/launcher/view-as-role";
import { canManageContent } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { LauncherApp, LauncherSection } from "@/types/app";
import type { ImportantLink } from "@/types/link";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { viewAs } = await searchParams;
  const isAdmin = session.user.role === "admin";
  const canEditDashboard = canManageContent(session.user.role);
  const effectiveRole = isAdmin && viewAs ? viewAs : session.user.role;

  // Try loading apps, sections, and links from Supabase
  let apps: LauncherApp[] = [];
  let sections: LauncherSection[] = [];
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

    const { data: sectionsData } = await supabase
      .from("launcher_sections")
      .select("*")
      .order("display_order", { ascending: true });
    sections = (sectionsData as LauncherSection[]) || [];

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
      <SectionedAppGrid apps={apps} sections={sections} isAdmin={canEditDashboard} />
      {links.length > 0 && (
        <>
          <hr className="border-border" />
          <ImportantLinks links={links} />
        </>
      )}
    </div>
  );
}
