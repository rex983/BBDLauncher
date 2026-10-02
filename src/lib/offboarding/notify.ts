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
import { slackEscape } from "@/lib/slack/escape";
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

// Names come from profiles, but escape them so a name can't inject mentions
// or break the one-line layout.
const slackName = (s: string) => slackEscape(s).replace(/[\r\n]+/g, " ");

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

// Posts to SLACK_OFFBOARDING_CHANNEL (or DMs each person when unset),
// @-mentioning everyone with offboarding access. People Slack can't match
// by email are named in bold instead.
async function notifySlack(
  team: Recipient[],
  p: { openerId: string; openerName: string; employeeName: string; lastDay: string; reason: string; url: string },
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  const ids = new Map<string, string | null>(
    await Promise.all(team.map(async (r) => [r.id, await slackUserId(token, r.email)] as const)),
  );
  const tag = (id: string, name: string) => (ids.get(id) ? `<@${ids.get(id)}>` : `*${slackName(name)}*`);
  const text =
    `${tag(p.openerId, p.openerName)} has submitted an offboarding request for *${slackName(p.employeeName)}*.\n` +
    `Last day: ${p.lastDay} · ${p.reason}\n<${p.url}|Open the checklist>`;
  const everyone = team.map((r) => tag(r.id, r.name || r.email)).join(" ");
  const post = (channel: string, body: string) =>
    slackApi("chat.postMessage", token, { channel, text: body, unfurl_links: false, unfurl_media: false });

  const channel = process.env.SLACK_OFFBOARDING_CHANNEL;
  const results = channel
    ? [await post(channel, `${text}\n${everyone}`)]
    : await Promise.all(
        [...ids.values()].filter((id): id is string => !!id).map((id) => post(id, text)),
      );
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
  const team = await offboardingTeam();
  // The person who started it already knows — no bell for them.
  const others = team.filter((r) => r.id !== p.openerId);

  const url = `${LAUNCHER_URL}/offboarding/${p.caseId}`;
  const lastDay = new Date(p.lastDay + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const reason = OFFBOARDING_REASON_LABEL[p.reason];

  await Promise.all([
    ...others.map((r) =>
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
    // Slack tags everyone with access, including whoever started it.
    notifySlack(team, { ...p, lastDay, reason, url }).catch((e) =>
      console.error("[offboarding] slack error:", e),
    ),
  ]);
}
