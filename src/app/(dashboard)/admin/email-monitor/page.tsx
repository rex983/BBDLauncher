import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRetiredMailHealth } from "@/lib/offboarding/retired-mail-health";
import EmailMonitorShell, { type Person, type SenderRule } from "./EmailMonitorShell";

// Control room for the Email monitor (retiredemployees@ and orders@ →
// Slack): is it running, who gets tagged, sender overrides. The mail itself
// stays in Gmail.
export default async function EmailMonitorPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.role)) redirect("/dashboard");

  const supabase = createAdminClient();
  const [health, { data: senders }, { data: people }] = await Promise.all([
    loadRetiredMailHealth(),
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
      senders={(senders ?? []) as SenderRule[]}
      people={(people ?? []) as Person[]}
    />
  );
}
