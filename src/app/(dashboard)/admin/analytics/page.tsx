import { auth } from "@/auth";
import { analyticsScope } from "@/lib/auth/permissions";
import {
  getLauncherAnalytics,
  isAnalyticsRange,
  type AnalyticsData,
  type AnalyticsRange,
} from "@/lib/analytics/server";
import AnalyticsShell from "@/components/features/admin/AnalyticsShell";

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rawRange } = await searchParams;
  const range: AnalyticsRange = isAnalyticsRange(rawRange) ? rawRange : "30d";

  const session = await auth();
  const scope = analyticsScope(session?.user?.role, session?.user?.office ?? null);

  let initialData: AnalyticsData | null = null;
  let initialError: string | null = null;

  if (!session?.user || !scope.allowed) {
    initialError = "Unauthorized";
  } else {
    try {
      initialData = await getLauncherAnalytics(range, { office: scope.office });
    } catch (err) {
      console.error("Analytics error:", err);
      initialError = err instanceof Error ? err.message : "Analytics failed";
    }
  }

  return (
    <AnalyticsShell
      initialData={initialData}
      initialRange={range}
      initialError={initialError}
    />
  );
}
