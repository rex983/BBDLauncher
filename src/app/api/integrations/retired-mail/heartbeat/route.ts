import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { retiredMailAuthorized } from "@/lib/offboarding/retired-mail-health";

// The Apps Script checks in every few minutes (and reports its own errors),
// so /admin/retired-mail and the watchdog cron can tell when it has stopped.
const schema = z.object({ error: z.string().max(1000).nullable().default(null) });

export async function POST(req: NextRequest) {
  if (!retiredMailAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("retired_mail_heartbeat")
    .update(parsed.data.error ? { last_error: parsed.data.error, last_error_at: now } : { last_check_at: now })
    .eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
