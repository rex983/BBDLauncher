import { SessionProvider } from "next-auth/react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { RolePreviewProvider } from "@/components/features/launcher/role-preview-context";
import { PreviewBanner } from "@/components/features/launcher/preview-banner";
import { ClockGate } from "@/components/features/timeclock/ClockGate";
import { ShiftEndPrompt } from "@/components/features/timeclock/ShiftEndPrompt";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { cn } from "@/lib/utils";
import { auth } from "@/auth";
import { getMyStateToday } from "@/lib/timesheets/server";
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
  const [clock, cookieStore] = await Promise.all([
    session?.user?.profileId
      ? getMyStateToday(session.user.profileId).catch(() => null)
      : null,
    cookies(),
  ]);
  const sidebarState = parseSidebarState(cookieStore.get(SIDEBAR_COOKIE)?.value);

  return (
    <SessionProvider>
      <Suspense>
        <RolePreviewProvider>
          <ClockGate initialState={clock?.state ?? null}>
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
