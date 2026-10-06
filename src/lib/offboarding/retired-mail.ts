// Mail for offboarded employees is forwarded to retiredemployees@. A Google
// Apps Script on that mailbox (docs/retired-mail-apps-script.js) posts each
// new message here; we log it, screen out junk (mail-filter.ts), work out
// which ex-employee it was meant for and tag the Sales managers in Slack.
// Admins monitor all of it at /admin/retired-mail.
//
//   RETIRED_MAIL_SECRET          shared secret the Apps Script sends
//   SLACK_BOT_TOKEN              bot token (chat:write, users:read.email)
//   SLACK_RETIRED_MAIL_CHANNEL   channel to post in (default #bot-notifications)
//   RETIRED_MAIL_AI + GEMINI_API_KEY  optional AI spam check (off unless "on")

import { createAdminClient } from "@/lib/supabase/admin";
import { MANAGER_TIER_ROLES } from "@/lib/auth/permissions";
import { slackApi, slackTags } from "@/lib/slack/bot";
import { slackEscape } from "@/lib/slack/escape";
import { classifyMail, senderAddress, type MailVerdict } from "./mail-filter";
import { slackName } from "./notify";

export const LAUNCHER_URL = process.env.LAUNCHER_URL || "https://bbd-launcher.vercel.app";
export const RETIRED_MAILBOX = "retiredemployees@bigbuildingsdirect.com";
export const RETIRED_MAIL_CHANNEL = process.env.SLACK_RETIRED_MAIL_CHANNEL || "#bot-notifications";

export interface RetiredMail {
  message_id: string;
  from: string;
  subject: string;
  preview: string;
  // Every address header the script saw (To, Cc, Delivered-To, …). The
  // ex-employee is whichever of these we've offboarded.
  recipients: string[];
  headers: Record<string, string>;
  category: string | null;
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

export async function salesManagers() {
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

// An admin's "always alert" / "never alert" rule for this sender's address
// or domain. The exact address wins over the domain.
async function senderRule(from: string): Promise<MailVerdict | null> {
  const address = senderAddress(from);
  const domain = address.includes("@") ? address.slice(address.indexOf("@")) : null;
  const { data } = await createAdminClient()
    .from("retired_mail_senders")
    .select("pattern, action")
    .in("pattern", domain ? [address, domain] : [address]);
  const rule = data?.find((r) => r.pattern === address) ?? data?.[0];
  if (!rule) return null;
  return {
    junk: rule.action === "block",
    reason: rule.action === "block" ? `muted sender ${rule.pattern}` : `always-alert sender ${rule.pattern}`,
    by: "sender",
  };
}

const oneLine = (s: string) => slackName(s.trim() || "(none)");

interface AlertInput {
  from: string;
  subject: string;
  preview: string;
  recipients: string[];
}

// Posts the Slack alert for one email. Used for new mail and when an admin
// pushes a filtered email through from /admin/retired-mail.
export async function postAlert(mail: AlertInput, employee?: Employee | null) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: "SLACK_BOT_TOKEN not set" };
  const recipients = addresses(mail.recipients);
  const [emp, managers] = await Promise.all([
    employee === undefined ? findEmployee(recipients) : employee,
    salesManagers(),
  ]);

  // No launcher record (offboarded before the launcher, or no case opened):
  // name the company address it was sent to instead.
  const sentTo = recipients.find((a) => a.endsWith("@bigbuildingsdirect.com")) ?? recipients[0];
  const who = emp
    ? `*${slackName(emp.name)}*${emp.office ? ` (former ${slackName(emp.office)})` : ""}`
    : sentTo
      ? `*${slackName(sentTo)}*`
      : "*an unknown former employee*";
  const lastDay = emp?.lastDay
    ? ` · last day ${new Date(emp.lastDay + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";
  const preview = slackEscape(mail.preview.replace(/\s+/g, " ").trim().slice(0, 280));
  const tags = await slackTags(token, managers, slackName);

  const text = [
    `:incoming_envelope: New email for ${who}${lastDay}`,
    `*From:* ${oneLine(mail.from)}`,
    `*Subject:* ${oneLine(mail.subject)}`,
    preview ? `> ${preview}${mail.preview.length > 280 ? "…" : ""}` : null,
    `It's been forwarded to your inbox from ${RETIRED_MAILBOX}.` +
      (emp?.caseId ? ` <${LAUNCHER_URL}/offboarding/${emp.caseId}|Offboarding case>` : ""),
    tags.length ? tags.join(" ") : null,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await slackApi("chat.postMessage", token, {
    channel: RETIRED_MAIL_CHANNEL,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
  if (!res.ok) console.error("[retired-mail] slack post failed:", res.error);
  return { ok: res.ok, error: res.error };
}

export async function handleRetiredMail(mail: RetiredMail): Promise<{
  posted: boolean;
  junk: boolean;
  reason: string;
  employee: string | null;
  slack_error?: string;
}> {
  const supabase = createAdminClient();
  const recipients = addresses(mail.recipients);

  // Claim the message id first so a resend from the script never posts twice.
  const { data: existing } = await supabase
    .from("retired_mail_log")
    .select("junk, reason, employee_name, slack_posted")
    .eq("message_id", mail.message_id)
    .maybeSingle();
  if (existing) {
    return {
      posted: false,
      junk: existing.junk,
      reason: existing.reason ?? "",
      employee: existing.employee_name,
      slack_error: "duplicate",
    };
  }

  const [employee, verdict] = await Promise.all([
    findEmployee(recipients),
    senderRule(mail.from).then((rule) => rule ?? classifyMail(mail)),
  ]);
  const sentTo = recipients.find((a) => a.endsWith("@bigbuildingsdirect.com")) ?? recipients[0] ?? null;

  const { data: row, error: insertError } = await supabase
    .from("retired_mail_log")
    .insert({
      message_id: mail.message_id,
      from_text: mail.from,
      subject: mail.subject,
      preview: mail.preview.slice(0, 2000),
      recipients,
      sent_to: employee?.email ?? sentTo,
      employee_name: employee?.name ?? null,
      case_id: employee?.caseId ?? null,
      junk: verdict.junk,
      reason: verdict.reason,
      decided_by: verdict.by,
    })
    .select("id")
    .single();
  if (insertError) {
    // Unique violation: another run got here first.
    if (insertError.code === "23505") {
      return { posted: false, junk: verdict.junk, reason: verdict.reason, employee: employee?.name ?? null, slack_error: "duplicate" };
    }
    console.error("[retired-mail] log insert failed:", insertError.message);
  }

  if (employee?.caseId) {
    const { error } = await supabase.from("offboarding_events").insert({
      case_id: employee.caseId,
      event_type: "mail_received",
      actor_name: RETIRED_MAILBOX,
      details: { message_id: mail.message_id, from: mail.from, subject: mail.subject, junk: verdict.junk },
    });
    if (error) console.error("[retired-mail] audit insert failed:", error.message);
  }

  if (verdict.junk) {
    return { posted: false, junk: true, reason: verdict.reason, employee: employee?.name ?? null };
  }

  const res = await postAlert(mail, employee);
  if (row) {
    await supabase
      .from("retired_mail_log")
      .update({ slack_posted: res.ok, slack_error: res.ok ? null : res.error ?? "unknown error" })
      .eq("id", row.id);
  }
  return { posted: res.ok, junk: false, reason: verdict.reason, employee: employee?.name ?? null, slack_error: res.error };
}
