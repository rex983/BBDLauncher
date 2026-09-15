import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/permissions";
import type { PunchEventType } from "@/lib/timesheets/state";
import {
  localDateInZone,
  scheduledTimeInZone,
  startOfDayInZone,
} from "@/lib/timesheets/tz";
import { NextResponse } from "next/server";

// One-shot cleanup for historical stranded clock-ins: for every ET-local
// day that ended without a matching clock_out, insert a clock_out at
// 23:59:59.999 ET of that day. Idempotent — re-running does nothing on
// days already closed. Admin-only.
//
// This exists because the midnight-signout cron was silently redirected
// to /login by middleware for a stretch of time, so open shifts from
// those days never got closed and now show as 90h+ weeks.
export async function POST() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const startOfToday = startOfDayInZone(now);

  // Scan the last 60 days — plenty of runway without pulling the entire
  // history. Anything older than 60d is either already closed or lost.
  const scanFrom = new Date(startOfToday.getTime() - 60 * 24 * 60 * 60 * 1000);
  const { data: punches, error } = await supabase
    .from("time_punches")
    .select("profile_id, event_type, occurred_at")
    .gte("occurred_at", scanFrom.toISOString())
    .lt("occurred_at", startOfToday.toISOString())
    .order("occurred_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group by (profile_id, ET-local day) and record the latest event per group.
  interface DayInfo {
    profile_id: string;
    day: string;
    latestType: PunchEventType;
  }
  const byKey = new Map<string, DayInfo>();
  for (const p of punches || []) {
    const day = localDateInZone(new Date(p.occurred_at));
    const key = `${p.profile_id}|${day}`;
    byKey.set(key, {
      profile_id: p.profile_id,
      day,
      latestType: p.event_type as PunchEventType,
    });
  }

  const toInsert: { profile_id: string; occurred_at: string }[] = [];
  for (const info of byKey.values()) {
    if (info.latestType === "clock_out") continue;
    // 23:59:59.999 ET of that day.
    const [y, m, d] = info.day.split("-").map(Number);
    const nextDayNoon = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
    const nextDayMidnight = scheduledTimeInZone(nextDayNoon, "00:00");
    const endOfDay = new Date(nextDayMidnight.getTime() - 1);
    toInsert.push({
      profile_id: info.profile_id,
      occurred_at: endOfDay.toISOString(),
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, scanned_days: byKey.size });
  }

  const { error: insertErr } = await supabase.from("time_punches").insert(
    toInsert.map((row) => ({
      profile_id: row.profile_id,
      event_type: "clock_out",
      occurred_at: row.occurred_at,
      source: "auto",
      note: "Backfill clock_out (stranded shift)",
      edited_by: session.user.profileId,
    })),
  );
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    inserted: toInsert.length,
    scanned_days: byKey.size,
    scanned_from: scanFrom.toISOString(),
    scanned_to: startOfToday.toISOString(),
  });
}
