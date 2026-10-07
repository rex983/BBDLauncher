import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRetiredMail } from "@/lib/offboarding/retired-mail";
import { retiredMailAuthorized } from "@/lib/offboarding/retired-mail-health";
import { RETIRED_MAILBOX, mailboxInfo } from "@/lib/offboarding/mailboxes";

// Called by the Apps Script on each watched mailbox for every new email.
// Server-to-server only: authenticated by the shared RETIRED_MAIL_SECRET.

const schema = z.object({
  // Which watched mailbox the script runs on. Older scripts on
  // retiredemployees@ don't send it.
  mailbox: z
    .string()
    .trim()
    .toLowerCase()
    .default(RETIRED_MAILBOX)
    .refine((m) => !!mailboxInfo(m), "Unknown mailbox"),
  message_id: z.string().min(1).max(200),
  from: z.string().max(500).default(""),
  subject: z.string().max(1000).default(""),
  preview: z.string().max(5000).default(""),
  recipients: z.array(z.string().max(2000)).max(20).default([]),
  // Bulk-mail headers (List-Unsubscribe, Precedence, …) and Gmail's tab,
  // used by the spam check. Older scripts don't send them.
  headers: z.record(z.string().max(100), z.string().max(2000)).default({}),
  category: z.string().max(30).nullable().default(null),
});

export async function POST(req: NextRequest) {
  if (!retiredMailAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  const result = await handleRetiredMail(parsed.data);
  return NextResponse.json({ ok: true, ...result });
}
