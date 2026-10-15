import { SessionProvider } from "next-auth/react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { RolePreviewProvider } from "@/components/features/launcher/role-preview-context";
import { PreviewBanner } from "@/components/features/launcher/preview-banner";
import { Tracker } from "@/components/analytics-tracker";
import { ClockGate } from "@/components/features/timeclock/ClockGate";
import { ShiftEndPrompt } from "@/components/features/timeclock/ShiftEndPrompt";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { auth } from "@/auth";
import { getMyScheduleToday, getMyStateToday } from "@/lib/timesheets/server";
import { SIDEBAR_COOKIE, parseSidebarState } from "@/components/layout/sidebar-state";

function SidebarSkeleton({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cn(
        "shrink-0 border-r bg-background min-h-[calc(100vh-4rem)]",
        collapsed ? "w-16" : "w-60",
      )}
    />
  );
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hydrate the clock gate server-side so it paints the right state on the
  // first frame (no flash of the app before the clocked-out overlay).
  const session = await auth();
  // Middleware only checks that a session cookie exists; auth() is what
  // notices a deactivated or signed-out account.
  if (!session?.user) redirect("/login");
  const profileId = session?.user?.profileId;
  const [clock, schedule, cookieStore] = await Promise.all([
    profileId ? getMyStateToday(profileId).catch(() => null) : null,
    profileId ? getMyScheduleToday(profileId).catch(() => null) : null,
    cookies(),
  ]);
  const sidebarState = parseSidebarState(cookieStore.get(SIDEBAR_COOKIE)?.value);

  return (
    // The server already has the session: hand it over instead of letting the
    // client fetch /api/auth/session on mount and again on every tab focus
    // (each one a profiles read, and the sidebar's admin sections popped in
    // late while it loaded).
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <Tracker />
      <Suspense>
        <RolePreviewProvider>
          <ClockGate initialState={clock?.state ?? null} initialSchedule={schedule}>
            <div className="min-h-screen bg-background">
              <Header />
              <div className="flex">
                <Suspense fallback={<SidebarSkeleton collapsed={sidebarState.collapsed} />}>
                  <Sidebar initialState={sidebarState} />
                </Suspense>
                <main className="min-w-0 flex-1 p-6">
                  <PreviewBanner />
                  {children}
                </main>
              </div>
            </div>
            <ShiftEndPrompt />
          </ClockGate>
        </RolePreviewProvider>
      </Suspense>
    </SessionProvider>
  );
}
