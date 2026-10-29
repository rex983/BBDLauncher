import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SectionedAppGrid } from "@/components/features/launcher/sectioned-app-grid";
import { ImportantLinks } from "@/components/features/launcher/important-links";
import { ViewAsUser } from "@/components/features/launcher/view-as-user";
import type { PreviewUser } from "@/components/features/launcher/role-preview-context";
import { allowedAppIds, personalGrants } from "@/lib/launcher/access";
import { QuoteBanner } from "@/components/features/launcher/quote-banner";
import { TimeClockShell } from "@/components/features/timeclock/TimeClockShell";
import {
  MANAGER_TIER_ROLES,
  canManageContent,
  isAdmin as isAdminRole,
  isAppsOnlyRole,
  permRoleFor,
} from "@/lib/auth/permissions";
import { viewAsTargets } from "@/lib/launcher/view-as";
import { getOfficeNames } from "@/lib/org/lists";
import {
  getCachedApps,
  getCachedRoleAppAccess,
  getCachedUserAccess,
  getCachedSections,
  getCachedLinks,
  getCachedRoles,
  getCachedActiveQuote,
  LAUNCHER_TAGS,
} from "@/lib/launcher/cache";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import type { LauncherApp, LauncherSection } from "@/types/app";
import type { ImportantLink } from "@/types/link";
import type { MotivationalQuote } from "@/types/quote";

// Active people for View as. Nothing busts this — a new or offboarded
// person shows up (or drops off) within a minute.
const getCachedPreviewProfiles = unstable_cache(
  async () => {
    const { data } = await createAdminClient()
      .from("profiles")
      .select("id, full_name, email, role, office, department, can_offboard")
      .eq("is_active", true)
      .order("full_name");
    return data ?? [];
  },
  ["launcher-preview-users"],
  { tags: [LAUNCHER_TAGS.previewUsers], revalidate: 60 },
);

// The people this viewer may View as (migration 052), plus themselves (the
// "(you)" row exits the preview). Admins: every active person, no RPC
// needed. Managers: whoever launcher_view_as_targets returns — none if it
// fails. Anyone else: nobody.
async function loadPreviewUsers(
  viewer: { profileId: string; role: string; permRole: string },
): Promise<PreviewUser[]> {
  const admin = viewer.role === "admin";
  const manager = !admin && MANAGER_TIER_ROLES.has(viewer.permRole);
  if (!admin && !manager) return [];
  const [roles, data, targets] = await Promise.all([
    getCachedRoles(),
    getCachedPreviewProfiles(),
    manager ? viewAsTargets(viewer.profileId) : Promise.resolve(null),
  ]);
  if (targets && targets.size === 0) return [];
  const label = new Map(roles.map((r) => [r.name, r.display_name]));
  return data
    .filter((p) => !targets || p.id === viewer.profileId || targets.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.full_name || p.email,
      role: p.role,
      perm_role: permRoleFor(p.role, roles),
      role_label: label.get(p.role) ?? p.role,
      office: p.office,
      department: p.department,
      can_offboard: !!p.can_offboard,
      apps_only: isAppsOnlyRole(p.role, roles),
    }));
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAsUser?: string; clock_required?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { viewAsUser, clock_required } = await searchParams;

  let apps: LauncherApp[] = [];
  let sections: LauncherSection[] = [];
  let links: ImportantLink[] = [];
  let previewUsers: PreviewUser[] = [];
  let quote: MotivationalQuote | null = null;
  // Who the page is for: the signed-in person, or whoever they're viewing as.
  let target: PreviewUser | null = null;
  // "Apps only" roles (migration 062): granted apps + the time clock only.
  let appsOnly = session.user.appsOnly;
  try {
    // Everything below is cached (see src/lib/launcher/cache.ts). On a
    // cache hit this whole block is zero Supabase round-trips (the View as
    // people list is cached for a minute).
    const [allApps, accessRows, userAccessRows, sectionsData, linksData, people, quoteData, officeNames] =
      await Promise.all([
        getCachedApps(),
        getCachedRoleAppAccess(),
        getCachedUserAccess(),
        getCachedSections(),
        getCachedLinks(),
        loadPreviewUsers(session.user),
        getCachedActiveQuote(),
        getOfficeNames(),
      ]);
    previewUsers = people;

    // View as: an admin or manager sees exactly what that person sees —
    // their role, their office and anything granted to them by name. Only
    // ids from this viewer's own View as list (above) are honoured.
    target =
      (viewAsUser &&
        viewAsUser !== session.user.profileId &&
        previewUsers.find((u) => u.id === viewAsUser)) ||
      null;
    const effectiveRole = target?.role ?? session.user.role;
    if (target) appsOnly = target.apps_only;
    const effectiveOffice = target ? target.office : session.user.office;
    const bypassOffice = effectiveRole === "admin";

    // Office × role grid (migration 034). Admins skip the office part.
    const roleAppIds = allowedAppIds(accessRows, effectiveRole, effectiveOffice, officeNames, bypassOffice);
    // Apps and links granted to this person by name (migration 040).
    const mine = personalGrants(userAccessRows, target?.id ?? session.user.profileId);

    // Links keep their single-office filter; people-only links show just to
    // their people (and admins). Apps: the old per-app office list still
    // applies as a second gate (the grid already encodes it; saving an app's
    // grid clears it), so old and new code agree whatever ships first.
    const linkOfficeMatches = (office: string | null) =>
      bypassOffice || !office || office === effectiveOffice;
    const appOfficesMatch = (offices: string[] | null) =>
      bypassOffice ||
      !offices ||
      offices.length === 0 ||
      (effectiveOffice ? offices.includes(effectiveOffice) : false);

    apps = allApps.filter(
      (a) => mine.apps.has(a.id) || (roleAppIds.has(a.id) && appOfficesMatch(a.offices)),
    );
    sections = sectionsData;
    links = appsOnly
      ? []
      : linksData.filter(
          (l) => mine.links.has(l.id) || bypassOffice || (!l.people_only && linkOfficeMatches(l.office)),
        );
    quote = appsOnly ? null : quoteData;
  } catch (err) {
    console.error("Dashboard data fetch error:", err);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Applications</h1>
          <p className="text-muted-foreground">
            Welcome back, {target ? target.name : session.user.name || session.user.email}
          </p>
        </div>
        {previewUsers.some((u) => u.id !== session.user.profileId) && (
          <div className="flex items-center gap-2">
            <ViewAsUser users={previewUsers} selfId={session.user.profileId} />
          </div>
        )}
      </div>
      {!appsOnly && (
        <QuoteBanner initial={quote} canRefresh={isAdminRole(target ? target.role : session.user.role)} />
      )}
      {clock_required && (
        <div className="text-sm bg-yellow-50 dark:bg-yellow-950/40 text-yellow-900 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-900 px-3 py-2 rounded">
          You need to clock in before launching applications.
        </div>
      )}
      {/* Preview banner is rendered globally in (dashboard)/layout.tsx so
          it stays visible on every route while a preview is active. */}
      <TimeClockShell>
        <SectionedAppGrid
          apps={apps}
          sections={sections}
          isAdmin={canManageContent(target ? target.perm_role : session.user.permRole)}
        />
        {links.length > 0 && (
          <>
            <hr className="border-border" />
            <ImportantLinks links={links} />
          </>
        )}
      </TimeClockShell>
    </div>
  );
}
