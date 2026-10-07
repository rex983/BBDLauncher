import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SectionedAppGrid } from "@/components/features/launcher/sectioned-app-grid";
import { ImportantLinks } from "@/components/features/launcher/important-links";
import { ViewAsUser } from "@/components/features/launcher/view-as-user";
import type { PreviewUser } from "@/components/features/launcher/role-preview-context";
import { allowedAppIds, personalGrants } from "@/lib/launcher/access";
import { QuoteBanner } from "@/components/features/launcher/quote-banner";
import { TimeClockShell } from "@/components/features/timeclock/TimeClockShell";
import { canManageContent, isAdmin as isAdminRole } from "@/lib/auth/permissions";
import { getMyScheduleToday } from "@/lib/timesheets/server";
import {
  getCachedApps,
  getCachedRoleAppAccess,
  getCachedUserAccess,
  getCachedSections,
  getCachedLinks,
  getCachedRoles,
  getCachedActiveQuote,
} from "@/lib/launcher/cache";
import { redirect } from "next/navigation";
import type { LauncherApp, LauncherSection } from "@/types/app";
import type { ImportantLink } from "@/types/link";
import type { MotivationalQuote } from "@/types/quote";
import type { Office } from "@/types/auth";

// Everyone an admin can preview the launcher as.
async function loadPreviewUsers(): Promise<PreviewUser[]> {
  const [roles, { data }] = await Promise.all([
    getCachedRoles(),
    createAdminClient()
      .from("profiles")
      .select("id, full_name, email, role, office, department, can_offboard")
      .eq("is_active", true)
      .order("full_name"),
  ]);
  const label = new Map(roles.map((r) => [r.name, r.display_name]));
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name || p.email,
    role: p.role,
    role_label: label.get(p.role) ?? p.role,
    office: p.office,
    department: p.department,
    can_offboard: !!p.can_offboard,
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
  const isAdmin = session.user.role === "admin";
  const canEditDashboard = canManageContent(session.user.role);

  let apps: LauncherApp[] = [];
  let sections: LauncherSection[] = [];
  let links: ImportantLink[] = [];
  let previewUsers: PreviewUser[] = [];
  let quote: MotivationalQuote | null = null;
  // Server-fetch today's schedule so TimeClockShell's "Scheduled until"
  // label paints on the first frame. Live clock state comes from
  // <ClockGate> in the layout.
  // Started now, awaited below, so it overlaps the cached launcher reads.
  const schedulePromise = getMyScheduleToday(session.user.profileId).catch(() => null);
  try {
    // Everything below is cached (see src/lib/launcher/cache.ts). On a
    // cache hit this whole block is zero Supabase round-trips, apart from
    // the people list admins get for View as.
    const [allApps, accessRows, userAccessRows, sectionsData, linksData, people, quoteData] =
      await Promise.all([
        getCachedApps(),
        getCachedRoleAppAccess(),
        getCachedUserAccess(),
        getCachedSections(),
        getCachedLinks(),
        isAdmin ? loadPreviewUsers() : Promise.resolve([] as PreviewUser[]),
        getCachedActiveQuote(),
      ]);
    previewUsers = people;

    // View as: an admin sees exactly what that person sees — their role,
    // their office and anything granted to them by name. Only ids from the
    // active-people list are honoured.
    const target = (isAdmin && viewAsUser && previewUsers.find((u) => u.id === viewAsUser)) || null;
    const effectiveRole = target?.role ?? session.user.role;
    const effectiveOffice = (target ? target.office : session.user.office) as Office | null;
    const bypassOffice = effectiveRole === "admin";

    // Office × role grid (migration 034). Admins skip the office part.
    const roleAppIds = allowedAppIds(accessRows, effectiveRole, effectiveOffice, bypassOffice);
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
    links = linksData.filter(
      (l) => mine.links.has(l.id) || bypassOffice || (!l.people_only && linkOfficeMatches(l.office)),
    );
    quote = quoteData;
  } catch (err) {
    console.error("Dashboard data fetch error:", err);
  }

  const initialSchedule = await schedulePromise;

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
            <ViewAsUser users={previewUsers} selfId={session.user.profileId} />
          </div>
        )}
      </div>
      <QuoteBanner initial={quote} canRefresh={isAdminRole(session.user.role)} />
      {clock_required && (
        <div className="text-sm bg-yellow-50 dark:bg-yellow-950/40 text-yellow-900 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-900 px-3 py-2 rounded">
          You need to clock in before launching applications.
        </div>
      )}
      {/* Preview banner is rendered globally in (dashboard)/layout.tsx so
          it stays visible on every route while a preview is active. */}
      <TimeClockShell initialSchedule={initialSchedule}>
        <SectionedAppGrid apps={apps} sections={sections} isAdmin={canEditDashboard} />
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
