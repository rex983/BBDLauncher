import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { slackApi, slackTags } from "@/lib/slack/bot";
import { slackEscape } from "@/lib/slack/escape";
import { loadRetiredMailHealth } from "@/lib/offboarding/retired-mail-health";
import { LAUNCHER_URL, RETIRED_MAIL_CHANNEL } from "@/lib/offboarding/retired-mail";
import { MAILBOXES, shortMailbox } from "@/lib/offboarding/mailboxes";

// Daily check on the Email monitor (each watched mailbox → Slack), so nobody
// has to remember to look:
//   - anything broken → tag the launcher admins with what and how to fix it
//   - Mondays → a one-line weekly summary pointing at /admin/email-monitor
async function handle() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "SLACK_BOT_TOKEN not set" });

  const supabase = createAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [health, { data: week }, { data: admins }] = await Promise.all([
    loadRetiredMailHealth(now.getTime()),
    supabase.from("retired_mail_log").select("mailbox, junk, slack_posted").gte("received_at", weekAgo),
    supabase.from("profiles").select("email, name:full_name").eq("is_active", true).eq("role", "admin"),
  ]);

  const page = `<${LAUNCHER_URL}/admin/email-monitor|Launcher › Admin › Email monitor>`;
  const broken = health.checks.filter((c) => c.status === "bad");
  const isMonday = now.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }) === "Mon";
  if (!broken.length && !isMonday) return NextResponse.json({ ok: true, posted: false });

  const lines: string[] = [];
  if (broken.length) {
    lines.push(":rotating_light: *Email monitor needs attention*");
    for (const c of broken) lines.push(`• *${slackEscape(c.label)}:* ${slackEscape(c.detail)}${c.fix ? ` _${slackEscape(c.fix)}_` : ""}`);
  } else {
    const parts = MAILBOXES.map((box) => {
      const mine = week?.filter((m) => m.mailbox === box.address) ?? [];
      const alerted = mine.filter((m) => !m.junk).length;
      return box.filtered
        ? `${shortMailbox(box.address)} ${mine.length} received · ${alerted} alerted · ${mine.length - alerted} filtered`
        : `${shortMailbox(box.address)} ${mine.length} received`;
    });
    lines.push(`:bar_chart: *Email monitor, last 7 days:* ${parts.join(" | ")}. All systems OK.`);
  }
  lines.push(`Settings in ${page}.`);
  // Only page the admins when something is actually wrong.
  if (broken.length) {
    const tags = await slackTags(token, (admins ?? []) as { email: string; name: string | null }[], slackEscape);
    if (tags.length) lines.push(tags.join(" "));
  }

  const res = await slackApi("chat.postMessage", token, {
    channel: RETIRED_MAIL_CHANNEL,
    text: lines.join("\n"),
    unfurl_links: false,
  });
  return NextResponse.json({ ok: res.ok, posted: res.ok, problems: broken.length, error: res.error });
}

export const { GET, POST } = cronRoute(handle);
