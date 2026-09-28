import { createAdminClient } from "@/lib/supabase/admin";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { refreshQuoteFromAi } from "@/lib/quotes/refresh";
import { NextRequest, NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron";

export const maxDuration = 60;

// Weekly refresh. vercel.json runs this every Monday at 13:00 UTC
// (8 AM Eastern in winter / 9 AM Eastern in summer — cron day-of-week
// doesn't shift with DST at this hour).
//
// We still guard against double-firing: if the current active quote was
// activated less than 6 days ago (e.g. an admin manually refreshed on
// Sunday), we skip the cron.
function ageInDays(iso: string, now: Date): number {
  const t = new Date(iso).getTime();
  return (now.getTime() - t) / (1000 * 60 * 60 * 24);
}

async function handle(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const now = new Date();

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
    bustLauncherCache("quotes");
    return NextResponse.json({ refreshed: true, quote });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}

export const { GET, POST } = cronRoute(handle);
