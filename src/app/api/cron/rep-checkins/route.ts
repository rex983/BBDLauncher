import { createAdminClient } from "@/lib/supabase/admin";
import { localDateInZone, startOfDayInZone } from "@/lib/timesheets/tz";
import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron";
import { fetchAllPages } from "@/app/api/_lib/paged";
import { salesRepProfiles } from "@/lib/rep-checkins";

export const maxDuration = 60;

// Rep check-ins: runs every 5 minutes. A sales rep who's on the clock gets a
// bell notification 3 hours and 6 hours after their first clock-in of the
// day ("how's today going?"); the launcher pops it up (CheckInPrompt) and
// they look at their numbers or skip it. One of each a day; a checkpoint
// more than an hour old (the cron was down) is skipped, not sent late.
// Who counts as a sales rep: src/lib/rep-checkins.ts.

const CHECKPOINTS = [6, 3];
const HOUR = 3_600_000;

async function handle() {
  const supabase = createAdminClient();
  const now = new Date();
  const day = localDateInZone(now);
  const startOfDay = startOfDayInZone(now);

  // Today's punches, oldest first: the first clock_in and the latest event per person.
  const { data: punches, error: punchErr } = await fetchAllPages<{
    profile_id: string;
    event_type: string;
    occurred_at: string;
  }>((from, to) =>
    supabase
      .from("time_punches")
      .select("profile_id, event_type, occurred_at")
      .gte("occurred_at", startOfDay.toISOString())
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (punchErr) return NextResponse.json({ error: punchErr }, { status: 500 });

  const firstIn = new Map<string, number>();
  const latest = new Map<string, string>();
  for (const p of punches) {
    if (p.event_type === "clock_in" && !firstIn.has(p.profile_id)) firstIn.set(p.profile_id, Date.parse(p.occurred_at));
    latest.set(p.profile_id, p.event_type);
  }

  // Who's due: on the clock now, and within an hour past a checkpoint.
  const due = new Map<string, number>();
  for (const [profileId, since] of firstIn) {
    if (latest.get(profileId) === "clock_out") continue;
    const hours = (now.getTime() - since) / HOUR;
    const checkpoint = CHECKPOINTS.find((c) => hours >= c);
    if (checkpoint && hours < checkpoint + 1) due.set(profileId, checkpoint);
  }
  if (!due.size) return NextResponse.json({ ok: true, sent: 0, ran_at: now.toISOString() });

  const reps = new Set((await salesRepProfiles(supabase)).map((r) => r.id));
  for (const id of [...due.keys()]) if (!reps.has(id)) due.delete(id);
  if (!due.size) return NextResponse.json({ ok: true, sent: 0, ran_at: now.toISOString() });

  // Already sent today (dismissed ones too).
  const { data: sent, error: sentErr } = await supabase
    .from("notifications")
    .select("user_id, metadata")
    .eq("type", "rep_checkin")
    .in("user_id", [...due.keys()])
    .gte("created_at", startOfDay.toISOString());
  if (sentErr) return NextResponse.json({ error: sentErr.message }, { status: 500 });
  const already = new Set((sent ?? []).map((n) => `${n.user_id}|${(n.metadata as { checkpoint?: number } | null)?.checkpoint}`));

  const rows = [...due]
    .filter(([id, c]) => !already.has(`${id}|${c}`))
    .map(([id, c]) => ({
      user_id: id,
      type: "rep_checkin",
      title: `${c} hours in: how's today going?`,
      body: "Your numbers so far today against your goal. Take a look, or skip it.",
      href: `/dashboard?checkin=${c}`,
      metadata: { checkpoint: c, day },
    }));
  if (rows.length) {
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sent: rows.length, ran_at: now.toISOString() });
}

export const { GET, POST } = cronRoute(handle);
