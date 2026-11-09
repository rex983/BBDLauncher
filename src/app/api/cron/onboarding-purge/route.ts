import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron";
import { purgeExpired } from "@/lib/onboarding/service";

export const maxDuration = 60;

// Hourly: onboarding requests delete themselves 7 days after they were
// opened (row, documents, bell notifications). Reads already hide expired
// rows, so this is the cleanup, not the only guard.
async function handle() {
  const purged = await purgeExpired();
  return NextResponse.json({ ok: true, purged, ran_at: new Date().toISOString() });
}

export const { GET, POST } = cronRoute(handle);
