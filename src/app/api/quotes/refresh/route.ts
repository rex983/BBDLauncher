import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { refreshQuoteFromAi } from "@/lib/quotes/refresh";
import { NextResponse } from "next/server";

export const maxDuration = 30;

// Admin-only manual "generate a new quote" trigger. Same code path the cron
// uses, but source is tagged 'ai_manual' so we can distinguish in history.
export async function POST() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const quote = await refreshQuoteFromAi({
      source: "ai_manual",
      createdBy: session.user.email ?? null,
    });
    return NextResponse.json(quote);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to refresh quote" },
      { status: 500 }
    );
  }
}
