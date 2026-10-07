import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { retiredMailAuthorized } from "@/lib/offboarding/retired-mail-health";
import { RETIRED_MAILBOX, mailboxInfo } from "@/lib/offboarding/mailboxes";

// The Apps Script checks in every few minutes (and reports its own errors),
// so /admin/email-monitor and the watchdog cron can tell when it has stopped.
const schema = z.object({
  // Which watched mailbox the script runs on. Older scripts on
  // retiredemployees@ don't send it.
  mailbox: z
    .string()
    .trim()
    .toLowerCase()
    .default(RETIRED_MAILBOX)
    .refine((m) => !!mailboxInfo(m), "Unknown mailbox"),
  error: z.string().max(1000).nullable().default(null),
});

export async function POST(req: NextRequest) {
  if (!retiredMailAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  const now = new Date().toISOString();
  const { mailbox, error: scriptError } = parsed.data;
  const { error } = await createAdminClient()
    .from("mail_monitor_mailboxes")
    .update(scriptError ? { last_error: scriptError, last_error_at: now } : { last_check_at: now })
    .eq("mailbox", mailbox);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
