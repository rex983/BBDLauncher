import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { canViewTimeData } from "@/lib/auth/permissions";

// Server-side gate for /analytics. Anyone without time-data view access
// gets a real 404. Matches the /management pattern.
export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) notFound();
  if (!canViewTimeData(session.user.role)) notFound();
  return <>{children}</>;
}
