import { SessionProvider } from "next-auth/react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { RolePreviewProvider } from "@/components/features/launcher/role-preview-context";
import { PreviewBanner } from "@/components/features/launcher/preview-banner";
import { ClockGate } from "@/components/features/timeclock/ClockGate";
import { ShiftEndPrompt } from "@/components/features/timeclock/ShiftEndPrompt";
import { Suspense } from "react";
import { auth } from "@/auth";
import { getMyStateToday } from "@/lib/timesheets/server";

function SidebarSkeleton() {
  return <aside className="w-64 border-r bg-background min-h-[calc(100vh-4rem)]" />;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Hydrate the clock gate server-side so it paints the right state on the
  // first frame (no flash of the app before the clocked-out overlay).
  const session = await auth();
  const clock = session?.user?.profileId
    ? await getMyStateToday(session.user.profileId).catch(() => null)
    : null;

  return (
    <SessionProvider>
      <Suspense>
        <RolePreviewProvider>
          <ClockGate initialState={clock?.state ?? null}>
            <div className="min-h-screen bg-background">
              <Header />
              <div className="flex">
                <Suspense fallback={<SidebarSkeleton />}>
                  <Sidebar />
                </Suspense>
                <main className="flex-1 p-6">
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
