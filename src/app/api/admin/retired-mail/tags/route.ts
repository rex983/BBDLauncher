import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { mailboxInfo } from "@/lib/offboarding/mailboxes";

// Who gets tagged in Slack for a mailbox's alerts.
const schema = z.object({
  mailbox: z.string().refine((m) => !!mailboxInfo(m), "Unknown mailbox"),
  profile_ids: z.array(z.uuid()).max(200),
});

export async function POST(req: NextRequest) {
  const session = await requireSession(isAdmin);
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { error } = await createAdminClient()
    .from("mail_monitor_mailboxes")
    .upsert({ mailbox: parsed.data.mailbox, tag_profile_ids: [...new Set(parsed.data.profile_ids)] });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
