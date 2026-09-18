import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import {
  IncidentPanel,
  type IncidentSummary,
} from "@/components/features/incidents/IncidentPanel";

// Employee-facing view of their own incident reports. Server-fetches the
// initial list so the "awaiting signature" state is available on first paint;
// the panel then keeps its own state in sync via /api/incidents.
export default async function MyIncidentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const profileId = session.user.profileId;

  const supabase = createAdminClient();
  const [{ data: rows }, { data: profile }] = await Promise.all([
    supabase
      .from("incident_reports")
      .select(
        "id, title, severity, category, status, occurred_at, manager_signed_at, employee_signed_at, attachments, created_at",
      )
      .eq("employee_profile_id", profileId)
      .in("status", ["awaiting_employee_sig", "completed"])
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", profileId)
      .single(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Incident Reports</h1>
        <p className="text-muted-foreground">
          Review and sign incident reports issued to you.
        </p>
      </div>
      <IncidentPanel
        initialRows={(rows || []) as IncidentSummary[]}
        employeeFullName={profile?.full_name || session.user.name || null}
        description="Signing acknowledges receipt of the report — it does not indicate agreement."
      />
    </div>
  );
}
