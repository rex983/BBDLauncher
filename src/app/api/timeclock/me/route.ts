import { auth } from "@/auth";
import { getMyScheduleToday, getMyStateToday } from "@/lib/timesheets/server";
import { NextResponse } from "next/server";

// Live clock state plus today's schedule (effective end = when the
// auto-clockout cron fires and what the T-5 min prompt counts back from).
// One request so <ClockGate> refreshes both on tab focus.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ state }, schedule] = await Promise.all([
    getMyStateToday(session.user.profileId),
    getMyScheduleToday(session.user.profileId),
  ]);
  return NextResponse.json({ state, schedule });
}
