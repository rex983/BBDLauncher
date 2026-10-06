import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { postAlert } from "@/lib/offboarding/retired-mail";

// Push one logged email to Slack: a filtered email that was actually real,
// or an alert that failed to post.
const schema = z.object({ id: z.uuid() });

export async function POST(req: NextRequest) {
  const session = await requireSession(isAdmin);
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("retired_mail_log")
    .select("id, from_text, subject, preview, recipients, junk")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const res = await postAlert({
    from: row.from_text,
    subject: row.subject,
    preview: row.preview,
    recipients: row.recipients,
  });
  await supabase
    .from("retired_mail_log")
    .update({
      slack_posted: res.ok,
      slack_error: res.ok ? null : res.error ?? "unknown error",
      ...(row.junk ? { junk: false, decided_by: "admin", reason: `sent to Slack by ${session.user.name ?? "an admin"}` } : {}),
    })
    .eq("id", row.id);
  if (!res.ok) return NextResponse.json({ error: `Slack: ${res.error}` }, { status: 502 });
  return NextResponse.json({ ok: true });
}
