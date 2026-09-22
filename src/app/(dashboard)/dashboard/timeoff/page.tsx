import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TimeOffPanel,
  type TimeOffRequest,
} from "@/components/features/timeoff/TimeOffPanel";

// Server-render the viewer's time-off list so the panel paints with data
// on first load — mirrors /dashboard/incidents and the profile page.
export default async function MyTimeOffPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("time_off_requests")
    .select(
      "id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_at, created_at, attachments",
    )
    .eq("profile_id", session.user.profileId)
    .order("start_date", { ascending: false });

  const initialRequests = (data || []) as TimeOffRequest[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Time Off</h1>
        <p className="text-muted-foreground">
          Submit vacation, sick, personal, or parental leave requests.
        </p>
      </div>
      <TimeOffPanel title="Requests" initialRequests={initialRequests} />
    </div>
  );
}
