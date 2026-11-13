import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron";
import { wipeClosedPasswords } from "@/lib/onboarding/service";

export const maxDuration = 60;

// Hourly: onboarding requests move to Closed 30 days after they were opened
// and are kept. This only wipes a password nobody viewed once its request
// has closed. (Path kept from when it deleted requests.)
async function handle() {
  const wiped = await wipeClosedPasswords();
  return NextResponse.json({ ok: true, wiped, ran_at: new Date().toISOString() });
}

export const { GET, POST } = cronRoute(handle);
