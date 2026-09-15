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

// Returns today's scheduled end time + any active extension. `effective_end`
// is the point the auto-clockout cron will fire at, and the point the client
// should count backwards from for the T-5 min "still working?" prompt.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const now = new Date();
  const weekday = now.getDay();

  const [overrideRes, anyOverrideRes, extensionRes] = await Promise.all([
    supabase
      .from("work_schedules")
      .select("weekday, start_time, end_time, timezone")
      .eq("profile_id", session.user.profileId)
      .eq("weekday", weekday)
      .maybeSingle(),
    supabase
      .from("work_schedules")
      .select("weekday")
      .eq("profile_id", session.user.profileId)
      .limit(1),
    supabase
      .from("time_extensions")
      .select("extension_until, requested_minutes")
      .eq("profile_id", session.user.profileId)
      .eq("local_date", toLocalDate(now))
      .maybeSingle(),
  ]);

  const override = overrideRes.data;
  const anyOverride = anyOverrideRes.data;
  const extension = extensionRes.data;

  // If there is ANY override row for this user, treat missing weekdays as
  // "not scheduled" (their overrides are the source of truth). Otherwise
  // fall back to default Mon-Fri 10-6.
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

  const [endH, endM] = end.split(":").map(Number);
  const endToday = new Date(now);
  endToday.setHours(endH, endM, 0, 0);

  const scheduledEndIso = scheduled ? endToday.toISOString() : null;
  const extensionUntilIso = extension?.extension_until ?? null;
  const effectiveEndIso =
    extensionUntilIso && scheduledEndIso
      ? new Date(extensionUntilIso) > new Date(scheduledEndIso)
        ? extensionUntilIso
        : scheduledEndIso
      : extensionUntilIso ?? scheduledEndIso;

  return NextResponse.json({
    scheduled,
    start_time: start,
    end_time: end,
    end_of_day_iso: scheduledEndIso,
    extension_until_iso: extensionUntilIso,
    effective_end_iso: effectiveEndIso,
  });
}

function toLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
