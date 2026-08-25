import { createAdminClient } from "@/lib/supabase/admin";
import { refreshQuoteFromAi } from "@/lib/quotes/refresh";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// DST-safe weekly refresh.
//
// vercel.json runs this DAILY at 13:00 UTC. During EST (Nov–Mar) that's
// 8 AM Eastern; during EDT (Mar–Nov) that's 9 AM Eastern. Since Vercel
// crons run in UTC only, we check the day-of-week in Eastern time here
// and only refresh when it's actually Monday in Eastern — that way DST
// transitions don't shift which day the quote rotates.
//
// We also guard against double-firing: if the current active quote was
// activated less than 6 days ago, we skip. That means a manual admin
// refresh on Monday won't get immediately overwritten by the cron.
function isEasternMonday(now: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "America/New_York",
  }).format(now);
  return weekday === "Mon";
}

function ageInDays(iso: string, now: Date): number {
  const t = new Date(iso).getTime();
  return (now.getTime() - t) / (1000 * 60 * 60 * 24);
}

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  // Vercel cron pings a route with a Bearer that matches CRON_SECRET when set,
  // OR sends x-vercel-cron: 1 for scheduled invocations. Accept either.
  if (req.headers.get("x-vercel-cron") === "1") return true;
  return false;
}

async function handle(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const now = new Date();

  if (!force && !isEasternMonday(now)) {
    return NextResponse.json({
      skipped: true,
      reason: "not-monday-eastern",
      at: now.toISOString(),
    });
  }

  const supabase = createAdminClient();
  const { data: active } = await supabase
    .from("launcher_motivational_quotes")
    .select("id, activated_at")
    .eq("is_active", true)
    .maybeSingle();

  if (!force && active?.activated_at && ageInDays(active.activated_at, now) < 6) {
    return NextResponse.json({
      skipped: true,
      reason: "active-quote-too-recent",
      active_id: active.id,
      activated_at: active.activated_at,
    });
  }

  try {
    const quote = await refreshQuoteFromAi({
      source: "ai_cron",
      createdBy: "cron",
    });
    return NextResponse.json({ refreshed: true, quote });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
