// "Offboarding started" alerts to everyone who can open /offboarding (admins
// + the offboarding team): a bell notification and a Slack message. Slack is
// best-effort and skipped when its env vars aren't set, so a broken
// integration never blocks opening a case.
//
//   SLACK_BOT_TOKEN              bot token (scopes: chat:write, users:read.email)
//   SLACK_OFFBOARDING_CHANNEL    channel to post in, @-mentioning the team;
//                                unset = DM each person instead

import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/service";
import { OFFBOARDING_REASON_LABEL, type OffboardingReason } from "./types";

const LAUNCHER_URL = process.env.LAUNCHER_URL || "https://bbd-launcher.vercel.app";

interface Recipient {
  id: string;
  email: string;
  name: string | null;
}

// Everyone with access to /offboarding.
async function offboardingTeam(): Promise<Recipient[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, name:full_name, is_active")
    .or("role.eq.admin,can_offboard.eq.true");
  return (data || []).filter((p) => p.is_active !== false) as Recipient[];
}

// Names come from profiles, but escape Slack mrkdwn anyway so a name can't
// inject mentions or formatting.
function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\r\n]+/g, " ");
}

async function slackApi(method: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { ok: boolean; error?: string; user?: { id: string } };
}

async function slackUserId(token: string, email: string): Promise<string | null> {
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { ok: boolean; user?: { id: string } };
  return json.ok && json.user ? json.user.id : null;
}

async function notifySlack(recipients: Recipient[], text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  const ids = (await Promise.all(recipients.map((r) => slackUserId(token, r.email)))).filter(
    (id): id is string => !!id,
  );
  const channel = process.env.SLACK_OFFBOARDING_CHANNEL;
  const results = channel
    ? [await slackApi("chat.postMessage", token, { channel, text: `${text}\n${ids.map((id) => `<@${id}>`).join(" ")}` })]
    : await Promise.all(ids.map((id) => slackApi("chat.postMessage", token, { channel: id, text })));
  for (const r of results) if (!r.ok) console.error("[offboarding] slack post failed:", r.error);
}

export async function notifyCaseOpened(p: {
  caseId: string;
  openerId: string;
  openerName: string;
  employeeName: string;
  lastDay: string;
  reason: OffboardingReason;
}): Promise<void> {
  // The person who started it already knows.
  const recipients = (await offboardingTeam()).filter((r) => r.id !== p.openerId);
  if (recipients.length === 0) return;

  const url = `${LAUNCHER_URL}/offboarding/${p.caseId}`;
  const lastDay = new Date(p.lastDay + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const reason = OFFBOARDING_REASON_LABEL[p.reason];

  await Promise.all([
    ...recipients.map((r) =>
      createNotification({
        userId: r.id,
        type: "offboarding_opened",
        title: `Offboarding started: ${p.employeeName}`,
        body: `Submitted by ${p.openerName} · last day ${lastDay}`,
        href: `/offboarding/${p.caseId}`,
        referenceType: "offboarding_case",
        referenceId: p.caseId,
      }).catch(() => undefined),
    ),
    notifySlack(
      recipients,
      `*${slackEscape(p.openerName)}* has submitted an offboarding request for *${slackEscape(p.employeeName)}*.\n` +
        `Last day: ${lastDay} · ${reason}\n<${url}|Open the checklist>`,
    ).catch((e) => console.error("[offboarding] slack error:", e)),
  ]);
}
