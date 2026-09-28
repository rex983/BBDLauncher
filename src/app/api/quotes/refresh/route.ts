import { isAdmin } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/auth/require-session";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { refreshQuoteFromAi } from "@/lib/quotes/refresh";
import { NextResponse } from "next/server";

export const maxDuration = 30;

// Admin-only manual "generate a new quote" trigger. Same code path the cron
// uses, but source is tagged 'ai_manual' so we can distinguish in history.
export async function POST() {
  const session = await requireSession(isAdmin);
  if (session instanceof NextResponse) return session;

  try {
    const quote = await refreshQuoteFromAi({
      source: "ai_manual",
      createdBy: session.user.email ?? null,
    });
    bustLauncherCache("quotes");
    return NextResponse.json(quote);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh quote" },
      { status: 500 }
    );
  }
}
