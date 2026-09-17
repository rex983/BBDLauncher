import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SectionedAppGrid } from "@/components/features/launcher/sectioned-app-grid";
import { ImportantLinks } from "@/components/features/launcher/important-links";
import { ViewAsRole } from "@/components/features/launcher/view-as-role";
import { ViewAsOffice } from "@/components/features/launcher/view-as-office";
import { QuoteBanner } from "@/components/features/launcher/quote-banner";
import { TimeClockShell } from "@/components/features/timeclock/TimeClockShell";
import { canManageContent, isAdmin as isAdminRole } from "@/lib/auth/permissions";
import { getMyStateToday, getMyScheduleToday } from "@/lib/timesheets/server";
import { localDateInZone } from "@/lib/timesheets/tz";
import {
  getCachedApps,
  getCachedRoleAppAccess,
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
import type { TimeOffStatus, TimeOffType } from "@/lib/timeoff/types";

interface MyTimeOffRow {
  id: string;
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  status: TimeOffStatus;
}

const ALL_OFFICES: Office[] = ["Harbor", "Marion", "BST", "RnD"];

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
  let quote: MotivationalQuote | null = null;
  let effectiveRole = session.user.role;
  // TimeClockShell needs an initial state, schedule, and upcoming
  // time-off list so it doesn't flash a blank while three /api/timeclock/*
  // fetches resolve on every dashboard load.
  const profileId = session.user.profileId;
  const [timeclockRes, scheduleRes, upcomingTimeOffRes] = await Promise.all([
    getMyStateToday(profileId).catch(() => null),
    getMyScheduleToday(profileId).catch(() => null),
    (async () => {
      const supabase = createAdminClient();
      const today = localDateInZone(new Date());
      const { data } = await supabase
        .from("time_off_requests")
        .select("id, type, subcategory, start_date, end_date, full_day, hours, status")
        .eq("profile_id", profileId)
        .gte("end_date", today)
        .in("status", ["pending", "approved"])
        .order("start_date", { ascending: true });
      return (data || []) as MyTimeOffRow[];
    })().catch(() => [] as MyTimeOffRow[]),
  ]);
  const initialState = timeclockRes?.state ?? null;
  const initialSchedule = scheduleRes ?? null;
  const initialUpcomingTimeOff = upcomingTimeOffRes ?? [];
  try {
    // Everything below is cached (see src/lib/launcher/cache.ts). On a
    // cache hit this whole block is zero Supabase round-trips.
    const [allApps, accessRows, sectionsData, linksData, rolesData, quoteData] =
      await Promise.all([
        getCachedApps(),
        getCachedRoleAppAccess(),
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

    const roleAppIds = new Set(
      accessRows.filter((r) => r.role_name === effectiveRole).map((r) => r.app_id),
    );
    const roleFilteredApps = allApps
      .filter((a) => roleAppIds.has(a.id))
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

    apps = roleFilteredApps.filter((a) => appOfficesMatch(a.offices));
    sections = sectionsData;
    links = linksData.filter((l) => linkOfficeMatches(l.office));
    roles = rolesData;
    quote = quoteData;
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
      <QuoteBanner initial={quote} canRefresh={isAdminRole(session.user.role)} />
      {clock_required && (
        <div className="text-sm bg-yellow-50 dark:bg-yellow-950/40 text-yellow-900 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-900 px-3 py-2 rounded">
          You need to clock in before launching applications.
        </div>
      )}
      {/* Preview banner is rendered globally in (dashboard)/layout.tsx so
          it stays visible on every route while a preview is active. */}
      <TimeClockShell
        initialState={initialState}
        initialSchedule={initialSchedule}
        initialUpcomingTimeOff={initialUpcomingTimeOff}
      >
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
