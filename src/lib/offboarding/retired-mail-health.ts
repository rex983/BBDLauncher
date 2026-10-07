// Health of the Email monitor (each watched mailbox → Slack), shared by
// /admin/email-monitor, the admin sidebar badge and the daily watchdog cron.

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { taggedFor } from "./retired-mail";
import { MAILBOXES, RETIRED_MAILBOX, shortMailbox } from "./mailboxes";
import { AI_FALLBACK_PREFIX, aiEnabled } from "./mail-filter";

// Bearer RETIRED_MAIL_SECRET, compared in constant time.
export function retiredMailAuthorized(req: NextRequest): boolean {
  const secret = process.env.RETIRED_MAIL_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// The script runs every minute and checks in every 5; allow for Google's
// trigger jitter before calling it stopped.
export const STALE_AFTER_MS = 20 * 60_000;

export type CheckStatus = "ok" | "warn" | "bad";

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface MailboxHealth {
  address: string;
  label: string;
  lastCheckAt: string | null;
  tagged: { email: string; name: string | null }[];
  tagIds: string[]; // the admin's picks (orders@)
}

export interface RetiredMailHealth {
  checks: HealthCheck[];
  problems: number; // checks that are "bad"
  mailboxes: MailboxHealth[];
}

function ago(iso: string, now: number): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

export async function loadRetiredMailHealth(now = Date.now()): Promise<RetiredMailHealth> {
  const supabase = createAdminClient();
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const [{ data: beats }, { data: failures }, { count: aiMisses }, tagged] = await Promise.all([
    supabase.from("mail_monitor_mailboxes").select("*"),
    supabase
      .from("retired_mail_log")
      .select("slack_error, received_at")
      .eq("junk", false)
      .eq("slack_posted", false)
      .not("slack_error", "is", null)
      .gte("received_at", weekAgo)
      .order("received_at", { ascending: false }),
    supabase
      .from("retired_mail_log")
      .select("id", { count: "exact", head: true })
      .like("reason", `${AI_FALLBACK_PREFIX}%`)
      .gte("received_at", weekAgo),
    Promise.all(MAILBOXES.map((m) => taggedFor(m.address))),
  ]);

  const checks: HealthCheck[] = [];
  const mailboxes: MailboxHealth[] = [];

  MAILBOXES.forEach((box, i) => {
    const beat = beats?.find((b) => b.mailbox === box.address);
    const lastCheckAt: string | null = beat?.last_check_at ?? null;
    const name = shortMailbox(box.address);
    mailboxes.push({ address: box.address, label: box.label, lastCheckAt, tagged: tagged[i], tagIds: beat?.tag_profile_ids ?? [] });

    if (!lastCheckAt) {
      checks.push({
        id: `script:${box.address}`,
        label: `${name} script`,
        status: "bad",
        detail: "Has never checked in.",
        fix: `Paste the latest script into Apps Script (signed in as ${name}) and run setup() once.`,
      });
    } else if (now - new Date(lastCheckAt).getTime() > STALE_AFTER_MS) {
      checks.push({
        id: `script:${box.address}`,
        label: `${name} script`,
        status: "bad",
        detail: `Last checked in ${ago(lastCheckAt, now)}. New mail isn't being picked up.`,
        fix: "Open Apps Script → Executions. If the trigger is gone, run setup() again.",
      });
    } else {
      checks.push({ id: `script:${box.address}`, label: `${name} script`, status: "ok", detail: `Checked in ${ago(lastCheckAt, now)}.` });
    }

    if (beat?.last_error_at && (!lastCheckAt || beat.last_error_at > lastCheckAt)) {
      checks.push({
        id: `script_error:${box.address}`,
        label: `${name} script errors`,
        status: "bad",
        detail: `Failed ${ago(beat.last_error_at, now)}: ${beat.last_error}`,
        fix: "Mail that failed is retried every minute; fix the cause and it catches up on its own.",
      });
    }

    const people = tagged[i];
    checks.push(
      people.length
        ? { id: `tags:${box.address}`, label: `${name} tags`, status: "ok", detail: people.map((m) => m.name || m.email).join(", ") }
        : box.address === RETIRED_MAILBOX
          ? {
              id: `tags:${box.address}`,
              label: `${name} tags`,
              status: "bad",
              detail: "No active Sales managers, so alerts tag nobody.",
              fix: "Set a manager's office to Sales in Admin → Users.",
            }
          : {
              id: `tags:${box.address}`,
              label: `${name} tags`,
              status: "warn",
              detail: "Nobody picked, so alerts post without tagging anyone.",
              fix: "Pick who gets tagged under Who gets tagged below.",
            },
    );
  });

  checks.push(
    process.env.RETIRED_MAIL_SECRET
      ? { id: "secret", label: "Script secret", status: "ok", detail: "RETIRED_MAIL_SECRET is set." }
      : {
          id: "secret",
          label: "Script secret",
          status: "bad",
          detail: "RETIRED_MAIL_SECRET isn't set on Vercel, so every email is rejected.",
          fix: "Add it in Vercel → Settings → Environment Variables (same value as the script's LAUNCHER_SECRET), then redeploy.",
        },
  );

  if (!process.env.SLACK_BOT_TOKEN) {
    checks.push({
      id: "slack",
      label: "Slack",
      status: "bad",
      detail: "SLACK_BOT_TOKEN isn't set, so no alerts can be posted.",
      fix: "Add the bbd-bot token in Vercel and redeploy.",
    });
  } else if (failures?.length) {
    checks.push({
      id: "slack",
      label: "Slack",
      status: "bad",
      detail: `${failures.length} alert${failures.length === 1 ? "" : "s"} failed this week (latest: ${failures[0].slack_error}).`,
      fix: "If it says not_in_channel, invite bbd-bot to the channel. Then resend the failed emails below.",
    });
  } else {
    checks.push({ id: "slack", label: "Slack", status: "ok", detail: "Posting as bbd-bot." });
  }

  checks.push(
    !aiEnabled()
      ? {
          id: "ai",
          label: "Spam filter",
          status: "ok",
          detail: "retiredemployees@ only (every orders@ email alerts). Rules: BCC'd mass mail, Gmail's Promotions/Social tabs, unsubscribe headers, no-reply senders and your sender rules. Cold pitches from real people still alert; mute them below.",
        }
      : aiMisses
        ? {
            id: "ai",
            label: "Spam filter",
            status: "warn",
            detail: `The AI was unavailable for ${aiMisses} email${aiMisses === 1 ? "" : "s"} this week; rules decided those.`,
            fix: "Usually Gemini's free tier being busy and clears up on its own. If it persists, check the key's quota at aistudio.google.com.",
          }
        : { id: "ai", label: "Spam filter", status: "ok", detail: "Gmail tabs + bulk-mail rules + AI review." },
  );

  return { checks, problems: checks.filter((c) => c.status === "bad").length, mailboxes };
}
