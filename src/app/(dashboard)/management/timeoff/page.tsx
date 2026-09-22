import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope } from "@/lib/auth/permissions";
import { loadTimeoffQueue } from "@/lib/timeoff/queries";
import TimeOffShell from "./TimeOffShell";

// Server-rendered entry point for /management/timeoff. Pre-fetches the
// pending + approved + denied queue rows for the viewer's default scope
// so the queue tab paints with data on first load instead of a
// "Loading…" flash.
export default async function TimeOffManagementPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewTimeData(session.user.role)) redirect("/dashboard");

  const scope = timeDataScope(
    session.user.role,
    session.user.department,
    session.user.office,
  );
  if (!scope.allowed) {
    return <TimeOffShell initialQueueRows={[]} />;
  }

  const supabase = createAdminClient();
  const rows = await loadTimeoffQueue({
    supabase,
    scope: { department: scope.department, office: scope.office },
    statuses: ["pending", "approved", "denied"],
  });

  // Shape rows to the shell's Row shape — its `profile` field is an
  // optional narrower struct (email/name/office only, `undefined` when
  // absent). loadTimeoffQueue returns a superset with `null` fallback,
  // so we normalize at the boundary here.
  const initialQueueRows = rows.map((r) => ({
    ...r,
    profile: r.profile
      ? {
          email: r.profile.email,
          name: r.profile.name,
          office: r.profile.office,
        }
      : undefined,
  }));

  return <TimeOffShell initialQueueRows={initialQueueRows} />;
}
