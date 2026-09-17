import { auth } from "@/auth";
import { getMyScheduleToday } from "@/lib/timesheets/server";
import { NextResponse } from "next/server";

// Returns today's scheduled end time + any active extension. `effective_end`
// is the point the auto-clockout cron will fire at, and the point the client
// should count backwards from for the T-5 min "still working?" prompt.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await getMyScheduleToday(session.user.profileId);
  return NextResponse.json(data);
}
