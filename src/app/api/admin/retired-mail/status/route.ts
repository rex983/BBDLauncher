import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { isAdmin } from "@/lib/auth/permissions";
import { loadRetiredMailHealth } from "@/lib/offboarding/retired-mail-health";

// Sidebar badge: how many retired-mail health checks are failing.
export async function GET() {
  const session = await requireSession(isAdmin);
  if (session instanceof NextResponse) return session;
  const health = await loadRetiredMailHealth();
  return NextResponse.json({ count: health.problems });
}
