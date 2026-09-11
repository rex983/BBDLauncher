import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Default: Mon-Fri 10:00-18:00 America/New_York.
const DEFAULT_SCHEDULE = {
  start_time: "10:00",
  end_time: "18:00",
  timezone: "America/New_York",
};
const DEFAULT_WORKDAYS = new Set([1, 2, 3, 4, 5]); // Mon-Fri

// Returns today's scheduled end time as an ISO string in local time zone,
// or null if the user isn't scheduled to work today.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const now = new Date();
  const weekday = now.getDay();

  const { data: override } = await supabase
    .from("work_schedules")
    .select("weekday, start_time, end_time, timezone")
    .eq("profile_id", session.user.profileId)
    .eq("weekday", weekday)
    .maybeSingle();

  // If there is ANY override row for this user, treat missing weekdays as
  // "not scheduled" (their overrides are the source of truth). Otherwise
  // fall back to default Mon-Fri 10-6.
  const { data: anyOverride } = await supabase
    .from("work_schedules")
    .select("weekday")
    .eq("profile_id", session.user.profileId)
    .limit(1);

  let start = DEFAULT_SCHEDULE.start_time;
  let end = DEFAULT_SCHEDULE.end_time;
  let scheduled = DEFAULT_WORKDAYS.has(weekday);

  if (override) {
    start = override.start_time.slice(0, 5);
    end = override.end_time.slice(0, 5);
    scheduled = true;
  } else if (anyOverride && anyOverride.length > 0) {
    scheduled = false;
  }

  // Build today's end-time ISO in local server tz (approximation of ET when
  // the server runs in ET; refined in v2 with real tz math).
  const [endH, endM] = end.split(":").map(Number);
  const endToday = new Date(now);
  endToday.setHours(endH, endM, 0, 0);

  return NextResponse.json({
    scheduled,
    start_time: start,
    end_time: end,
    end_of_day_iso: scheduled ? endToday.toISOString() : null,
  });
}
