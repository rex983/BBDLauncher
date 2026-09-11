import { createAdminClient } from "@/lib/supabase/admin";
import type { PunchEventType } from "@/lib/timesheets/state";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// Nightly force-signout.
//
// Two responsibilities:
//   1) Fire a clock_out punch for anyone whose latest event isn't a clock_out
//      (i.e. still clocked in, on lunch, or on a break). Timesheet totals
//      stop at midnight rather than running through the night.
//   2) Bump profiles.signed_out_at for every profile. The auth() jwt
//      callback compares this to token.iat and returns null when the
//      timestamp is newer — every outstanding launcher session is
//      invalidated. On the rep's next request they're bounced to /login.
//
// Downstream apps (asc-pricing, psb-pricing, etc.) keep their own JWTs
// until natural expiry; a rep with a stale app tab can still use that app
// until their app-side session runs out. Fresh launches require signing
// back into the launcher, then clocking in.

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization");
    if (header === `Bearer ${secret}`) return true;
  }
  // Vercel's scheduled invocations set this header instead of the Bearer.
  if (req.headers.get("x-vercel-cron") === "1") return true;
  return false;
}

async function handle(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  // Step 1: find the latest punch per profile (last 48h — anyone without a
  // punch in that window can't be on the clock).
  const { data: recent, error: recentErr } = await supabase
    .from("time_punches")
    .select("profile_id, event_type, occurred_at")
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false });

  if (recentErr) {
    return NextResponse.json({ error: recentErr.message }, { status: 500 });
  }

  const latest = new Map<string, PunchEventType>();
  for (const row of recent || []) {
    if (!latest.has(row.profile_id)) {
      latest.set(row.profile_id, row.event_type as PunchEventType);
    }
  }
  const stillOnClock: string[] = [];
  for (const [profile_id, eventType] of latest) {
    if (eventType !== "clock_out") stillOnClock.push(profile_id);
  }

  let clockedOut = 0;
  if (stillOnClock.length > 0) {
    const { error: insertErr } = await supabase.from("time_punches").insert(
      stillOnClock.map((profile_id) => ({
        profile_id,
        event_type: "clock_out",
        occurred_at: now.toISOString(),
        source: "admin_edit",
        note: "Auto clock-out by nightly cron",
      })),
    );
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    clockedOut = stillOnClock.length;
  }

  // Step 2: invalidate every launcher session. Any JWT issued before this
  // timestamp will be rejected by the jwt callback on next request.
  // Supabase requires a WHERE clause for UPDATE, so we filter on a
  // universally-true predicate.
  const { data: bumped, error: bumpErr } = await supabase
    .from("profiles")
    .update({ signed_out_at: now.toISOString() })
    .not("id", "is", null)
    .select("id");

  if (bumpErr) {
    return NextResponse.json({ error: bumpErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    clocked_out: clockedOut,
    sessions_invalidated: (bumped || []).length,
    ran_at: now.toISOString(),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
