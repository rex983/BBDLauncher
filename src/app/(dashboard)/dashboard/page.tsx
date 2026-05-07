import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SectionedAppGrid } from "@/components/features/launcher/sectioned-app-grid";
import { ImportantLinks } from "@/components/features/launcher/important-links";
import { ViewAsRole } from "@/components/features/launcher/view-as-role";
import { ViewAsOffice } from "@/components/features/launcher/view-as-office";
import { canManageContent } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { LauncherApp, LauncherSection } from "@/types/app";
import type { ImportantLink } from "@/types/link";
import type { Office } from "@/types/auth";

const ALL_OFFICES: Office[] = ["Harbor", "Marion", "BST", "RnD"];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string; viewAsOffice?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { viewAs, viewAsOffice } = await searchParams;
  const isAdmin = session.user.role === "admin";
  const canEditDashboard = canManageContent(session.user.role);
  const effectiveRole = isAdmin && viewAs ? viewAs : session.user.role;
  const userOffice = session.user.office;
  const viewAsOfficeValid =
    isAdmin && viewAsOffice && (ALL_OFFICES as string[]).includes(viewAsOffice)
      ? (viewAsOffice as Office)
      : null;
  const effectiveOffice = viewAsOfficeValid ?? userOffice;
  // When an admin pins a view-as office, apply the office filter as if they
  // were a user in that office (i.e. no admin bypass for office gating).
  const bypassOffice = isAdmin && !viewAsOfficeValid;

  let apps: LauncherApp[] = [];
  let sections: LauncherSection[] = [];
  let links: ImportantLink[] = [];
  let roles: { name: string; display_name: string }[] = [];
  try {
    const supabase = createAdminClient();

    // One round-trip: fetch role-scoped apps via join, plus sections, links,
    // and (for admins) the role list — all in parallel.
    const [accessRes, sectionsRes, linksRes, rolesRes] = await Promise.all([
      supabase
        .from("launcher_role_app_access")
        .select("launcher_apps!inner(*)")
        .eq("role_name", effectiveRole)
        .eq("launcher_apps.status", "active"),
      supabase
        .from("launcher_sections")
        .select("*")
        .order("display_order", { ascending: true }),
      supabase
        .from("launcher_links")
        .select("*")
        .order("display_order", { ascending: true }),
      isAdmin
        ? supabase.from("launcher_roles").select("name, display_name").order("name")
        : Promise.resolve({ data: [] as { name: string; display_name: string }[] }),
    ]);

    const accessRows = (accessRes.data || []) as unknown as {
      launcher_apps: LauncherApp | LauncherApp[] | null;
    }[];
    const allApps = accessRows
      .flatMap((r) =>
        Array.isArray(r.launcher_apps)
          ? r.launcher_apps
          : r.launcher_apps
            ? [r.launcher_apps]
            : []
      )
      .sort((a, b) => a.display_order - b.display_order);

    // Office gate: NULL/empty = visible to all. Admins normally see everything,
    // unless they've pinned a view-as office (then we treat them like that user).
    const linkOfficeMatches = (office: string | null) =>
      bypassOffice || !office || office === effectiveOffice;
    const appOfficesMatch = (offices: string[] | null) =>
      bypassOffice ||
      !offices ||
      offices.length === 0 ||
      (effectiveOffice ? offices.includes(effectiveOffice) : false);

    apps = allApps.filter((a) => appOfficesMatch(a.offices));
    sections = (sectionsRes.data as LauncherSection[]) || [];
    links = ((linksRes.data as ImportantLink[]) || []).filter((l) =>
      linkOfficeMatches(l.office)
    );
    roles = (rolesRes.data as { name: string; display_name: string }[]) || [];
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
        {isAdmin && (
          <div className="flex items-center gap-2">
            {roles.length > 0 && (
              <Suspense>
                <ViewAsRole roles={roles} currentRole={session.user.role} />
              </Suspense>
            )}
            <Suspense>
              <ViewAsOffice
                offices={ALL_OFFICES}
                currentOffice={session.user.office}
              />
            </Suspense>
          </div>
        )}
      </div>
      {(viewAs && viewAs !== session.user.role) || viewAsOfficeValid ? (
        <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded space-x-2">
          {viewAs && viewAs !== session.user.role && (
            <span>
              Viewing as <span className="font-medium">{viewAs}</span> role
            </span>
          )}
          {viewAsOfficeValid && (
            <span>
              · Office: <span className="font-medium">{viewAsOfficeValid}</span>
            </span>
          )}
        </div>
      ) : null}
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
