import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRetiredMailHealth } from "@/lib/offboarding/retired-mail-health";
import EmailMonitorShell, { type MailRow, type Person, type SenderRule } from "./EmailMonitorShell";

const LOG_DAYS = 30;

// Control room for the Email monitor (retiredemployees@ and orders@ →
// Slack): is it running, what came in, what was filtered and why, sender
// overrides and who gets tagged.
export default async function EmailMonitorPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.role)) redirect("/dashboard");

  const supabase = createAdminClient();
  const since = new Date(Date.now() - LOG_DAYS * 86_400_000).toISOString();
  const [health, { data: mail }, { data: senders }, { data: people }] = await Promise.all([
    loadRetiredMailHealth(),
    supabase
      .from("retired_mail_log")
      .select("id, mailbox, received_at, from_text, subject, preview, sent_to, employee_name, case_id, junk, reason, decided_by, slack_posted, slack_error")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(1000),
    supabase.from("retired_mail_senders").select("pattern, action, created_at").order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, name:full_name, email, office")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  return (
    <EmailMonitorShell
      health={health}
      mail={(mail ?? []) as MailRow[]}
      senders={(senders ?? []) as SenderRule[]}
      people={(people ?? []) as Person[]}
      days={LOG_DAYS}
    />
  );
}
