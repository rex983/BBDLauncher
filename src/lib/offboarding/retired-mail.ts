// Mail for offboarded employees is forwarded to retiredemployees@. A Google
// Apps Script on that mailbox (docs/retired-mail-apps-script.js) posts each
// new message here; we work out which ex-employee it was meant for and tag
// the Sales managers in Slack.
//
//   RETIRED_MAIL_SECRET          shared secret the Apps Script sends
//   SLACK_BOT_TOKEN              bot token (chat:write, users:read.email)
//   SLACK_RETIRED_MAIL_CHANNEL   channel to post in (default #bot-notifications)

import { createAdminClient } from "@/lib/supabase/admin";
import { MANAGER_TIER_ROLES } from "@/lib/auth/permissions";
import { slackApi, slackTags } from "@/lib/slack/bot";
import { slackEscape } from "@/lib/slack/escape";
import { slackName } from "./notify";

const LAUNCHER_URL = process.env.LAUNCHER_URL || "https://bbd-launcher.vercel.app";
export const RETIRED_MAILBOX = "retiredemployees@bigbuildingsdirect.com";

export interface RetiredMail {
  message_id: string;
  from: string;
  subject: string;
  preview: string;
  // Every address header the script saw (To, Cc, Delivered-To, …). The
  // ex-employee is whichever of these we've offboarded.
  recipients: string[];
}

interface Employee {
  name: string;
  email: string;
  office: string | null;
  caseId: string | null;
  lastDay: string | null;
}

function addresses(raw: string[]): string[] {
  const found = raw.join(" ").toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  return [...new Set(found)].filter((a) => a !== RETIRED_MAILBOX);
}

// Latest non-cancelled offboarding case for any recipient, else an
// inactive-or-not profile with that email (offboarded before cases existed).
async function findEmployee(candidates: string[]): Promise<Employee | null> {
  if (!candidates.length) return null;
  const supabase = createAdminClient();
  const [cases, profiles] = await Promise.all([
    supabase
      .from("offboarding_cases")
      .select("id, employee_name, employee_email, employee_office, last_day, status")
      .in("employee_email", candidates)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("profiles")
      .select("email, name:full_name, office")
      .in("email", candidates)
      .limit(1),
  ]);
  const c = cases.data?.[0];
  if (c) {
    return {
      name: c.employee_name || c.employee_email,
      email: c.employee_email,
      office: c.employee_office,
      caseId: c.id,
      lastDay: c.last_day,
    };
  }
  const p = profiles.data?.[0];
  return p ? { name: p.name || p.email, email: p.email, office: p.office, caseId: null, lastDay: null } : null;
}

// Only Sales managers are tagged, whoever the mail was for: ex-employee
// mail is customer mail, and BST managers don't handle it.
const TAGGED_OFFICE = "Sales";

async function salesManagers() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("email, name:full_name")
    .eq("is_active", true)
    .eq("office", TAGGED_OFFICE)
    .in("role", [...MANAGER_TIER_ROLES])
    .order("full_name");
  return (data ?? []) as { email: string; name: string | null }[];
}

const oneLine = (s: string) => slackName(s.trim() || "(none)");

export async function handleRetiredMail(mail: RetiredMail): Promise<{ posted: boolean; employee: string | null; slack_error?: string }> {
  const recipients = addresses(mail.recipients);
  const [employee, managers] = await Promise.all([
    findEmployee(recipients),
    salesManagers(),
  ]);
  const supabase = createAdminClient();

  if (employee?.caseId) {
    // Fire-and-forget audit entry on the case; skip duplicates if the
    // script ever resends a message.
    const { data: dup } = await supabase
      .from("offboarding_events")
      .select("id")
      .eq("case_id", employee.caseId)
      .eq("event_type", "mail_received")
      .contains("details", { message_id: mail.message_id })
      .limit(1);
    if (dup?.length) return { posted: false, employee: employee.name, slack_error: "duplicate" };
    const { error } = await supabase.from("offboarding_events").insert({
      case_id: employee.caseId,
      event_type: "mail_received",
      actor_name: RETIRED_MAILBOX,
      details: { message_id: mail.message_id, from: mail.from, subject: mail.subject },
    });
    if (error) console.error("[retired-mail] audit insert failed:", error.message);
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { posted: false, employee: employee?.name ?? null, slack_error: "SLACK_BOT_TOKEN not set" };

  // No launcher record (offboarded before the launcher, or no case opened):
  // name the company address it was sent to instead.
  const sentTo = recipients.find((a) => a.endsWith("@bigbuildingsdirect.com")) ?? recipients[0];
  const who = employee
    ? `*${slackName(employee.name)}*${employee.office ? ` (former ${slackName(employee.office)})` : ""}`
    : sentTo
      ? `*${slackName(sentTo)}* (no offboarding record in the launcher)`
      : "*an unknown former employee*";
  const lastDay = employee?.lastDay
    ? ` · last day ${new Date(employee.lastDay + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";
  const preview = slackEscape(mail.preview.replace(/\s+/g, " ").trim().slice(0, 280));
  const tags = await slackTags(token, managers, slackName);

  const text = [
    `:incoming_envelope: New email for ${who}${lastDay}`,
    `*From:* ${oneLine(mail.from)}`,
    `*Subject:* ${oneLine(mail.subject)}`,
    preview ? `> ${preview}${mail.preview.length > 280 ? "…" : ""}` : null,
    `It's been forwarded to your inbox from ${RETIRED_MAILBOX}.` +
      (employee?.caseId ? ` <${LAUNCHER_URL}/offboarding/${employee.caseId}|Offboarding case>` : ""),
    tags.length ? tags.join(" ") : null,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await slackApi("chat.postMessage", token, {
    channel: process.env.SLACK_RETIRED_MAIL_CHANNEL || "#bot-notifications",
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
  if (!res.ok) console.error("[retired-mail] slack post failed:", res.error);
  return { posted: res.ok, employee: employee?.name ?? null, slack_error: res.error };
}
