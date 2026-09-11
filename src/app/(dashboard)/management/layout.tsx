import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { canAccessManagementPath } from "@/lib/auth/permissions";

// Server-side gate for the entire /management area. Anyone who is not an
// admin or manager-tier user gets a real 404 — the route is invisible to
// them, not merely inaccessible. All child routes share the same rule, so
// we probe with a representative subpath.
export default async function ManagementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) notFound();
  if (!canAccessManagementPath(session.user.role, "/management/timesheets")) {
    notFound();
  }
  return <>{children}</>;
}
