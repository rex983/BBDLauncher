import { auth } from "@/auth";
import {
  coerceDays,
  getEmployeeDetail,
  type EmployeeDetailData,
} from "@/lib/timesheets/detail";
import EmployeeDetailShell from "@/components/features/timesheets/EmployeeDetailShell";

// Server-hydrate the first payload so the page renders with punches +
// time-off already resolved. Days-selector changes and add/edit/delete
// still round-trip through /api/management/timesheets/employee/[profileId]
// via the client shell.
export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { profileId } = await params;
  const { days: rawDays } = await searchParams;
  const days = coerceDays(rawDays);

  const session = await auth();

  let initialData: EmployeeDetailData | null = null;
  let initialError: string | null = null;

  if (!session?.user?.profileId) {
    initialError = "Unauthorized";
  } else {
    try {
      const result = await getEmployeeDetail(
        profileId,
        days,
        session.user.profileId,
        session.user.role ?? "",
        session.user.department ?? null,
        session.user.office ?? null,
      );
      if (result.ok) {
        initialData = result.data;
      } else {
        initialError = result.message;
      }
    } catch (err) {
      console.error("Employee detail hydration error:", err);
      initialError = err instanceof Error ? err.message : "Failed to load";
    }
  }

  return (
    <EmployeeDetailShell
      profileId={profileId}
      initialDays={days}
      initialData={initialData}
      initialError={initialError}
    />
  );
}
