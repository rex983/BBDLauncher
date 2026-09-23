import { SessionProvider } from "next-auth/react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { RolePreviewProvider } from "@/components/features/launcher/role-preview-context";
import { PreviewBanner } from "@/components/features/launcher/preview-banner";
import { ClockGate } from "@/components/features/timeclock/ClockGate";
import { ShiftEndPrompt } from "@/components/features/timeclock/ShiftEndPrompt";
import { Suspense } from "react";

function SidebarSkeleton() {
  return <aside className="w-64 border-r bg-background min-h-[calc(100vh-4rem)]" />;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <Suspense>
        <RolePreviewProvider>
          <ClockGate>
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
