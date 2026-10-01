import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SectionedAppGrid } from "@/components/features/launcher/sectioned-app-grid";
import { ImportantLinks } from "@/components/features/launcher/important-links";
import { ViewAsRole } from "@/components/features/launcher/view-as-role";
import { ViewAsOffice } from "@/components/features/launcher/view-as-office";
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
import { Suspense } from "react";
import type { LauncherApp, LauncherSection } from "@/types/app";
import type { ImportantLink } from "@/types/link";
import type { MotivationalQuote } from "@/types/quote";
import type { Office } from "@/types/auth";
import { OFFICES, VALID_OFFICES } from "@/lib/org/constants";


export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string; viewAsOffice?: string; clock_required?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { viewAs, viewAsOffice, clock_required } = await searchParams;
  const isAdmin = session.user.role === "admin";
  const canEditDashboard = canManageContent(session.user.role);
  const userOffice = session.user.office;
  const viewAsOfficeValid =
    isAdmin && viewAsOffice && VALID_OFFICES.has(viewAsOffice)
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
  let quote: MotivationalQuote | null = null;
  let effectiveRole = session.user.role;
  // Server-fetch today's schedule so TimeClockShell's "Scheduled until"
  // label paints on the first frame. Live clock state comes from
  // <ClockGate> in the layout.
  // Started now, awaited below, so it overlaps the cached launcher reads.
  const schedulePromise = getMyScheduleToday(session.user.profileId).catch(() => null);
  try {
    // Everything below is cached (see src/lib/launcher/cache.ts). On a
    // cache hit this whole block is zero Supabase round-trips.
    const [allApps, accessRows, userAccessRows, sectionsData, linksData, rolesData, quoteData] =
      await Promise.all([
        getCachedApps(),
        getCachedRoleAppAccess(),
        getCachedUserAccess(),
        getCachedSections(),
        getCachedLinks(),
        isAdmin ? getCachedRoles() : Promise.resolve([] as { name: string; display_name: string }[]),
        getCachedActiveQuote(),
      ]);

    // Resolve view-as role by consulting the cached roles list rather
    // than a fresh query — an arbitrary URL string must not be able to
    // flow into DB filters or (worse) UI hints, so we still validate.
    if (isAdmin && viewAs) {
      if (rolesData.some((r) => r.name === viewAs)) {
        effectiveRole = viewAs;
      } else {
        // Non-admin roles list is empty (`getCachedRoles` only runs for
        // admins here). Fall through to a direct check for that case —
        // paranoia only; admins already have rolesData populated above.
        const supabase = createAdminClient();
        const { data: validRole } = await supabase
          .from("launcher_roles")
          .select("name")
          .eq("name", viewAs)
          .maybeSingle();
        if (validRole?.name) effectiveRole = validRole.name;
      }
    }

    // Office × role grid (migration 034). Admins skip the office part unless
    // they've pinned a view-as office.
    const roleAppIds = allowedAppIds(accessRows, effectiveRole, effectiveOffice, bypassOffice);
    // Apps and links granted to this person by name (migration 040). Left out
    // while an admin previews another role or office — those are about what
    // the role/office sees.
    const previewing = effectiveRole !== session.user.role || !!viewAsOfficeValid;
    const mine = previewing
      ? { apps: new Set<string>(), links: new Set<string>() }
      : personalGrants(userAccessRows, session.user.profileId);

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
    roles = rolesData;
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
            {roles.length > 0 && (
              <Suspense>
                <ViewAsRole roles={roles} currentRole={session.user.role} />
              </Suspense>
            )}
            <Suspense>
              <ViewAsOffice
                offices={OFFICES}
                currentOffice={session.user.office}
              />
            </Suspense>
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
