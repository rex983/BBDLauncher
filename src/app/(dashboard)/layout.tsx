import { SessionProvider } from "next-auth/react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
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
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex">
          <Suspense fallback={<SidebarSkeleton />}>
            <Sidebar />
          </Suspense>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
