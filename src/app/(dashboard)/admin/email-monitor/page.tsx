import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRetiredMailHealth } from "@/lib/offboarding/retired-mail-health";
import EmailMonitorShell, { type Fire, type Person, type SenderRule } from "./EmailMonitorShell";

const LOG_DAYS = 30;

// Control room for the Email monitor (retiredemployees@ and orders@ →
// Slack): is it running, who gets tagged, sender overrides and a log of
// alerts fired. The mail itself stays in Gmail.
export default async function EmailMonitorPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.role)) redirect("/dashboard");

  const supabase = createAdminClient();
  const since = new Date(Date.now() - LOG_DAYS * 86_400_000).toISOString();
  const [health, { data: senders }, { data: people }, { data: fires }] = await Promise.all([
    loadRetiredMailHealth(),
    supabase.from("retired_mail_senders").select("pattern, action, created_at").order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, name:full_name, email, office")
      .eq("is_active", true)
      .order("full_name"),
    // Alerts only; junk never fired anything.
    supabase
      .from("retired_mail_log")
      .select("id, received_at, mailbox, slack_posted, slack_error, case_id")
      .eq("junk", false)
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(500),
  ]);

  return (
    <EmailMonitorShell
      health={health}
      senders={(senders ?? []) as SenderRule[]}
      people={(people ?? []) as Person[]}
      fires={(fires ?? []) as Fire[]}
      days={LOG_DAYS}
    />
  );
}
